/**
 * Machine loader (#506 Slice A): resolves the machine a page boots on and maps
 * it onto the parts the `Game` wires today — the cabinet preset the critical
 * scene loads, and the backbox clips `DisplaySystem` plays per `DisplayState`.
 *
 * Sources, in order:
 *   - `#machine=v1.…` — a share link (`machine-share.ts`), decoded in the page;
 *   - `?machine=<id>`  — a shipped machine, `public/machines/<id>.json`;
 *   - `?machine=<url>` — a same-origin `.json` path (an exported `.machine.json`).
 * Anything that fails to load or validate boots the vanilla table with a
 * `bootWarn`, never a broken one.
 *
 * Rules (ball weights, points, fever) and tracks are validated and carried on
 * `game.machine`, but the runtime applies them only once the replay contract
 * covers them (a tape must record the rules its run played under); until then
 * a machine with non-default rules boots with a warning and today's rules.
 *
 * The backbox mapping is `machine-backbox.ts` (the entry chunk needs it; this module stays lazy).
 *
 * Kept out of the entry chunk: `main.ts` imports this module only when the
 * URL names a machine.
 */

import { assetUrl } from '../core/asset-urls'
import { formatMachineErrors, MACHINE_LIMITS, rulesAreDefault, validateMachine, type MachineDescriptor } from '../schemas/machine'
import { decodeMachineShare, readShareHash } from './machine-share'

export type MachineSource =
  | { kind: 'share'; payload: string }
  | { kind: 'id'; id: string }
  | { kind: 'url'; url: string }

export type MachineLoadResult = { ok: true; descriptor: MachineDescriptor; source: MachineSource } | { ok: false; error: string }

/** The ids of the machines in `public/machines/` (also listed in `public/machines/index.json`). */
export const SHIPPED_MACHINE_IDS = ['classic', 'neo', 'vertical', 'wide'] as const

/** Which machine, if any, a location names. A share hash wins over `?machine=`. */
export function parseMachineSource(location: { search: string; hash: string }): MachineSource | null {
  const payload = readShareHash(location.hash)
  if (payload) return { kind: 'share', payload }
  const raw = new URLSearchParams(location.search).get('machine')
  if (!raw) return null
  if (MACHINE_LIMITS.idPattern.test(raw)) return { kind: 'id', id: raw }
  // A same-origin path only: a link must not make the page fetch from another host.
  if (/^(?:\.?\/)?(?:[\w-]+\/)*[\w.-]+\.json$/.test(raw) && !raw.includes('..')) return { kind: 'url', url: raw }
  return null
}

/** Where a shipped machine's JSON is served. */
export function machineUrl(id: string): string {
  return assetUrl(`machines/${id}.json`)
}

export async function loadMachine(source: MachineSource, fetchFn: typeof fetch = fetch): Promise<MachineLoadResult> {
  if (source.kind === 'share') {
    const decoded = await decodeMachineShare(source.payload)
    return decoded.ok ? { ok: true, descriptor: decoded.descriptor, source } : { ok: false, error: decoded.error }
  }
  const url = source.kind === 'id' ? machineUrl(source.id) : source.url
  let raw: unknown
  try {
    const response = await fetchFn(url, { credentials: 'same-origin' })
    if (!response.ok) return { ok: false, error: `${url}: HTTP ${response.status}` }
    raw = await response.json()
  } catch (err) {
    return { ok: false, error: `${url}: ${err instanceof Error ? err.message : String(err)}` }
  }
  const result = validateMachine(raw)
  if (!result.ok) return { ok: false, error: `${url}: ${formatMachineErrors(result.errors)}` }
  if (source.kind === 'id' && result.descriptor.id !== source.id) {
    return { ok: false, error: `${url}: declares id ${result.descriptor.id}, expected ${source.id}` }
  }
  return { ok: true, descriptor: result.descriptor, source }
}

/** Resolve the machine named by the page's URL; null (vanilla table) when none is named or it fails. */
export async function bootMachine(
  location: { search: string; hash: string },
  warn: (message: string) => void,
  fetchFn: typeof fetch = fetch,
): Promise<MachineDescriptor | null> {
  const source = parseMachineSource(location)
  if (!source) {
    if (new URLSearchParams(location.search).has('machine')) warn('[machine] ?machine= is neither an id nor a same-origin .json path')
    return null
  }
  const result = await loadMachine(source, fetchFn)
  if (!result.ok) {
    warn(`[machine] not loaded, booting the vanilla table: ${result.error}`)
    return null
  }
  if (!rulesAreDefault(result.descriptor.rules)) {
    warn(`[machine] ${result.descriptor.id}: custom rules are not applied yet; playing the default rules`)
  }
  return result.descriptor
}
