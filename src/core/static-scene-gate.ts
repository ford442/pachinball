/**
 * StaticSceneGate — the one place that decides when the scene may be treated as static.
 *
 * Freezing (the static shadow map, the frozen material set, the frozen active-mesh list) only
 * pays off while nothing that feeds it changes, and is only correct if every change thaws it
 * first. Instead of a new EventBus event per cause, the few places that change the static scene
 * call `invalidate(reason)` directly:
 *
 *   - `invalidate` thaws every registered target synchronously, so the change that follows is
 *     seen by a scene that is no longer frozen;
 *   - it then waits for `FRAMES_BEFORE_REFREEZE` rendered frames with no hold outstanding and
 *     refreezes ONCE: any number of invalidations in a burst (a 5-ball multiball spawn, a track
 *     rebuild) coalesce into one refreeze;
 *   - `hold()` keeps the scene thawed across something long or asynchronous (a glTF cabinet
 *     load, a FEVER window) and refreezes when the last hold is released;
 *   - if it would be refreezing over and over it stops trying for a while (see THRASH_*), because
 *     a gate that thaws every other frame costs more than never freezing.
 *
 * Targets (commits that follow) register what to thaw and refreeze; this file has none, so on its
 * own it only counts. It imports no Babylon runtime code, so it unit-tests without the engine mock.
 */

import type { EventBus } from './event-bus'

/**
 * Rendered frames between an invalidation and the refreeze. Two, not one: an invalidation raised
 * from inside a frame's own after-render pass has already missed that frame, so the first count
 * may be the frame that was rendered frozen. Two guarantees one fully thawed frame in between.
 */
export const FRAMES_BEFORE_REFREEZE = 2

/** More than this many refreezes inside the window means the scene is not actually static... */
export const THRASH_MAX_REFREEZES = 8
export const THRASH_WINDOW_MS = 4000
/** ...so stay thawed until it has been quiet this long. */
export const THRASH_COOLDOWN_MS = 3000

/** While a target says it cannot freeze yet, ask again this many frames later (not every frame). */
export const READINESS_RETRY_FRAMES = 8

export interface StaticSceneInvalidation {
  reason: string
  /** Material state may change (quality tier, glTF load): frozen materials thaw too. */
  materials: boolean
  /** The static shadow caster set may change: the static shadow map must be rendered again. */
  shadows: boolean
}

export type InvalidateOptions = Partial<Pick<StaticSceneInvalidation, 'materials' | 'shadows'>>

export interface StaticSceneTarget {
  readonly name: string
  /** Synchronous, from `invalidate()`. Must be idempotent and cheap when already thawed. */
  thaw(invalidation: StaticSceneInvalidation): void
  /**
   * After `FRAMES_BEFORE_REFREEZE` rendered frames with no hold. `pending` is the union of every
   * invalidation since the previous refreeze.
   */
  refreeze(pending: StaticSceneInvalidation): void
  /**
   * Optional. False while the target cannot freeze correctly yet, e.g. a frozen active-mesh list
   * would capture meshes whose shaders are still compiling and leave them out for good. The gate
   * keeps the scene thawed and asks again `READINESS_RETRY_FRAMES` frames later.
   */
  canRefreeze?(): boolean
}

export type StaticSceneState = 'frozen' | 'thawed' | 'suspended'

export interface StaticSceneStats {
  state: StaticSceneState
  /** Completed refreeze cycles. The debug HUD and the perf harness read this. */
  refreezeCount: number
  invalidationCount: number
  lastReason: string | null
  holds: number
  /** Invalidations per reason, most frequent first. */
  reasons: Array<[reason: string, count: number]>
}

/** The slice of `Scene` the gate drives. */
export interface StaticSceneGateHost {
  readonly onAfterRenderObservable: {
    add(callback: () => void): unknown
    remove(observer: unknown): unknown
  }
  readonly onNewMeshAddedObservable?: {
    add(callback: () => void): unknown
    remove(observer: unknown): unknown
  }
  readonly onMeshRemovedObservable?: {
    add(callback: () => void): unknown
    remove(observer: unknown): unknown
  }
}

