/**
 * Daily Cascade share links: `?cascade=daily` or `?cascade=<hex seed>`.
 *
 * Separate from the challenge params (`?seed=` / `?challenge=`, decimal, owned
 * by src/replay/challenge-system.ts): the cascade param picks the table layout,
 * a challenge seeds the session RNG, and a link may carry both.
 */

export type CascadeLink = { mode: 'daily' } | { mode: 'free'; seed: number }

const HEX_SEED = /^[0-9a-f]{1,8}$/i

/** Parse a query string; anything that is not a valid cascade param is ignored. */
export function parseCascadeParam(search: string): CascadeLink | null {
  const raw = new URLSearchParams(search).get('cascade')?.trim()
  if (!raw) return null
  if (raw.toLowerCase() === 'daily') return { mode: 'daily' }
  if (HEX_SEED.test(raw)) return { mode: 'free', seed: parseInt(raw, 16) >>> 0 }
  return null
}

function baseUrl(): string {
  return typeof window !== 'undefined' && window.location
    ? `${window.location.origin}${window.location.pathname}`
    : 'https://pachinball.example/'
}

/**
 * Link that opens this exact machine. A daily machine is shared by its seed
 * too, so the link still opens the same table after the day rolls over.
 */
export function createCascadeShareUrl(seed: number, base = baseUrl()): string {
  return `${base}?cascade=${(seed >>> 0).toString(16)}`
}
