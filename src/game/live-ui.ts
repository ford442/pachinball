/**
 * Live spectate in the game (#444 Slice E): the opt-in broadcast switch and
 * the ● LIVE badge, the start screen's Watch live list, `?live=<id>` links,
 * and the banner while spectating. Loaded lazily after boot; the broadcaster
 * and the spectator load only when used.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { Observer } from '@babylonjs/core/Misc/observable'
import { peekAudioEngine } from '../audio/audio-engine'
import { arcadeEnabled } from '../config/arcade'
import { BallType } from '../config/balls'
import { TABLE_MAPS } from '../config/table-maps'
import { GameState } from '../game-elements/types'
import type { ReplayRecorder } from '../replay/replay-recorder'
import type { ReplayRunner } from '../replay/replay-runner'
import type { GhostBallRenderer } from '../replay/ghost-ball-renderer'
import type { WasmSimEngine } from '../wasm/wasm-sim-engine'
import type { LiveBroadcast, LiveArcade, LiveBroadcastStatus } from '../arcade/live-broadcast'
import type { LiveSpectator, LiveSpectateArcade, LiveSpectateHost } from '../replay/live-spectate'
import type { LiveRun } from '../arcade/arcade-api'
import type { StepInputActions } from './physics/physics-controller'

const PREF_KEY = 'pachinball:live-broadcast'
const TAG_KEY = 'pachinball:live-tag'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BALL_TYPES = [BallType.STANDARD, BallType.GOLD_PLATED, BallType.SOLID_GOLD]

/** What the game provides (Game implements it). */
export interface LiveUIHost {
  readonly signal: AbortSignal
  readonly scene: Scene | null
  readonly replayRecorder: ReplayRecorder
  readonly replayRunner: ReplayRunner
  readonly physicsController: { stepFixed(input: null, actions: StepInputActions | null, runner: ReplayRunner, recorder: null): void } | null
  readonly inputActions: StepInputActions | null
  readonly physics: { getWasmEngine(): WasmSimEngine | null }
  readonly ballManager: {
    getBallBody(): { translation(): { x: number; y: number; z: number } } | null
    getBallMeshesByType(type: BallType): Array<{ isVisible: boolean }>
  } | null
  readonly stateManager: { isPlaying(): boolean }
  readonly ghostBallRenderer: GhostBallRenderer | null
  readonly currentMapId?: string | null
  readonly score: number
  afterFixedStep: (() => void) | null
  switchTableMap(mapName: string): void
  playReplay(raw: object, streaming?: boolean): Promise<unknown>
  setGameState(state: GameState): void
  showMessage(msg: string, duration: number): void
  addDisposeHook(reset: () => void): void
}

type LiveArcadeApi = LiveArcade & LiveSpectateArcade & Pick<typeof import('../arcade/arcade-api'), 'fetchLiveRuns'>

let override: LiveArcadeApi | null = null

async function liveArcade(): Promise<LiveArcadeApi | null> {
  if (override) return override
  return arcadeEnabled() ? import('../arcade/arcade-api') : null
}

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStore(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage disabled: the setting lasts for this page only.
  }
}

function readTag(): string | null {
  const tag = readStore(TAG_KEY)
  return tag && /^[A-Z]{3}$/.test(tag) ? tag : null
}