export interface StaticSceneGateOptions {
  eventBus?: Pick<EventBus, 'on'>
  /** Thaw whenever a mesh is added to or removed from the scene (default true). */
  watchMeshes?: boolean
  now?: () => number
  framesBeforeRefreeze?: number
  thrash?: { maxRefreezes: number; windowMs: number; cooldownMs: number }
}

/** EventBus windows that keep the scene thawed from `start` until `end` (FEVER, jackpot, multiball). */
const HOLD_EVENTS = [
  ['fever:start', 'fever:end', 'fever'],
  ['jackpot:start', 'jackpot:end', 'jackpot'],
  ['multiball:start', 'multiball:end', 'multiball'],
] as const

export class StaticSceneGate {
  private readonly scene: StaticSceneGateHost
  private readonly now: () => number
  private readonly framesBeforeRefreeze: number
  private readonly thrash: { maxRefreezes: number; windowMs: number; cooldownMs: number }

  private readonly targets: StaticSceneTarget[] = []
  private readonly holds = new Set<symbol>()
  private readonly reasonCounts = new Map<string, number>()
  private readonly cleanups: Array<() => void> = []
  private readonly refreezeTimes: number[] = []

  private pending: StaticSceneInvalidation | null = null
  private frameObserver: unknown = null
  private framesLeft = 0
  private suspendedUntil = 0
  private disposed = false

  private _state: StaticSceneState = 'thawed'
  private _refreezeCount = 0
  private _invalidationCount = 0
  private _lastReason: string | null = null

  constructor(scene: StaticSceneGateHost, options: StaticSceneGateOptions = {}) {
    this.scene = scene
    this.now = options.now ?? (() => performance.now())
    this.framesBeforeRefreeze = options.framesBeforeRefreeze ?? FRAMES_BEFORE_REFREEZE
    this.thrash = options.thrash ?? {
      maxRefreezes: THRASH_MAX_REFREEZES,
      windowMs: THRASH_WINDOW_MS,
      cooldownMs: THRASH_COOLDOWN_MS,
    }

    if (options.watchMeshes !== false) {
      const added = scene.onNewMeshAddedObservable?.add(() => this.invalidate('mesh:added'))
      const removed = scene.onMeshRemovedObservable?.add(() => this.invalidate('mesh:removed'))
      this.cleanups.push(() => {
        if (added !== undefined) scene.onNewMeshAddedObservable?.remove(added)
        if (removed !== undefined) scene.onMeshRemovedObservable?.remove(removed)
      })
    }

    if (options.eventBus) this.bindEventBus(options.eventBus)
  }

  /** Register something to thaw / refreeze. Returns an unregister function. */
  registerTarget(target: StaticSceneTarget): () => void {
    this.targets.push(target)
    return () => {
      const index = this.targets.indexOf(target)
      if (index !== -1) this.targets.splice(index, 1)
    }
  }

  /**
   * The static scene is about to change (or just did). Thaws now; refreezes later, once.
   * Call BEFORE the mutation when the mutation reads frozen state (a material property write).
   */
  invalidate(reason: string, options: InvalidateOptions = {}): void {
    if (this.disposed) return
    const invalidation: StaticSceneInvalidation = {
      reason,
      materials: options.materials ?? false,
      shadows: options.shadows ?? false,
    }

    this._invalidationCount++
    this._lastReason = reason
    this.reasonCounts.set(reason, (this.reasonCounts.get(reason) ?? 0) + 1)
    this.pending = this.pending
      ? {
          reason: this.pending.reason,
          materials: this.pending.materials || invalidation.materials,
          shadows: this.pending.shadows || invalidation.shadows,
        }
      : invalidation

    for (const target of this.targets) target.thaw(invalidation)
    if (this._state === 'frozen') this._state = 'thawed'
    // Still churning: the cooldown is "quiet for this long", so each invalidation extends it.
    if (this._state === 'suspended') this.suspendedUntil = this.now() + this.thrash.cooldownMs
    this.arm()
  }

  /**
   * `invalidate()`, then keep the scene thawed until the returned function is called. For work
   * that spans frames (an async glTF load). The release is idempotent.
   */
  hold(reason: string, options: InvalidateOptions = {}): () => void {
    const token = Symbol(reason)
    this.holds.add(token)
    this.invalidate(reason, options)
    return () => {
      if (!this.holds.delete(token)) return
      if (this.holds.size === 0) this.arm()
    }
  }

