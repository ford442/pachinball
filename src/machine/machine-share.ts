/**
 * Share links for machines (#506 Slice C): the descriptor's JSON, compressed
 * with the native `CompressionStream('deflate-raw')` and base64url-encoded into
 * the URL hash as `#machine=v1.<payload>`. No dependency; the hash never
 * reaches a server. Decoding validates (`validateMachine`) before anything
 * uses the result, and caps the inflated size so a crafted link cannot
 * balloon in memory.
 *
 * `tests/machine-share.test.ts` pins every shipped machine, and every shipped
 * track inlined into one, at ≤ `SHARE_LINK_MAX_BYTES`.
 */

import { formatMachineErrors, validateMachine, type MachineDescriptor } from '../schemas/machine'

export const SHARE_HASH_KEY = 'machine'
export const SHARE_FORMAT_PREFIX = 'v1.'
/** Budget for the encoded hash value (the whole `#machine=…`). */
export const SHARE_LINK_MAX_BYTES = 8 * 1024
/** Largest inflated descriptor a link may carry. */
export const SHARE_INFLATED_MAX_BYTES = 256 * 1024

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url')
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(transform).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      throw new Error(`more than ${limit} bytes`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** The hash value (without `#machine=`) for a descriptor. */
export async function encodeMachineShare(machine: MachineDescriptor): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(machine))
  const deflated = await pipe(json, new CompressionStream('deflate-raw'), Number.POSITIVE_INFINITY)
  return SHARE_FORMAT_PREFIX + toBase64Url(deflated)
}

/** `#machine=v1.…` for a descriptor. */
export async function machineShareHash(machine: MachineDescriptor): Promise<string> {
  return `#${SHARE_HASH_KEY}=${await encodeMachineShare(machine)}`
}

export type ShareDecodeResult = { ok: true; descriptor: MachineDescriptor } | { ok: false; error: string }

/** Decode and validate a share payload (the part after `#machine=`). */
export async function decodeMachineShare(payload: string): Promise<ShareDecodeResult> {
  if (!payload.startsWith(SHARE_FORMAT_PREFIX)) return { ok: false, error: 'unknown share-link format' }
  if (payload.length > SHARE_LINK_MAX_BYTES) return { ok: false, error: `share link longer than ${SHARE_LINK_MAX_BYTES} bytes` }
  let raw: unknown
  try {
    const bytes = fromBase64Url(payload.slice(SHARE_FORMAT_PREFIX.length))
    const inflated = await pipe(bytes, new DecompressionStream('deflate-raw'), SHARE_INFLATED_MAX_BYTES)
    raw = JSON.parse(new TextDecoder().decode(inflated))
  } catch (err) {
    return { ok: false, error: `unreadable share link: ${err instanceof Error ? err.message : String(err)}` }
  }
  const result = validateMachine(raw)
  return result.ok ? { ok: true, descriptor: result.descriptor } : { ok: false, error: formatMachineErrors(result.errors) }
}

/** The share payload in a location hash (`#machine=…`, possibly among other `&`-joined keys), or null. */
export function readShareHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  return params.get(SHARE_HASH_KEY)
}
