/**
 * Per-pair contact debounce keyed by two numeric handles (#505 §D).
 *
 * Replaces `Map<string, number>` keyed by `${lo}_${hi}`: that allocated a template string per
 * Enter and never forgot a pair, so the maps grew with every body pair that ever touched.
 * Handles are compared, never combined into one number: Rapier handles are bit-packed doubles
 * (index + generation), so no arithmetic packing is safe for them.
 *
 * On a monotonic clock the decisions match the old `debounced(last, now)` exactly: a hit is
 * swallowed only when the same pair was stamped less than `windowMs` earlier. An entry at least
 * `windowMs` old can never swallow a later hit, so pruning it changes no outcome.
 *
 * The dispatcher's clock is the physics step count, which only increases; it goes backwards only
 * when the host's physics world is replaced. That is a new timeline, so every stamp is dropped
 * (the old map kept them, and a stale stamp could swallow a hit on the new world).
 */
export class PairDebounce {
  private readonly stamps = new Map<number, Map<number, number>>()
  private entries = 0
  private latest = Number.NEGATIVE_INFINITY

  constructor(
    private readonly windowMs: number,
    /** Sweep inert entries once this many pairs are stored. */
    private readonly pruneAt = 256,
  ) {}

  /**
   * True when this pair was hit within the window (the caller drops the event); otherwise
   * stamps the pair with `now` and returns false.
   */
  hit(a: number, b: number, now: number): boolean {
    if (now < this.latest) this.clear()
    this.latest = now
    const lo = a < b ? a : b
    const hi = a < b ? b : a
    let inner = this.stamps.get(lo)
    const last = inner?.get(hi)
    if (last !== undefined && now - last < this.windowMs) return true

    if (!inner) {
      inner = new Map()
      this.stamps.set(lo, inner)
    }
    if (last === undefined) {
      this.entries++
      if (this.entries > this.pruneAt) {
        inner.set(hi, now)
        this.prune(now)
        return false
      }
    }
    inner.set(hi, now)
    return false
  }

  /** Drop every entry that can no longer debounce a hit at `now`. */
  prune(now: number): void {
    for (const [lo, inner] of this.stamps) {
      for (const [hi, last] of inner) {
        if (now - last >= this.windowMs) {
          inner.delete(hi)
          this.entries--
        }
      }
      if (inner.size === 0) this.stamps.delete(lo)
    }
  }

  clear(): void {
    this.stamps.clear()
    this.entries = 0
    this.latest = Number.NEGATIVE_INFINITY
  }

  /** Stored pairs (tests / diagnostics). */
  get size(): number {
    return this.entries
  }
}
