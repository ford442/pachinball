/**
 * Production error visibility (#503 A5): uncaught errors and unhandled rejections are logged
 * through `bootError` (which survives the production console strip) and kept, with the boot-log
 * ring that led up to them, for diagnostics (`window.pachinballErrors`) and the pause-menu
 * build line. There is no telemetry endpoint yet; when one exists, `report` is the one place
 * that posts.
 *
 * Installed once per Game under its `signal`, so `game.dispose()` removes the listeners.
 */

import { bootError, recentBootLog, type BootLogLine } from '../boot-log'

export interface ReportedError {
  readonly kind: 'error' | 'unhandledrejection'
  readonly message: string
  readonly stack: string | null
  readonly source: string | null
  /** `Date.now()` — diagnostics only. */
  readonly at: number
  /** The boot-log ring at the time of the error. */
  readonly context: readonly BootLogLine[]
}

const MAX_REPORTS = 20

export interface ErrorReporterTarget {
  addEventListener(type: string, listener: (event: Event) => void, options?: AddEventListenerOptions): void
}

export interface ErrorReporter {
  readonly reports: readonly ReportedError[]
}

function describeReason(reason: unknown): { message: string; stack: string | null } {
  if (reason instanceof Error) return { message: `${reason.name}: ${reason.message}`, stack: reason.stack ?? null }
  try {
    return { message: typeof reason === 'string' ? reason : JSON.stringify(reason) ?? String(reason), stack: null }
  } catch {
    return { message: String(reason), stack: null }
  }
}

export function installErrorReporter(
  signal: AbortSignal,
  target: ErrorReporterTarget = window,
): ErrorReporter {
  const reports: ReportedError[] = []
  const report = (entry: Omit<ReportedError, 'at' | 'context'>): void => {
    const full: ReportedError = { ...entry, at: Date.now(), context: recentBootLog() }
    reports.push(full)
    if (reports.length > MAX_REPORTS) reports.shift()
    bootError(`[ErrorReporter] ${entry.kind}: ${entry.message}`)
  }

  target.addEventListener('error', (event) => {
    const e = event as ErrorEvent
    // Resource load errors (img/script) reach window `error` without an ErrorEvent message.
    if (!(typeof e.message === 'string' && e.message.length > 0) && !(e.error instanceof Error)) return
    const { message, stack } = e.error instanceof Error ? describeReason(e.error) : { message: e.message, stack: null }
    const source = e.filename ? `${e.filename}:${e.lineno ?? 0}:${e.colno ?? 0}` : null
    report({ kind: 'error', message, stack, source })
  }, { signal })

  target.addEventListener('unhandledrejection', (event) => {
    const { message, stack } = describeReason((event as PromiseRejectionEvent).reason)
    report({ kind: 'unhandledrejection', message, stack, source: null })
  }, { signal })

  const reporter: ErrorReporter = { reports }
  if (typeof window !== 'undefined' && target === window) {
    ;(window as unknown as { pachinballErrors?: ErrorReporter }).pachinballErrors = reporter
  }
  return reporter
}
