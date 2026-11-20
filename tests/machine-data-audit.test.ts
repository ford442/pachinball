/**
 * Data audit (#518): every shipped machine and declarative track parses with
 * its Valibot schema, `public/machines/index.json` parses with
 * `MachineIndexSchema` and resolves to files whose `id` matches, unknown keys
 * are rejected, and the share-link caps hold against oversized and deeply
 * nested payloads.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MachineIndexSchema, validateMachine, type MachineDescriptor } from '../src/schemas/machine'
import { validateTrackDefinition } from '../src/schemas/track'
import { parseWith } from '../src/schemas/schema-kit'
import { SHARE_LINK_MAX_BYTES, decodeMachineShare, encodeMachineShare } from '../src/machine/machine-share'

const root = join(import.meta.dirname, '..')
const machineDir = join(root, 'public/machines')
const trackDir = join(root, 'src/adventure/track-data')
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
const machineFiles = readdirSync(machineDir).filter((f) => f.endsWith('.json') && f !== 'index.json')
const trackFiles = readdirSync(trackDir).filter((f) => f.endsWith('.json'))

/** `#machine=` payload for arbitrary JSON text, bypassing the encoder's typed input. */
async function sharePayload(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return 'v1.' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('machine data audit', () => {
  for (const file of machineFiles) {
    it(`public/machines/${file} passes validateMachine`, () => {
      const result = validateMachine(readJson(join(machineDir, file)))
      expect(result.ok ? [] : result.errors).toEqual([])
    })
  }

  for (const file of trackFiles) {
    it(`src/adventure/track-data/${file} passes validateTrackDefinition`, () => {
      const result = validateTrackDefinition(readJson(join(trackDir, file)))
      expect(result.ok, JSON.stringify(result)).toBe(true)
    })
  }

  it('index.json parses and every entry resolves to a file with that id', () => {
    const parsed = parseWith(MachineIndexSchema, readJson(join(machineDir, 'index.json')))
    expect(parsed.ok ? [] : parsed.errors).toEqual([])
    if (!parsed.ok) return
    for (const entry of parsed.value.machines) {
      const machine = readJson(join(machineDir, `${entry.id}.json`)) as MachineDescriptor
      expect(machine.id).toBe(entry.id)
      expect(machine.name).toBe(entry.name)
      expect(machine.cabinet).toBe(entry.cabinet)
    }
  })

  it('rejects unknown keys in a machine, its nested objects and the index', () => {
    const base = readJson(join(machineDir, 'weeks-on-fire.json')) as Record<string, unknown>
    expect(validateMachine({ ...base, extra: 1 }).ok).toBe(false)
    expect(validateMachine({ ...base, backbox: { ...(base.backbox as object), glow: 1 } }).ok).toBe(false)
    expect(parseWith(MachineIndexSchema, { schemaVersion: 1, machines: [{ id: 'a', name: 'A', cabinet: 'classic', x: 1 }] }).ok).toBe(false)
    expect(parseWith(MachineIndexSchema, { schemaVersion: 1, machines: [], extra: true }).ok).toBe(false)
  })

  it('rejects duplicate index ids', () => {
    const entry = { id: 'a', name: 'A', cabinet: 'classic' }
    expect(parseWith(MachineIndexSchema, { schemaVersion: 1, machines: [entry, entry] }).ok).toBe(false)
  })

  it('Weeks on Fire fits in a share link and round-trips', async () => {
    const machine = readJson(join(machineDir, 'weeks-on-fire.json')) as MachineDescriptor
    const payload = await encodeMachineShare(machine)
    expect(payload.length).toBeLessThanOrEqual(SHARE_LINK_MAX_BYTES)
    const decoded = await decodeMachineShare(payload)
    expect(decoded.ok && decoded.descriptor).toEqual(machine)
  })

  it('rejects an oversized share payload before decoding it', async () => {
    const result = await decodeMachineShare('v1.' + 'A'.repeat(SHARE_LINK_MAX_BYTES + 1))
    expect(result).toEqual({ ok: false, error: expect.stringContaining(`${SHARE_LINK_MAX_BYTES} bytes`) })
  })

  it('rejects a payload that inflates past the cap (compression bomb)', async () => {
    const result = await decodeMachineShare(await sharePayload(`{"pad":"${' '.repeat(2 * 1024 * 1024)}"}`))
    expect(result.ok).toBe(false)
  })

  it('rejects a deeply nested payload without throwing', async () => {
    const depth = 50_000
    const nested = '{"schemaVersion":1,"id":"deep","tracks":' + '['.repeat(depth) + ']'.repeat(depth) + '}'
    const payload = await sharePayload(nested)
    expect(payload.length).toBeLessThanOrEqual(SHARE_LINK_MAX_BYTES)
    const result = await decodeMachineShare(payload)
    expect(result.ok).toBe(false)
  })
})
