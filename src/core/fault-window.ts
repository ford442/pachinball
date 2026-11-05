/**
 * Sliding fault window shared by the frame scheduler and the EventBus (#503 A3): a caller that
 * throws on `FAULT_WINDOW_LIMIT` of the last `FAULT_WINDOW_SIZE` ticks is quarantined. A plain
 * "K consecutive" count never trips on something that throws every other frame.
 *
 * State is two numbers, touched only when a throw happens, so the success path costs nothing.
 */

export const FAULT_WINDOW_SIZE = 8
export const FAULT_WINDOW_LIMIT = 3

export interface FaultWindow {
  /** Bit i set: a throw `i` ticks before `lastTick`. */
  mask: number
  /** Tick of the most recent throw (-Infinity before the first). */
  lastTick: number
}

export function createFaultWindow(): FaultWindow {
  return { mask: 0, lastTick: Number.NEGATIVE_INFINITY }
}

function popcount8(n: number): number {
  let c = 0
  for (let v = n & 0xff; v !== 0; v &= v - 1) c++
  return c
}

/** Record a throw at `tick` (monotonic per owner). True when the window is now over the limit. */
export function recordFault(window: FaultWindow, tick: number): boolean {
  const gap = tick - window.lastTick
  if (gap >= FAULT_WINDOW_SIZE || !Number.isFinite(gap)) window.mask = 1
  else if (gap > 0) window.mask = ((window.mask << gap) | 1) & 0xff
  else window.mask |= 1
  window.lastTick = tick
  return popcount8(window.mask) >= FAULT_WINDOW_LIMIT
}

/** Short message for logs / events, never throwing on odd values. */
export function faultMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return 'unknown error'
  }
}