  /**
   * Invalidate whenever `read()` returns a different number from one rendered frame to the next.
   * For scene state a frozen thing silently ignores and nothing announces: the track theme lerps
   * the scene's fog every frame, and a frozen material never re-binds its fog uniforms. The first
   * read is the baseline. Returns an unwatch function; dispose() also removes it.
   */
  watchState(reason: string, read: () => number, options: InvalidateOptions = {}): () => void {
    if (this.disposed) return () => undefined
    let last = read()
    const observer = this.scene.onAfterRenderObservable.add(() => {
      const value = read()
      if (value === last) return
      last = value
      this.invalidate(reason, options)
    })
    const unwatch = (): void => {
      this.scene.onAfterRenderObservable.remove(observer)
      const index = this.cleanups.indexOf(unwatch)
      if (index !== -1) this.cleanups.splice(index, 1)
    }
    this.cleanups.push(unwatch)
    return unwatch
  }

  getStats(): StaticSceneStats {
    return {
      state: this._state,
      refreezeCount: this._refreezeCount,
      invalidationCount: this._invalidationCount,
      lastReason: this._lastReason,
      holds: this.holds.size,
      reasons: [...this.reasonCounts].sort((a, b) => b[1] - a[1]),
    }
  }

  get refreezeCount(): number {
    return this._refreezeCount
  }

  get state(): StaticSceneState {
    return this._state
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disarm()
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.holds.clear()
    this.targets.length = 0
    this.pending = null
  }

  private bindEventBus(bus: Pick<EventBus, 'on'>): void {
    const releases = new Map<string, () => void>()
    for (const [start, end, key] of HOLD_EVENTS) {
      this.cleanups.push(
        bus.on(start, () => {
          if (!releases.has(key)) releases.set(key, this.hold(start))
        }),
        bus.on(end, () => {
          releases.get(key)?.()
          releases.delete(key)
        }),
      )
    }
    this.cleanups.push(() => {
      for (const release of releases.values()) release()
      releases.clear()
    })
  }

  /** (Re)start the frame countdown. Every invalidation resets it, so a burst refreezes once. */
  private arm(): void {
    // A hold released while disposing (an open FEVER window) must not re-arm a dead gate.
    if (this.disposed || this.holds.size > 0) return
    this.framesLeft = this.framesBeforeRefreeze
    if (this.frameObserver === null) {
      this.frameObserver = this.scene.onAfterRenderObservable.add(() => this.onFrame())
    }
  }

  private disarm(): void {
    if (this.frameObserver === null) return
    this.scene.onAfterRenderObservable.remove(this.frameObserver)
    this.frameObserver = null
  }

  private onFrame(): void {
    if (this.holds.size > 0) {
      // A hold arrived after arming; wait for its release to re-arm.
      this.disarm()
      return
    }
    if (this._state === 'suspended') {
      if (this.now() < this.suspendedUntil) return
      this._state = 'thawed'
      this.framesLeft = this.framesBeforeRefreeze
    }
    if (--this.framesLeft > 0) return
    if (this.targets.some((target) => target.canRefreeze?.() === false)) {
      this.framesLeft = READINESS_RETRY_FRAMES
      return
    }
    this.disarm()
    this.refreeze()
  }

  private refreeze(): void {
    const now = this.now()
    const { maxRefreezes, windowMs, cooldownMs } = this.thrash

    while (this.refreezeTimes.length > 0 && now - this.refreezeTimes[0] > windowMs) this.refreezeTimes.shift()
    if (this.refreezeTimes.length >= maxRefreezes) {
      // Not static: a gate that refreezes every few frames costs more than leaving things alone.
      this.refreezeTimes.length = 0
      this._state = 'suspended'
      this.suspendedUntil = now + cooldownMs
      this.framesLeft = this.framesBeforeRefreeze
      this.frameObserver = this.scene.onAfterRenderObservable.add(() => this.onFrame())
      return
    }

    const pending = this.pending ?? { reason: 'refreeze', materials: false, shadows: false }
    this.pending = null
    for (const target of this.targets) target.refreeze(pending)
    this.refreezeTimes.push(now)
    this._refreezeCount++
    this._state = 'frozen'
  }
}