function clock(steps: number): string {
  const s = Math.floor(steps / 60)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

export function startLiveUI(host: LiveUIHost): LiveUI {
  const ui = new LiveUI(host)
  host.addDisposeHook(() => ui.dispose())
  return ui
}

export class LiveUI {
  private broadcast: LiveBroadcast | null = null
  private spectator: LiveSpectator | null = null
  private readonly observer: Observer<Scene> | null
  private badge: HTMLElement | null = null
  private banner: HTMLElement | null = null
  private list: HTMLElement | null = null
  private savedVolume: number | null = null
  private fastForward = false

  constructor(private readonly host: LiveUIHost) {
    host.afterFixedStep = () => {
      this.broadcast?.onStep()
      this.spectator?.onStep()
    }
    this.observer = host.scene?.onBeforeRenderObservable.add(() => this.onFrame()) ?? null
    const { signal } = host

    const toggle = document.getElementById('live-broadcast-toggle') as HTMLInputElement | null
    if (toggle) {
      toggle.checked = readStore(PREF_KEY) === '1'
      toggle.addEventListener('change', () => void this.setBroadcasting(toggle.checked), { signal })
    }
    const tagInput = document.getElementById('live-tag-input') as HTMLInputElement | null
    if (tagInput) {
      tagInput.value = readTag() ?? ''
      tagInput.addEventListener('input', () => {
        const tag = tagInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
        tagInput.value = tag
        writeStore(TAG_KEY, tag.length === 3 ? tag : null)
      }, { signal })
    }
    document.getElementById('live-btn')?.addEventListener('click', () => void this.openList(), { signal })

    if (readStore(PREF_KEY) === '1') void this.setBroadcasting(true)
    const live = new URLSearchParams(location.search).get('live')
    if (live && UUID.test(live)) void this.spectate(live)
  }

  /** Tests: the arcade service live spectate talks to (otherwise the real one, which dev builds keep offline). */
  useArcade(api: LiveArcadeApi | null): void {
    override = api
  }

  // ------------------------------------------------------------- broadcast

  /** Opt in or out of streaming this player's runs. */
  async setBroadcasting(on: boolean): Promise<void> {
    writeStore(PREF_KEY, on ? '1' : null)
    if (on && !this.broadcast) {
      const api = await liveArcade()
      if (!api) {
        this.host.showMessage('Live spectate needs the arcade service (offline in this build)', 3500)
        return
      }
      const { LiveBroadcast } = await import('../arcade/live-broadcast')
      if (this.broadcast) return
      const host = this.host
      this.broadcast = new LiveBroadcast({
        replayRecorder: host.replayRecorder,
        get score() { return host.score },
        stateHash: () => this.stateHash(),
        ballPosition: () => host.ballManager?.getBallBody()?.translation() ?? null,
      }, api, { tag: readTag, signal: host.signal })
      this.broadcast.onStatus = (status) => this.renderBadge(status)
    }
    this.broadcast?.setEnabled(on)
  }

  getBroadcast(): LiveBroadcast | null {
    return this.broadcast
  }

  private renderBadge(status: LiveBroadcastStatus): void {
    const show = status === 'connecting' || status === 'live' || status === 'offline'
    if (!show) {
      this.badge?.remove()
      this.badge = null
      return
    }
    if (!this.badge) {
      this.badge = el('button', 'live-badge')
      this.badge.title = 'Copy a link to watch this game live'
      this.badge.addEventListener('click', () => void this.copyWatchLink(), { signal: this.host.signal })
      ;(document.getElementById('game-cabinet') ?? document.body).appendChild(this.badge)
    }
    this.badge.classList.toggle('offline', status === 'offline')
    this.badge.textContent = status === 'offline' ? '● LIVE · reconnecting' : '● LIVE'
  }

  private async copyWatchLink(): Promise<void> {
    const id = this.broadcast?.getLiveId()
    if (!id) return
    const link = `${location.origin}${location.pathname}?live=${id}`
    try {
      await navigator.clipboard.writeText(link)
      this.host.showMessage('Watch link copied', 2500)
    } catch {
      prompt('Watch link:', link)
    }
  }

  // ------------------------------------------------------------- spectate

  /** Watch a live run. */
  async spectate(liveId: string): Promise<boolean> {
    this.closeList()
    this.endSpectate()
    const api = await liveArcade()
    if (!api) {
      this.host.showMessage('Live spectate needs the arcade service (offline in this build)', 3500)
      return false
    }
    const { LiveSpectator } = await import('../replay/live-spectate')
    const spectator = new LiveSpectator(this.spectateHost(), api)
    this.spectator = spectator
    spectator.onChange = () => this.renderBanner()
    this.renderBanner()
    return spectator.join(liveId)
  }

  getSpectator(): LiveSpectator | null {
    return this.spectator
  }

  private spectateHost(): LiveSpectateHost {
    const host = this.host
    return {
      replayRunner: host.replayRunner,
      get physicsController() { return host.physicsController },
      get inputActions() { return host.inputActions },
      get score() { return host.score },
      get currentMapId() { return host.currentMapId },
      isPlaying: () => host.stateManager.isPlaying(),
      switchTableMap: (map) => host.switchTableMap(map),
      playReplay: (raw, streaming) => host.playReplay(raw, streaming),
      stateHash: () => this.stateHash(),
      setFastForward: (on) => this.setFastForward(on),
      placeGhost: (pos) => {
        const ghost = host.ghostBallRenderer
        if (!ghost) return
        if (pos === null) {
          ghost.hide()
          return
        }
        ghost.show()
        if (pos) ghost.updatePosition(pos)
      },
      stopSpectating: () => {
        host.replayRunner.stop()
        host.ghostBallRenderer?.hide()
        if (host.stateManager.isPlaying()) host.setGameState(GameState.MENU)
      },
    }
  }

  private stateHash(): string | null {
    const hash = this.host.physics.getWasmEngine()?.getStateHash()
    return typeof hash === 'string' ? hash : null
  }

  /** Fast-forwarding: the game's balls hidden (the ghost shows the live ball) and its sound muted. */
  private setFastForward(on: boolean): void {
    this.fastForward = on
    const master = peekAudioEngine()?.masterGain.gain
    if (master) {
      if (on && this.savedVolume === null) {
        this.savedVolume = master.value
        master.value = 0
      } else if (!on && this.savedVolume !== null) {
        master.value = this.savedVolume
        this.savedVolume = null
      }
    }
    if (!on) this.setBallsVisible(true)
  }

  private setBallsVisible(visible: boolean): void {
    for (const type of BALL_TYPES) {
      for (const mesh of this.host.ballManager?.getBallMeshesByType(type) ?? []) mesh.isVisible = visible
    }
  }

  private onFrame(): void {
    if (!this.spectator) return
    this.spectator.pump()
    // Balls can appear while fast-forwarding (multiball), so hide them every frame.
    if (this.fastForward) this.setBallsVisible(false)
    if (this.banner) this.renderBanner()
  }

  private endSpectate(): void {
    this.spectator?.leave()
    this.spectator?.dispose()
    this.spectator = null
    this.banner?.remove()
    this.banner = null
  }

  private renderBanner(): void {
    const s = this.spectator
    if (!s) return
    if (!this.banner) {
      this.banner = el('div', 'live-banner')
      this.banner.setAttribute('role', 'status')
      document.body.appendChild(this.banner)
    }
    const run = s.getRun()
    const who = run?.player_tag ?? 'Player'
    const state = s.getState()
    const checks = s.stats.checked ? ` · ✓ ${s.stats.matched}/${s.stats.checked}` : ''
    const text: Record<typeof state, string> = {
      joining: 'Joining live run…',
      'catching-up': `${who} · catching up ${Math.floor(s.getProgress() * 100)}%`,
      live: `${who} · ${this.host.score.toLocaleString()}${checks}`,
      waiting: `Waiting for ${who}…${checks}`,
      reconnecting: `Reconnecting…${checks}`,
      ended: `${s.getReason()} · ${who} scored ${s.getLiveScore().toLocaleString()}${checks}`,
      desynced: `${s.getReason()} — stopped`,
      failed: s.getReason() || 'Could not watch that run',
      left: '',
    }
    const terminal = state === 'ended' || state === 'desynced' || state === 'failed' || state === 'left'
    const key = `${state}|${text[state]}`
    if (this.banner.dataset.key === key) return
    this.banner.dataset.key = key
    this.banner.dataset.state = state
    this.banner.replaceChildren()
    if (!terminal) this.banner.appendChild(el('span', 'live-dot', '● LIVE'))
    this.banner.appendChild(el('span', 'live-text', text[state]))
    const button = el('button', 'secondary-btn', terminal ? 'Close' : 'Leave')
    button.addEventListener('click', () => this.endSpectate())
    this.banner.appendChild(button)
  }

  // ------------------------------------------------------------- watch list

  async openList(): Promise<void> {
    this.closeList()
    const overlay = el('div', 'live-list')
    const panel = el('div', 'live-list-panel')
    overlay.appendChild(panel)
    panel.appendChild(el('h2', '', 'Live now'))
    const body = el('div', 'live-list-body', 'Looking…')
    panel.appendChild(body)
    const close = el('button', 'secondary-btn', 'Close')
    close.addEventListener('click', () => this.closeList())
    panel.appendChild(close)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeList() })
    document.body.appendChild(overlay)
    this.list = overlay

    const api = await liveArcade()
    let runs: LiveRun[] | null = null
    try {
      runs = api ? await api.fetchLiveRuns() : null
    } catch {
      runs = null
    }
    if (this.list !== overlay) return
    body.replaceChildren()
    if (!runs) {
      body.textContent = 'The arcade is offline'
      return
    }
    if (!runs.length) {
      body.textContent = 'Nobody is live right now'
      return
    }
    for (const run of runs) {
      const row = el('div', 'live-list-row')
      const table = TABLE_MAPS[run.map_id]?.name ?? run.map_id
      row.appendChild(el('span', '', `${run.player_tag ?? 'Player'} · ${table} · ${run.score.toLocaleString()} · ${clock(run.frames)}`))
      const watch = el('button', 'secondary-btn', 'Watch')
      watch.addEventListener('click', () => void this.spectate(run.id))
      row.appendChild(watch)
      body.appendChild(row)
    }
  }

  private closeList(): void {
    this.list?.remove()
    this.list = null
  }

  dispose(): void {
    this.broadcast?.dispose()
    this.broadcast = null
    this.spectator?.dispose()
    this.spectator = null
    if (this.observer) this.host.scene?.onBeforeRenderObservable.remove(this.observer)
    if (this.host.afterFixedStep) this.host.afterFixedStep = null
    this.setFastForward(false)
    this.badge?.remove()
    this.banner?.remove()
    this.closeList()
  }
}
