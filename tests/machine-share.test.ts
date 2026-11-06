/**
 * Machine share links (#506 Slice C): `#machine=v1.<base64url(deflate-raw(JSON))>`.
 * Pins the ≤ 8 KB budget for every shipped machine and every shipped track
 * inlined into one, and checks that a crafted link is rejected, not trusted.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MachineDescriptor } from '../src/schemas/machine'
import {
  SHARE_FORMAT_PREFIX,
  SHARE_LINK_MAX_BYTES,
  decodeMachineShare,
  encodeMachineShare,
  machineShareHash,
  readShareHash,
} from '../src/machine/machine-share'
import { SHIPPED_MACHINE_IDS } from '../src/machine/machine-loader'

const root = join(import.meta.dirname, '..')
const shipped = (id: string): MachineDescriptor =>
  JSON.parse(readFileSync(join(root, 'public/machines', `${id}.json`), 'utf8')) as MachineDescriptor
const trackFiles = readdirSync(join(root, 'src/adventure/track-data')).filter((f) => f.endsWith('.json'))

async function deflateToPayload(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  return SHARE_FORMAT_PREFIX + Buffer.from(bytes).toString('base64url')
}

describe('machine share links', () => {
  for (const id of SHIPPED_MACHINE_IDS) {
    it(`${id} round-trips within ${SHARE_LINK_MAX_BYTES} bytes`, async () => {
      const machine = shipped(id)
      const hash = await machineShareHash(machine)
      expect(hash.length).toBeLessThanOrEqual(SHARE_LINK_MAX_BYTES)
      const payload = readShareHash(hash)
      expect(payload).not.toBeNull()
      expect(await decodeMachineShare(payload!)).toEqual({ ok: true, descriptor: machine })
    })
  }

  it('every shipped track, inlined, fits the budget', async () => {
    const sizes: Record<string, number> = {}
    for (const file of trackFiles) {
      const inline: unknown = JSON.parse(readFileSync(join(root, 'src/adventure/track-data', file), 'utf8'))
      const machine = { ...shipped('classic'), tracks: [{ inline }] } as MachineDescriptor
      const hash = await machineShareHash(machine)
      sizes[file] = hash.length
      const decoded = await decodeMachineShare(readShareHash(hash)!)
      expect(decoded.ok, file).toBe(true)
    }
    for (const [file, size] of Object.entries(sizes)) expect(size, file).toBeLessThanOrEqual(SHARE_LINK_MAX_BYTES)
    // Measured 2026-11: the largest (STORM_LATTICE) is ~1.3 KB, far inside the budget.
    expect(Math.max(...Object.values(sizes))).toBeLessThan(2048)
  })

  it('payloads are base64url (safe in a URL hash, no padding)', async () => {
    const payload = await encodeMachineShare(shipped('wide'))
    expect(payload.startsWith(SHARE_FORMAT_PREFIX)).toBe(true)
    expect(payload.slice(SHARE_FORMAT_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('finds the payload among other hash keys', () => {
    expect(readShareHash('#foo=1&machine=v1.abc')).toBe('v1.abc')
    expect(readShareHash('#foo=1')).toBeNull()
    expect(readShareHash('')).toBeNull()
  })

  it('rejects an unknown format, garbage, and a descriptor that fails validation', async () => {
    expect((await decodeMachineShare('v9.abc')).ok).toBe(false)
    expect((await decodeMachineShare('v1.!!!')).ok).toBe(false)
    expect((await decodeMachineShare('v1.AAAA')).ok).toBe(false)
    const bad = await deflateToPayload(JSON.stringify({ ...shipped('neo'), backbox: { ...shipped('neo').backbox, idle: { video: 'https://example.com/x.mp4' } } }))
    const result = await decodeMachineShare(bad)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toContain('backbox.idle.video')
  })

  it('rejects a link that inflates past the cap', async () => {
    const bomb = await deflateToPayload(JSON.stringify({ pad: ' '.repeat(1_000_000) }))
    expect(bomb.length).toBeLessThan(SHARE_LINK_MAX_BYTES)
    const result = await decodeMachineShare(bomb)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toMatch(/more than/)
  })

  it('rejects a link longer than the budget', async () => {
    expect((await decodeMachineShare(SHARE_FORMAT_PREFIX + 'A'.repeat(SHARE_LINK_MAX_BYTES))).ok).toBe(false)
  })
})
