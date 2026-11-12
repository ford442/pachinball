/**
 * Console output that survives the production build (#449). The build strips literal
 * `console.log` / `console.info` / `console.debug` calls (esbuild `pure`), so a boot failure
 * logged through them would leave DevTools empty. These reach `globalThis.console`, which the
 * strip does not match. Use them only for boot-critical diagnostics.
 *
 * Every line is also kept in a 50-line ring (`recentBootLog()`), so the error reporter (#503 A5)
 * can attach the context that led up to a failure.
 */

export interface BootLogLine {
  readonly level: 'warn' | 'error'
  /** `Date.now()` — diagnostics only, never gameplay. */
  readonly at: number
  readonly text: string
}

const RING_SIZE = 50
const ring: BootLogLine[] = []

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function remember(level: BootLogLine['level'], args: readonly unknown[]): void {
  try {
    ring.push({ level, at: Date.now(), text: args.map(describe).join(' ').slice(0, 2000) })
    if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE)
  } catch {
    // Diagnostics must never throw into the caller.
  }
}

export const bootWarn = (...args: unknown[]): void => {
  remember('warn', args)
  globalThis.console.warn(...args)
}

export const bootError = (...args: unknown[]): void => {
  remember('error', args)
  globalThis.console.error(...args)
}

/** The last 50 `bootWarn` / `bootError` lines, oldest first (a copy). */
export function recentBootLog(): BootLogLine[] {
  return ring.slice()
}

/** @internal Vitest. Not called by `disposeGame`: the ring is diagnostics that should span Games. */
export function resetBootLog(): void {
  ring.length = 0
}
