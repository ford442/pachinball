/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTimerScope } from '../src/core/timers'
import { BOOT_STALL_MS, armBootWatchdog, showBootError } from '../src/game/boot-error'
import { setStartButtonEnabled } from '../src/game/game-ui-popups'

/** The real static markup, so the banner contract with index.html is tested, not a copy of it. */
function loadIndexBody(): void {
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8')
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? ''
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '')
}

const banner = (): HTMLElement => document.getElementById('boot-error') as HTMLElement
const startBtn = (): HTMLButtonElement => document.getElementById('start-btn') as HTMLButtonElement

describe('boot error banner (#449)', () => {
  beforeEach(() => {
    loadIndexBody()
  })

  it('ships hidden, with Start disabled and a ?renderer=webgl2 link', () => {
    expect(banner().hidden).toBe(true)
    expect(startBtn().disabled).toBe(true)
    expect(banner().querySelector('a')?.getAttribute('href')).toBe('?renderer=webgl2')
  })

  it('shows the message and the stage', () => {
    showBootError('Game failed to start', 'Physics not ready', 'physics (Physics world init)')

    expect(banner().hidden).toBe(false)
    expect(banner().children[0]?.textContent).toBe('Game failed to start')
    expect(banner().children[1]?.textContent).toBe('Physics not ready')
    expect(banner().children[2]?.textContent).toBe('Stage: physics (Physics world init)')
  })

  it('a failure puts Start in its error state: disabled, "Load failed", tooltip = message', () => {
    showBootError('Game failed to start', 'WebGL2 is not supported', 'engine + physics preload', true)

    expect(startBtn().disabled).toBe(true)
    expect(startBtn().textContent).toBe('Load failed')
    expect(startBtn().title).toBe('WebGL2 is not supported')
    expect(startBtn().dataset.state).toBe('error')
  })

  it('a stall banner leaves the Start label alone', () => {
    showBootError('Still loading…', 'slow', 'physics')

    expect(startBtn().textContent).toBe('Start Game')
    expect(startBtn().dataset.state).toBeUndefined()
  })

  it('hides a stall banner once Start is enabled', () => {
    showBootError('Still loading…', 'slow', 'physics')
    setStartButtonEnabled(true)

    expect(banner().hidden).toBe(true)
    expect(startBtn().disabled).toBe(false)
  })

  it('setStartButtonEnabled keeps the loading tooltip when no error is given', () => {
    setStartButtonEnabled(false)

    expect(startBtn().title).toBe('Loading cabinet…')
    expect(startBtn().textContent).toBe('Start Game')
  })
})

describe('boot watchdog (#452)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    loadIndexBody()
    vi.useFakeTimers()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    warnSpy.mockRestore()
  })

  it('shows the loading stage when Start is still disabled after 30 s', () => {
    const timers = createTimerScope()
    armBootWatchdog(timers, BOOT_STALL_MS, () => 'scene_critical (Critical scene geometry)')

    vi.advanceTimersByTime(BOOT_STALL_MS - 1)
    expect(banner().hidden).toBe(true)

    vi.advanceTimersByTime(1)
    expect(banner().hidden).toBe(false)
    expect(banner().children[0]?.textContent).toBe('Still loading…')
    expect(banner().children[2]?.textContent).toBe('Stage: scene_critical (Critical scene geometry)')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('scene_critical'))
    // Still a stall, not a failure: Start keeps its label.
    expect(startBtn().textContent).toBe('Start Game')
  })

  it('stays quiet when Start was enabled in time', () => {
    armBootWatchdog(createTimerScope(), BOOT_STALL_MS, () => 'x')
    setStartButtonEnabled(true)

    vi.advanceTimersByTime(BOOT_STALL_MS)
    expect(banner().hidden).toBe(true)
  })

  it('does not overwrite a failure banner that got there first', () => {
    armBootWatchdog(createTimerScope(), BOOT_STALL_MS, () => 'x')
    showBootError('Game failed to start', 'boom', 'physics', true)

    vi.advanceTimersByTime(BOOT_STALL_MS)
    expect(banner().children[0]?.textContent).toBe('Game failed to start')
    expect(banner().children[1]?.textContent).toBe('boom')
  })

  it('is cancelled by disposing the owning scope (Game.dispose)', () => {
    const timers = createTimerScope()
    armBootWatchdog(timers, BOOT_STALL_MS, () => 'x')

    timers.dispose()
    vi.advanceTimersByTime(BOOT_STALL_MS * 2)

    expect(banner().hidden).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('arms with the time left when bootstrap already spent some of the budget', () => {
    const timers = createTimerScope()
    armBootWatchdog(timers, 4_000, () => 'physics')

    vi.advanceTimersByTime(3_999)
    expect(banner().hidden).toBe(true)
    vi.advanceTimersByTime(1)
    expect(banner().hidden).toBe(false)
  })
})
