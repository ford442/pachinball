/**
 * CLI wrapper for `npm run tracks:validate` — validates every track-data JSON file.
 *
 * Two gates per track: the schema (`validateTrackDefinition`), and the WASM
 * collider vocabulary (#417) — the compiled track must export to the C++
 * engine with nothing left `unsupported`, or `wasm-owner` cannot run it
 * without stepping Rapier. See "Collider vocabulary" in docs/TRACK_SCHEMA.md.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateTrackDefinition } from '../src/adventure/track-schema'
import { boxDesc } from '../src/adventure/track-collider-descriptors'
import { ExportHarnessBuilder, exportReportFor } from './helpers/track-export-harness'

const trackDataDir = join(import.meta.dirname, '../src/adventure/track-data')
const trackFiles = readdirSync(trackDataDir).filter((name) => name.endsWith('.json'))

describe('tracks:validate CLI', () => {
  it('has at least one JSON track file', () => {
    expect(trackFiles.length).toBeGreaterThan(0)
  })

  for (const file of trackFiles) {
    it(`validates ${file}`, () => {
      const raw = JSON.parse(readFileSync(join(trackDataDir, file), 'utf8'))
      const result = validateTrackDefinition(raw)
      expect(
        result.ok,
        result.ok ? '' : JSON.stringify('errors' in result ? result.errors : []),
      ).toBe(true)
    })

    it(`${file} exports to the WASM engine with no unsupported colliders`, () => {
      const raw = JSON.parse(readFileSync(join(trackDataDir, file), 'utf8'))
      const result = validateTrackDefinition(raw)
      if (!result.ok) return // the schema case above already fails

      const builder = new ExportHarnessBuilder()
      builder.build(result.definition)
      const report = exportReportFor(builder)
      expect(report.descriptorCount).toBeGreaterThan(0)
      expect(report.problems, report.problems.join('\n')).toEqual([])
    })
  }
})

describe('tracks:validate export gate', () => {
  const minimal = validateTrackDefinition({
    schemaVersion: 1,
    id: 'NEON_HELIX',
    segments: [{ type: 'straight', width: 6, length: 10, inclineDeg: 10 }],
  })

  it('passes a track built only from the vocabulary', () => {
    if (!minimal.ok) throw new Error('fixture must validate')
    const builder = new ExportHarnessBuilder()
    builder.build(minimal.definition)
    expect(exportReportFor(builder).problems).toEqual([])
  })

  it('fails a track that emits a collider C++ cannot place', () => {
    if (!minimal.ok) throw new Error('fixture must validate')
    const builder = new ExportHarnessBuilder()
    builder.build(minimal.definition)
    builder.emitCollider(
      boxDesc({ x: 0, y: 1, z: 0 }, { x: 0.5, y: 0.5, z: 0.5 }, { motion: 'dynamic', label: 'crate' }),
    )
    const { problems } = exportReportFor(builder)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('crate')
  })

  it('fails a track that built a Rapier collider outside the descriptor path', () => {
    if (!minimal.ok) throw new Error('fixture must validate')
    const builder = new ExportHarnessBuilder()
    builder.build(minimal.definition)
    builder.markUnexportedCollider('hand-built trimesh')
    expect(exportReportFor(builder).problems).toEqual(['unexported Rapier collider: hand-built trimesh'])
  })
})
