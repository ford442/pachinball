/**
 * Machine loader (#506 Slice A): which machine a URL names, loading and
 * validating it, and mapping its backbox clips onto `GameConfig.backbox`.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootMachine, loadMachine, machineUrl, parseMachineSource } from '../src/machine/machine-loader'
import { machineBackboxConfig } from '../src/machine/machine-backbox'
import { machineShareHash } from '../src/machine/machine-share'
import type { MachineDescriptor } from '../src/schemas/machine'
import { GameConfig } from '../src/config'
import { backboxAssetUrl } from '../src/config/api'

const root = join(import.meta.dirname, '..')
const shipped = (id: string): MachineDescriptor =>
  JSON.parse(readFileSync(join(root, 'public/machines', `${id}.json`), 'utf8')) as MachineDescriptor

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

describe('parseMachineSource', () => {
  it('reads ?machine=<id>, a same-origin .json path, and a share hash (which wins)', () => {
    expect(parseMachineSource({ search: '?machine=neo', hash: '' })).toEqual({ kind: 'id', id: 'neo' })
    expect(parseMachineSource({ search: '?machine=drafts/my.machine.json', hash: '' })).toEqual({
      kind: 'url',
      url: 'drafts/my.machine.json',
    })
    expect(parseMachineSource({ search: '?machine=neo', hash: '#machine=v1.abc' })).toEqual({ kind: 'share', payload: 'v1.abc' })
    expect(parseMachineSource({ search: '', hash: '' })).toBeNull()
  })

  it('refuses other hosts and traversal', () => {
    for (const raw of ['https://example.com/m.json', '//example.com/m.json', '../secret.json', 'NEO', 'a b']) {
      expect(parseMachineSource({ search: `?machine=${encodeURIComponent(raw)}`, hash: '' }), raw).toBeNull()
    }
  })
})

describe('loadMachine', () => {
  it('loads a shipped machine by id from public/machines', async () => {
    const fetchFn = fakeFetch(shipped('vertical'))
    const result = await loadMachine({ kind: 'id', id: 'vertical' }, fetchFn)
    expect(result.ok).toBe(true)
    expect(fetchFn).toHaveBeenCalledWith(machineUrl('vertical'), { credentials: 'same-origin' })
    expect(machineUrl('vertical')).toMatch(/machines\/vertical\.json$/)
  })

  it('fails on HTTP errors, invalid JSON shape, and an id that does not match the file', async () => {
    expect((await loadMachine({ kind: 'id', id: 'neo' }, fakeFetch({}, 404))).ok).toBe(false)
    expect((await loadMachine({ kind: 'id', id: 'neo' }, fakeFetch({ id: 'neo' }))).ok).toBe(false)
    const mismatch = await loadMachine({ kind: 'id', id: 'neo' }, fakeFetch(shipped('wide')))
    expect(mismatch.ok ? '' : mismatch.error).toMatch(/declares id wide/)
  })

  it('decodes a share link without fetching', async () => {
    const fetchFn = fakeFetch({})
    const hash = await machineShareHash(shipped('wide'))
    const result = await loadMachine({ kind: 'share', payload: hash.slice('#machine='.length) }, fetchFn)
    expect(result.ok && result.descriptor).toEqual(shipped('wide'))
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('bootMachine', () => {
  it('returns null and warns instead of throwing when the machine cannot load', async () => {
    const warn = vi.fn()
    expect(await bootMachine({ search: '?machine=neo', hash: '' }, warn, fakeFetch({}, 500))).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/vanilla table/))
    warn.mockClear()
    expect(await bootMachine({ search: '?machine=https%3A%2F%2Fx.test%2Fm.json', hash: '' }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('warns that custom rules are not applied yet', async () => {
    const machine = shipped('neo')
    machine.rules.fever.threshold = 30
    const warn = vi.fn()
    expect(await bootMachine({ search: '?machine=neo', hash: '' }, warn, fakeFetch(machine))).toEqual(machine)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/custom rules/))
  })
})

describe('machineBackboxConfig', () => {
  it('without a machine, copies GameConfig.backbox including its getter-backed paths', () => {
    const config = machineBackboxConfig(GameConfig.backbox, null)
    expect(config.attractVideoPath).toBe(GameConfig.backbox.attractVideoPath)
    expect(config.jackpotVideoPath).toBe(GameConfig.backbox.jackpotVideoPath)
    expect(config.reachImagePath).toBe(GameConfig.backbox.reachImagePath)
    expect(config.videoReplacesReels).toBe(GameConfig.backbox.videoReplacesReels)
  })

  it('swaps in the machine’s idle / reach / fever clips and keeps jackpot', () => {
    const machine = shipped('neo')
    const config = machineBackboxConfig(GameConfig.backbox, machine)
    expect(config.attractVideoPath).toBe(backboxAssetUrl('tracks/neon-helix.mp4'))
    expect(config.attractImagePath).toBe(backboxAssetUrl('tracks/neon-helix.webp'))
    expect(config.reachVideoPath).toBe(backboxAssetUrl('tracks/glitch-spire.mp4'))
    expect(config.feverVideoPath).toBe(backboxAssetUrl('tracks/neon-helix-data-core.mp4'))
    expect(config.jackpotVideoPath).toBe(GameConfig.backbox.jackpotVideoPath)
  })

  it('the classic machine changes nothing', () => {
    expect(machineBackboxConfig(GameConfig.backbox, shipped('classic'))).toEqual(machineBackboxConfig(GameConfig.backbox, null))
  })
})
