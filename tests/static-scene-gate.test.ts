import { describe, expect, it, vi } from 'vitest'
import { EventBus } from '../src/core/event-bus'
import {
  FRAMES_BEFORE_REFREEZE,
  StaticSceneGate,
  type StaticSceneGateHost,
  type StaticSceneInvalidation,
  type StaticSceneTarget,
} from '../src/core/static-scene-gate'

class FakeObservable {
  observers: Array<() => void> = []
  add(callback: () => void): () => void {
    this.observers.push(callback)
    return callback
  }
  remove(observer: unknown): void {
    this.observers = this.observers.filter((o) => o !== observer)
  }
  notify(): void {
    for (const callback of [...this.observers]) callback()
  }
}

function makeScene() {
  const afterRender = new FakeObservable()
  const meshAdded = new FakeObservable()
  const meshRemoved = new FakeObservable()
  const scene: StaticSceneGateHost = {
    onAfterRenderObservable: afterRender,
    onNewMeshAddedObservable: meshAdded,
    onMeshRemovedObservable: meshRemoved,
  }
  return {
    scene,
    afterRender,
    meshAdded,
    meshRemoved,
    /** Render `n` frames. */
    frames(n = 1) {
      for (let i = 0; i < n; i++) afterRender.notify()
    },
  }
}

function makeTarget(name = 'target') {
  const thaw = vi.fn<(i: StaticSceneInvalidation) => void>()
  const refreeze = vi.fn<(p: StaticSceneInvalidation) => void>()
  const target: StaticSceneTarget = { name, thaw, refreeze }
  return { target, thaw, refreeze }
}

