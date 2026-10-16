/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTimerScope } from '../src/core/timers'
import { CheckpointDebugController } from '../src/game/checkpoint-debug'
import { BOOT_STALL_MS, armBootWatchdog, describeProgress, showBootFailure, watchPreGame } from '../src/game/boot-error'
import {
  BOOT_PRELOAD_STAGE,
  bootErrorMessage,
  revealBootBanner,
  revealBootFailure,
  setStartButtonEnabled,
} from '../src/game/game-ui-popups'

/** The real static markup, so the banner contract with index.html is tested, not a copy of it. */
function loadIndexBody(): void {
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8')
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? ''
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '')
}

const banner = (): HTMLElement => document.getElementById('boot-error') as HTMLElement
const startBtn = (): HTMLButtonElement => document.getElementById('start-btn') as HTMLButtonElement

const makeDebug = () =>
  new CheckpointDebugController({
    search: '',
    storage: { getItem: () => null, setItem: () => undefined },
    documentRef: null,
    historyRef: null,
    locationRef: null,
  })

let logSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  loadIndexBody()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('describeProgress', () => {
  it('says so before any stage has started', () => {
    expect(describeProgress(makeDebug())).toBe('no stage started')
  })

  it('names every stage still loading (what a stalled boot is waiting on)', async () => {
    const debug = makeDebug()
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })

    const first = debug.runStage('physics', () => gate)
    const second = debug.runStage('scene_rendering', () => gate)
    expect(describeProgress(debug)).toBe('physics (Physics world init), scene_rendering (Scene rendering systems)')

    release()
    await Promise.all([first, second])
    expect(logSpy).toHaveBeenCalled()
  })

  it('falls back to the last stage that began once nothing is loading, including a failed one', async () => {
    const debug = makeDebug()

    await debug.runStage('settings_ui', () => undefined)
    await expect(
      debug.runStage('physics', () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(describeProgress(debug)).toBe('physics (Physics world init)')
  })
})

describe('boot failure banner (#449)', () => {
  it('ships hidden, with Start disabled and a ?renderer=webgl2 link', () => {
    expect(banner().hidden).toBe(true)
    expect(startBtn().disabled).toBe(true)
    expect(banner().querySelector('a')?.getAttribute('href')).toBe('?renderer=webgl2')
  })

  it('shows the message and the stage that was running', async () => {
    const debug = makeDebug()
    await expect(
      debug.runStage('physics', () => {
        throw new Error('Physics not ready')
      }),
    ).rejects.toThrow()

    showBootFailure(new Error('Physics not ready'), { checkpointDebug: debug })

    expect(banner().hidden).toBe(false)
    expect(banner().children[0]?.textContent).toBe('Game failed to start')
    expect(banner().children[1]?.textContent).toBe('Physics not ready')
    expect(banner().children[2]?.textContent).toBe('Stage: physics (Physics world init)')
  })

  it('puts Start in its failed state: disabled, "Load failed", tooltip = message', () => {
    showBootFailure(new Error('WebGL2 is not supported on this device'))

    expect(startBtn().disabled).toBe(true)
    expect(startBtn().textContent).toBe('Load failed')
    expect(startBtn().title).toBe('WebGL2 is not supported on this device')
  })

  it('names the pre-Game phase when no Game exists yet, and stringifies non-Errors', () => {
    showBootFailure('plain string')

    expect(banner().children[1]?.textContent).toBe('plain string')
    expect(banner().children[2]?.textContent).toBe('Stage: engine + physics preload')
  })

  it('setStartButtonEnabled keeps the loading tooltip and label when no error is given', () => {
    setStartButtonEnabled(false)

    expect(startBtn().title).toBe('Loading cabinet…')
    expect(startBtn().textContent).toBe('Start Game')
  })
})

