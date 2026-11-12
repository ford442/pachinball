/** Production error visibility (#503 A5). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootWarn, recentBootLog, resetBootLog } from '../src/boot-log'
import { installErrorReporter } from '../src/engine/error-reporter'

describe('boot-log ring', () => {
  afterEach(() => {
    resetBootLog()
    vi.restoreAllMocks()
  })

  it('keeps the last 50 lines', () => {
    vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 60; i++) bootWarn('line', i)
    const lines = recentBootLog()
    expect(lines).toHaveLength(50)
    expect(lines[0]?.text).toBe('line 10')
    expect(lines.at(-1)?.text).toBe('line 59')
  })
})

describe('installErrorReporter', () => {
  afterEach(() => {
    resetBootLog()
    vi.restoreAllMocks()
  })

  it('records uncaught errors and unhandled rejections with the boot-log context, until the signal aborts', () => {
    vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {})
    const consoleError = vi.spyOn(globalThis.console, 'error').mockImplementation(() => {})
    const target = new EventTarget()
    const controller = new AbortController()
    const reporter = installErrorReporter(controller.signal, target)
    bootWarn('before the crash')

    const error = Object.assign(new Event('error'), { message: 'boom', error: new TypeError('boom'), filename: 'a.js', lineno: 3, colno: 7 })
    target.dispatchEvent(error)
    const rejection = Object.assign(new Event('unhandledrejection'), { reason: new Error('nope') })
    target.dispatchEvent(rejection)
    // A resource load error carries no message: ignored.
    target.dispatchEvent(new Event('error'))

    expect(reporter.reports).toHaveLength(2)
    expect(reporter.reports[0]).toMatchObject({ kind: 'error', message: 'TypeError: boom', source: 'a.js:3:7' })
    expect(reporter.reports[0]?.context.some((l) => l.text === 'before the crash')).toBe(true)
    expect(reporter.reports[1]).toMatchObject({ kind: 'unhandledrejection', message: 'Error: nope' })
    expect(consoleError).toHaveBeenCalled()

    controller.abort()
    target.dispatchEvent(rejection)
    expect(reporter.reports).toHaveLength(2)
  })
})