describe('StaticSceneGate', () => {
  it('thaws every target synchronously and refreezes only after the frame countdown', () => {
    const s = makeScene()
    const gate = new StaticSceneGate(s.scene, { watchMeshes: false })
    const a = makeTarget('a')
    const b = makeTarget('b')
    gate.registerTarget(a.target)
    gate.registerTarget(b.target)

    gate.invalidate('ball:spawn')

    expect(a.thaw).toHaveBeenCalledWith({ reason: 'ball:spawn', materials: false, shadows: false })
    expect(b.thaw).toHaveBeenCalledTimes(1)
    expect(a.refreeze).not.toHaveBeenCalled()

    s.frames(FRAMES_BEFORE_REFREEZE - 1)
    expect(a.refreeze).not.toHaveBeenCalled()
    s.frames(1)
    expect(a.refreeze).toHaveBeenCalledTimes(1)
    expect(b.refreeze).toHaveBeenCalledTimes(1)
    expect(gate.refreezeCount).toBe(1)
    expect(gate.state).toBe('frozen')
  })

  it('coalesces a burst of invalidations into one refreeze carrying the union of their flags', () => {
    const s = makeScene()
    const gate = new StaticSceneGate(s.scene, { watchMeshes: false })
    const t = makeTarget()
    gate.registerTarget(t.target)

    gate.invalidate('ball:spawn')
    gate.invalidate('ball:spawn')
    gate.invalidate('quality-tier', { materials: true })
    gate.invalidate('track:build', { shadows: true })
    s.frames(10)

    expect(t.thaw).toHaveBeenCalledTimes(4)
    expect(t.refreeze).toHaveBeenCalledTimes(1)
    expect(t.refreeze).toHaveBeenCalledWith({ reason: 'ball:spawn', materials: true, shadows: true })
    expect(gate.refreezeCount).toBe(1)
  })

  it('restarts the countdown on every invalidation', () => {
    const s = makeScene()
    const gate = new StaticSceneGate(s.scene, { watchMeshes: false })
    const t = makeTarget()
    gate.registerTarget(t.target)

    gate.invalidate('a')
    s.frames(FRAMES_BEFORE_REFREEZE - 1)
    gate.invalidate('b')
    s.frames(FRAMES_BEFORE_REFREEZE - 1)
    expect(t.refreeze).not.toHaveBeenCalled()
    s.frames(1)
    expect(t.refreeze).toHaveBeenCalledTimes(1)
  })

  it('does not refreeze again until something invalidates again', () => {
    const s = makeScene()
    const gate = new StaticSceneGate(s.scene, { watchMeshes: false })
    const t = makeTarget()
    gate.registerTarget(t.target)
    gate.invalidate('a')
    s.frames(20)
    expect(gate.refreezeCount).toBe(1)
    expect(s.afterRender.observers).toHaveLength(0)
  })

  describe('hold', () => {
    it('keeps the scene thawed until released, then refreezes once', () => {
      const s = makeScene()
      const gate = new StaticSceneGate(s.scene, { watchMeshes: false })
      const t = makeTarget()
      gate.registerTarget(t.target)

      const release = gate.hold('cabinet:load', { materials: true, shadows: true })
      s.frames(50)
      expect(t.refreeze).not.toHaveBeenCalled()
      expect(gate.state).toBe('thawed')
      expect(gate.getStats().holds).toBe(1)

      release()
      release() // idempotent
      s.frames(FRAMES_BEFORE_REFREEZE)
      expect(t.refreeze).toHaveBeenCalledTimes(1)
      expect(t.refreeze).toHaveBeenCalledWith({ reason: 'cabinet:load', materials: true, shadows: true })
    })

    it('needs every outstanding hold released', () => {
      const s = makeScene()
      const gate = new StaticSceneGate(s.scene, { watchMeshes: false })
      const t = makeTarget()
      gate.registerTarget(t.target)
      const a = gate.hold('a')
      const b = gate.hold('b')
      a()
      s.frames(10)
      expect(t.refreeze).not.toHaveBeenCalled()
      b()
      s.frames(FRAMES_BEFORE_REFREEZE)
      expect(t.refreeze).toHaveBeenCalledTimes(1)
    })

    it('a hold taken after arming stops the pending refreeze', () => {
      const s = makeScene()
      const gate = new StaticSceneGate(s.scene, { watchMeshes: false })
      const t = makeTarget()
      gate.registerTarget(t.target)
      gate.invalidate('a')
      s.frames(1)
      const release = gate.hold('b')
      s.frames(10)
      expect(t.refreeze).not.toHaveBeenCalled()
      release()
      s.frames(FRAMES_BEFORE_REFREEZE)
      expect(t.refreeze).toHaveBeenCalledTimes(1)
    })
  })

  describe('EventBus windows', () => {
    it.each([
      ['fever:start', 'fever:end'],
      ['jackpot:start', 'jackpot:end'],
      ['multiball:start', 'multiball:end'],
    ] as const)('%s holds the scene thawed until %s', (start, end) => {
      const s = makeScene()
      const bus = new EventBus()
      const gate = new StaticSceneGate(s.scene, { watchMeshes: false, eventBus: bus })
      const t = makeTarget()
      gate.registerTarget(t.target)

      bus.emit(start as never, {} as never)
      s.frames(100)
      expect(t.refreeze).not.toHaveBeenCalled()
      expect(gate.getStats().lastReason).toBe(start)

      bus.emit(end as never, {} as never)
      s.frames(FRAMES_BEFORE_REFREEZE)
      expect(t.refreeze).toHaveBeenCalledTimes(1)
    })

    it('treats a repeated start as one window and ignores an unmatched end', () => {
      const s = makeScene()
      const bus = new EventBus()
      const gate = new StaticSceneGate(s.scene, { watchMeshes: false, eventBus: bus })
      bus.emit('fever:end')
      expect(gate.getStats().holds).toBe(0)
      bus.emit('fever:start')
      bus.emit('fever:start')
      expect(gate.getStats().holds).toBe(1)
      bus.emit('fever:end')
      expect(gate.getStats().holds).toBe(0)
    })

    it('keeps independent windows independent', () => {
      const s = makeScene()
      const bus = new EventBus()
      const gate = new StaticSceneGate(s.scene, { watchMeshes: false, eventBus: bus })
      bus.emit('fever:start')
      bus.emit('jackpot:start')
      bus.emit('fever:end')
      expect(gate.getStats().holds).toBe(1)
    })
  })

  describe('mesh watchers', () => {
    it('thaws when a mesh is added or removed', () => {
      const s = makeScene()
      const gate = new StaticSceneGate(s.scene)
      const t = makeTarget()
      gate.registerTarget(t.target)
      s.meshAdded.notify()
      s.meshRemoved.notify()
      expect(t.thaw.mock.calls.map(([i]) => i.reason)).toEqual(['mesh:added', 'mesh:removed'])
    })

    it('can be turned off', () => {
      const s = makeScene()
      const gate = new StaticSceneGate(s.scene, { watchMeshes: false })
      s.meshAdded.notify()
      expect(gate.getStats().invalidationCount).toBe(0)
    })
  })

  describe('thrash guard', () => {
    const thrash = { maxRefreezes: 3, windowMs: 1000, cooldownMs: 500 }

    it('stops refreezing after too many refreezes in the window, and resumes once quiet', () => {
      const s = makeScene()
      let now = 0
      const gate = new StaticSceneGate(s.scene, { watchMeshes: false, now: () => now, thrash })
      const t = makeTarget()
      gate.registerTarget(t.target)

      for (let i = 0; i < 3; i++) {
        gate.invalidate('churn')
        s.frames(FRAMES_BEFORE_REFREEZE)
        now += 100
      }
      expect(gate.refreezeCount).toBe(3)

      // The fourth would be one too many inside the window: suspend instead.
      gate.invalidate('churn')
      s.frames(FRAMES_BEFORE_REFREEZE)
      expect(gate.refreezeCount).toBe(3)
      expect(gate.state).toBe('suspended')

      // Still inside the cooldown: stays thawed however many frames pass.
      now += 300
      s.frames(20)
      expect(gate.refreezeCount).toBe(3)

      // Cooldown over: refreezes.
      now += 300
      s.frames(FRAMES_BEFORE_REFREEZE + 1)
      expect(gate.refreezeCount).toBe(4)
      expect(gate.state).toBe('frozen')
    })

    it('keeps extending the cooldown while invalidations keep arriving', () => {
      const s = makeScene()
      let now = 0
      const gate = new StaticSceneGate(s.scene, { watchMeshes: false, now: () => now, thrash })
      for (let i = 0; i < 3; i++) {
        gate.invalidate('churn')
        s.frames(FRAMES_BEFORE_REFREEZE)
      }
      gate.invalidate('churn')
      s.frames(FRAMES_BEFORE_REFREEZE)
      expect(gate.state).toBe('suspended')

      for (let i = 0; i < 10; i++) {
        now += 400 // less than the 500 ms cooldown
        gate.invalidate('still churning')
        s.frames(FRAMES_BEFORE_REFREEZE)
      }
      expect(gate.state).toBe('suspended')
      expect(gate.refreezeCount).toBe(3)
    })
  })

  it('reports per-reason counts most frequent first', () => {
    const s = makeScene()
    const gate = new StaticSceneGate(s.scene, { watchMeshes: false })
    gate.invalidate('b')
    gate.invalidate('a')
    gate.invalidate('a')
    const stats = gate.getStats()
    expect(stats.reasons).toEqual([['a', 2], ['b', 1]])
    expect(stats.invalidationCount).toBe(3)
    expect(stats.lastReason).toBe('a')
  })

  it('unregisters targets', () => {
    const s = makeScene()
    const gate = new StaticSceneGate(s.scene, { watchMeshes: false })
    const t = makeTarget()
    const unregister = gate.registerTarget(t.target)
    unregister()
    gate.invalidate('x')
    s.frames(5)
    expect(t.thaw).not.toHaveBeenCalled()
    expect(t.refreeze).not.toHaveBeenCalled()
  })

  it('dispose removes every observer and ignores later calls', () => {
    const s = makeScene()
    const bus = new EventBus()
    const gate = new StaticSceneGate(s.scene, { eventBus: bus })
    const t = makeTarget()
    gate.registerTarget(t.target)
    gate.invalidate('x')
    bus.emit('fever:start')

    gate.dispose()

    expect(s.afterRender.observers).toHaveLength(0)
    expect(s.meshAdded.observers).toHaveLength(0)
    expect(s.meshRemoved.observers).toHaveLength(0)
    bus.emit('fever:start')
    gate.invalidate('late')
    s.frames(10)
    expect(t.refreeze).not.toHaveBeenCalled()
    expect(gate.getStats().invalidationCount).toBe(2) // 'x' and the first fever:start
  })
})