describe('failure reveal without the lazy chunk (#449)', () => {
  it('shows the message, stage and "Load failed" using only entry-resident code', () => {
    revealBootFailure(new Error('physics init failed'), 'physics (Physics world init)')

    expect(banner().hidden).toBe(false)
    expect(banner().children[0]?.textContent).toBe('Game failed to start')
    expect(banner().children[1]?.textContent).toBe('physics init failed')
    expect(banner().children[2]?.textContent).toBe('Stage: physics (Physics world init)')
    expect(startBtn().disabled).toBe(true)
    expect(startBtn().textContent).toBe('Load failed')
    expect(startBtn().title).toBe('physics init failed')
  })

  it('gives an empty error a visible message and still flips Start (new Error())', () => {
    revealBootFailure(new Error(), BOOT_PRELOAD_STAGE)

    expect(banner().children[1]?.textContent).toBe('Unknown error')
    expect(startBtn().textContent).toBe('Load failed')
    expect(startBtn().title).toBe('Unknown error')
  })

  it('blanks the stage line when the stage is not known yet', () => {
    revealBootFailure(new Error('boom'), '')

    expect(banner().children[2]?.textContent).toBe('')
  })

  it('the lazy chunk can refine the stage line afterwards', () => {
    revealBootFailure(new Error('boom'), '')

    showBootFailure(new Error('boom'), { checkpointDebug: makeDebug() })

    expect(banner().children[2]?.textContent).toBe('Stage: no stage started')
    expect(startBtn().textContent).toBe('Load failed')
  })

  it('bootErrorMessage covers Errors, strings, empty and odd values', () => {
    expect(bootErrorMessage(new Error('x'))).toBe('x')
    expect(bootErrorMessage('plain')).toBe('plain')
    expect(bootErrorMessage(new Error())).toBe('Unknown error')
    expect(bootErrorMessage('')).toBe('Unknown error')
    expect(bootErrorMessage(undefined)).toBe('undefined')
  })

  it('revealBootBanner is a no-op when the markup is absent', () => {
    document.body.innerHTML = ''

    expect(() => revealBootBanner('t', 'm', 's')).not.toThrow()
  })
})

describe('boot watchdog (#452)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockReturnValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the loading stage when Start is still disabled after 30 s', () => {
    armBootWatchdog(createTimerScope(), () => 'scene_critical (Critical scene geometry)')

    vi.advanceTimersByTime(BOOT_STALL_MS - 1)
    expect(banner().hidden).toBe(true)

    vi.advanceTimersByTime(1)
    expect(banner().hidden).toBe(false)
    expect(banner().children[0]?.textContent).toBe('Still loading…')
    expect(banner().children[2]?.textContent).toBe('Stage: scene_critical (Critical scene geometry)')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('scene_critical'))
    // A stall, not a failure: Start keeps its label.
    expect(startBtn().textContent).toBe('Start Game')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('counts from page load: arms with the time left, not a fresh 30 s', () => {
    vi.mocked(performance.now).mockReturnValue(26_000)
    armBootWatchdog(createTimerScope(), () => 'physics')

    vi.advanceTimersByTime(3_999)
    expect(banner().hidden).toBe(true)
    vi.advanceTimersByTime(1)
    expect(banner().hidden).toBe(false)
  })

  it('hides the stall banner once Start enables', () => {
    armBootWatchdog(createTimerScope(), () => 'physics')
    vi.advanceTimersByTime(BOOT_STALL_MS)
    expect(banner().hidden).toBe(false)

    setStartButtonEnabled(true)

    expect(banner().hidden).toBe(true)
    expect(startBtn().disabled).toBe(false)
  })

  it('stays quiet when Start was enabled in time', () => {
    armBootWatchdog(createTimerScope(), () => 'x')
    setStartButtonEnabled(true)

    vi.advanceTimersByTime(BOOT_STALL_MS)
    expect(banner().hidden).toBe(true)
  })

  it('does not overwrite a failure banner that got there first', () => {
    armBootWatchdog(createTimerScope(), () => 'x')
    showBootFailure(new Error('boom'))

    vi.advanceTimersByTime(BOOT_STALL_MS)
    expect(banner().children[0]?.textContent).toBe('Game failed to start')
    expect(banner().children[1]?.textContent).toBe('boom')
  })

  it('is cancelled by disposing the owning scope (Game.dispose)', () => {
    const timers = createTimerScope()
    armBootWatchdog(timers, () => 'x')

    timers.dispose()
    vi.advanceTimersByTime(BOOT_STALL_MS * 2)

    expect(banner().hidden).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('pre-Game watchdog (#452)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockReturnValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('names the preload phase when engine creation / physics preload never settles', () => {
    watchPreGame(new Promise(() => undefined))

    vi.advanceTimersByTime(BOOT_STALL_MS)

    expect(banner().hidden).toBe(false)
    expect(banner().children[0]?.textContent).toBe('Still loading…')
    expect(banner().children[2]?.textContent).toBe('Stage: engine + physics preload')
  })

  it('is disarmed once the preload resolves', async () => {
    watchPreGame(Promise.resolve())
    await Promise.resolve()

    vi.advanceTimersByTime(BOOT_STALL_MS * 2)

    expect(banner().hidden).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('is disarmed when the preload rejects, so the failure banner is not overwritten', async () => {
    const failed = Promise.reject(new Error('no adapter'))
    watchPreGame(failed)
    await failed.catch(() => undefined)
    showBootFailure(new Error('no adapter'))

    vi.advanceTimersByTime(BOOT_STALL_MS * 2)

    expect(banner().children[0]?.textContent).toBe('Game failed to start')
    expect(vi.getTimerCount()).toBe(0)
  })
})
