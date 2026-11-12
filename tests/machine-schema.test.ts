/**
 * `MachineDescriptor` (#506 Slice A): the shipped machines in `public/machines/`,
 * the weekly machine as a derived view (every ISO week of 2027), and the
 * validator's rejections. Part of `npm run machine:validate`.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MACHINE_CABINETS,
  defaultMachineBackbox,
  machineFromWeekly,
  rulesAreDefault,
  validateMachine,
  weeklyView,
  type MachineDescriptor,
} from '../src/schemas/machine'
import { SHIPPED_MACHINE_IDS } from '../src/machine/machine-loader'
import { generateWeeklyMachine } from '../src/cascade/weekly-machine'
import { initSessionRng, seedFromWeeklyId, weeklySeedId } from '../src/core/seeded-rng'

const root = join(import.meta.dirname, '..')
const machineDir = join(root, 'public/machines')
const trackDir = join(root, 'src/adventure/track-data')
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
const machineFiles = readdirSync(machineDir).filter((f) => f.endsWith('.json') && f !== 'index.json')
const shipped = (id: string): MachineDescriptor => readJson(join(machineDir, `${id}.json`)) as MachineDescriptor

const errorsOf = (raw: unknown): string[] => {
  const result = validateMachine(raw)
  return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`)
}

describe('shipped machines (public/machines)', () => {
  it('are exactly the four cabinets, one machine each, listed in index.json', () => {
    expect(machineFiles.map((f) => f.replace(/\.json$/, '')).sort()).toEqual([...SHIPPED_MACHINE_IDS].sort())
    expect(SHIPPED_MACHINE_IDS.map((id) => shipped(id).cabinet).sort()).toEqual([...MACHINE_CABINETS].sort())
    const index = readJson(join(machineDir, 'index.json')) as { machines: Array<{ id: string; name: string; cabinet: string }> }
    expect(index.machines).toEqual(SHIPPED_MACHINE_IDS.map((id) => ({ id, name: shipped(id).name, cabinet: shipped(id).cabinet })))
  })

  for (const file of machineFiles) {
    it(`${file} validates, its id is its file name, and its media exist`, () => {
      const raw = readJson(join(machineDir, file))
      expect(errorsOf(raw)).toEqual([])
      const machine = raw as MachineDescriptor
      expect(`${machine.id}.json`).toBe(file)
      expect(rulesAreDefault(machine.rules)).toBe(true)
      for (const ref of [machine.backbox.idle, machine.backbox.reach, machine.backbox.fever]) {
        expect(existsSync(join(root, 'public/backbox', ref.video)), ref.video).toBe(true)
        if (ref.poster) expect(existsSync(join(root, 'public/backbox', ref.poster)), ref.poster).toBe(true)
      }
      for (const stem of machine.audio.stems) expect(existsSync(join(root, 'public/audio', stem.src)), stem.src).toBe(true)
    })
  }

  it('the classic machine shows the default backbox', () => {
    expect(shipped('classic').backbox).toEqual(defaultMachineBackbox())
  })

  it('every shipped track validates as an inline track ref', () => {
    const base = shipped('classic')
    for (const file of readdirSync(trackDir).filter((f) => f.endsWith('.json'))) {
      const inline = readJson(join(trackDir, file))
      expect(errorsOf({ ...base, tracks: [{ inline }] }), file).toEqual([])
    }
  })
})

describe('the weekly machine is a derived view', () => {
  it('every ISO week of 2027 round-trips through JSON and the schema', () => {
    const monday = Date.UTC(2027, 0, 4) // 2027-W01
    const weeks: string[] = []
    for (let week = 0; week < 53; week++) {
      const id = weeklySeedId(new Date(monday + week * 7 * 86_400_000))
      if (id.startsWith('2027-W')) weeks.push(id)
    }
    expect(weeks).toHaveLength(52) // 2027 has 52 ISO weeks
    for (const id of weeks) {
      const seed = seedFromWeeklyId(id)
      initSessionRng(seed)
      const weekly = generateWeeklyMachine(seed)
      const machine = machineFromWeekly(weekly)
      const roundTripped: unknown = JSON.parse(JSON.stringify(machine))
      expect(errorsOf(roundTripped), id).toEqual([])
      expect(roundTripped).toEqual(machine)
      expect(weeklyView(roundTripped as MachineDescriptor)).toEqual(weekly)
      expect(machine.seedPolicy).toBe('weekly')
    }
  })

  it('a vanilla machine has no weekly view', () => {
    expect(weeklyView(shipped('classic'))).toBeNull()
  })

  it('a weekly table outside the envelope fails with its path under rules.cascade.weekly', () => {
    const golden = readJson(join(root, 'tests/fixtures/weekly-machines/2026-W44.json')) as { bumpers: Array<{ dx: number }> }
    golden.bumpers[0]!.dx = 2
    const machine = { ...shipped('classic'), seedPolicy: 'weekly', rules: { ...shipped('classic').rules, cascade: { weekly: golden } } }
    expect(errorsOf(machine).some((e) => e.startsWith('rules.cascade.weekly.bumpers[0].dx'))).toBe(true)
  })
})

describe('validateMachine rejects', () => {
  const base = (): Record<string, unknown> => JSON.parse(JSON.stringify(shipped('neo'))) as Record<string, unknown>
  const backbox = (d: Record<string, unknown>) => d.backbox as Record<string, Record<string, unknown>>
  const rules = (d: Record<string, unknown>) => d.rules as { balls: { weights: Record<string, number> } }

  it('non-objects and unknown fields', () => {
    for (const raw of [null, 3, 'neo', []]) expect(validateMachine(raw).ok).toBe(false)
    expect(errorsOf({ ...base(), extra: 1 })).toContain('extra: unknown field')
  })

  it('an unknown cabinet, seed policy or track id', () => {
    expect(errorsOf({ ...base(), cabinet: 'pinball' })[0]).toMatch(/^cabinet:/)
    expect(errorsOf({ ...base(), seedPolicy: 'hourly' })[0]).toMatch(/^seedPolicy:/)
    expect(errorsOf({ ...base(), tracks: [{ id: 'NOT_A_TRACK' }] })).toContain('tracks[0].id: unknown track id')
    expect(errorsOf({ ...base(), tracks: [] })[0]).toMatch(/^tracks:/)
  })

  it('media outside public/ or on another host', () => {
    for (const video of ['../index.html.mp4', 'https://example.com/a.mp4', '/abs/a.mp4', 'attract.exe', 'a/../../b.mp4']) {
      const d = base()
      backbox(d).idle!.video = video
      expect(errorsOf(d).some((e) => e.startsWith('backbox.idle.video')), video).toBe(true)
    }
    const d = base()
    ;(d.audio as { stems: unknown[] }).stems = [{ role: 'drums', src: 'https://example.com/d.opus' }]
    expect(errorsOf(d).some((e) => e.startsWith('audio.stems[0].src'))).toBe(true)
  })

  it('duplicate stem roles and an out-of-range bpm', () => {
    const d = base()
    d.audio = { stems: [{ role: 'drums', src: 'stems/neo/drums.opus' }, { role: 'drums', src: 'stems/neo/d2.opus' }], bpm: 400 }
    const errors = errorsOf(d)
    expect(errors.some((e) => e.startsWith('audio.bpm'))).toBe(true)
    expect(errors.some((e) => e.includes('duplicate stem role'))).toBe(true)
  })

  it('spawn weights that do not sum to 1', () => {
    const d = base()
    rules(d).balls.weights.standard = 0.5
    expect(errorsOf(d).some((e) => e.startsWith('rules.balls.weights:'))).toBe(true)
  })

  it('a weekly seed policy without its table', () => {
    expect(errorsOf({ ...base(), seedPolicy: 'weekly' })).toEqual(['rules.cascade.weekly: a weekly machine carries its seeded table'])
  })

  it('an invalid inline track, with the track validator’s path', () => {
    const errors = errorsOf({ ...base(), tracks: [{ inline: { schemaVersion: 99 } }] })
    expect(errors.some((e) => e.startsWith('tracks[0].inline.schemaVersion'))).toBe(true)
  })

  it('custom rules are flagged as not default', () => {
    const d = base() as unknown as MachineDescriptor
    d.rules.fever.threshold = 20
    expect(errorsOf(d)).toEqual([])
    expect(rulesAreDefault(d.rules)).toBe(false)
  })
})
