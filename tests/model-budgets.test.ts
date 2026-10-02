/**
 * Generated glTF model contract: budgets, node names, handedness, winding and
 * reproducibility. Regenerate with `npm run models:classic-cabinet`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseGlb,
  nodeNames,
  triangleCount,
  babylonBounds,
  signedVolume,
  maxBinaryDelta,
  type Glb,
} from './helpers/glb-inspect'
import { CLASSIC_CONFIG } from '../src/cabinet/cabinet-presets'
// @ts-expect-error — plain .mjs generator without type declarations
import { buildClassicCabinet, CLASSIC_REQUIRED_NODES, CLASSIC_HIGH_ONLY_NODES } from '../scripts/generate-classic-cabinet.mjs'
// @ts-expect-error — plain .mjs generator without type declarations
import { buildMagSpinInsert, MAG_SPIN_REQUIRED_NODES, MAG_SPIN_HIGH_ONLY_NODES } from '../scripts/generate-mag-spin-insert.mjs'

const MODELS = join(__dirname, '../public/models')
const load = (rel: string): Glb => parseGlb(readFileSync(join(MODELS, rel)))

const KB = 1024
const CLASSIC_BUDGET = {
  simple: { bytes: 250 * KB, triangles: 4_000 },
  high: { bytes: 3 * 1024 * KB, triangles: 60_000 },
} as const

function expectNoSceneExtras(glb: Glb): void {
  expect(glb.json.cameras ?? []).toHaveLength(0)
  expect(glb.json.extensionsUsed ?? []).not.toContain('KHR_lights_punctual')
  expect(glb.json.extensions?.KHR_lights_punctual).toBeUndefined()
}

describe('classic cabinet glTF', () => {
  const generated = buildClassicCabinet() as Record<'simple' | 'high', { glb: Buffer }>

  for (const lod of ['simple', 'high'] as const) {
    describe(lod, () => {
      const glb = load(`cabinet/classic/${lod}.glb`)

      it('fits the size and triangle budget and is not a stub', () => {
        expect(glb.byteLength).toBeLessThanOrEqual(CLASSIC_BUDGET[lod].bytes)
        expect(glb.byteLength).toBeGreaterThan(20 * KB)
        expect(triangleCount(glb)).toBeLessThanOrEqual(CLASSIC_BUDGET[lod].triangles)
      })

      it('carries the node-name contract', () => {
        const names = nodeNames(glb)
        for (const n of CLASSIC_REQUIRED_NODES as string[]) expect(names).toContain(n)
        for (const n of CLASSIC_HIGH_ONLY_NODES as string[]) {
          if (lod === 'high') expect(names).toContain(n)
          else expect(names).not.toContain(n)
        }
      })

      it('has no cameras or lights', () => expectNoSceneExtras(glb))

      it('lands on its authored Babylon-space bounds', () => {
        const { min, max } = babylonBounds(glb)
        const bounds = CLASSIC_CONFIG.gltf!.bounds!
        for (let k = 0; k < 3; k++) {
          expect(Math.abs(min[k] - bounds.min[k])).toBeLessThan(0.5)
          expect(Math.abs(max[k] - bounds.max[k])).toBeLessThan(0.5)
        }
      })

      it('keeps the coin slot left of centre in Babylon space (handedness canary)', () => {
        const { min, max } = babylonBounds(glb, 'cabinetCoinSlot')
        expect((min[0] + max[0]) / 2).toBeCloseTo(-2, 1)
        expect((min[1] + max[1]) / 2).toBeCloseTo(-5.4, 1)
      })

      it('winds closed parts counter-clockwise from outside', () => {
        for (const n of ['cabinetLeftSide', 'cabinetRightSide', 'cabinetCoinDoor', 'cabinetBase', 'cabinetLeg0', 'cabinetBackbox', 'cabinetMarquee']) {
          expect(signedVolume(glb, n), n).toBeGreaterThan(0)
        }
      })

      it('matches what the generator produces today', () => {
        const fresh = parseGlb(generated[lod].glb)
        expect(fresh.json).toEqual(glb.json)
        expect(maxBinaryDelta(fresh, glb)).toBeLessThan(1e-5)
      })
    })
  }
})

describe('mag-spin insert glTF', () => {
  const generated = buildMagSpinInsert() as Record<'simple' | 'high', { glb: Buffer }>
  const BUDGET = { simple: { bytes: 100 * KB, triangles: 1_500 }, high: { bytes: 600 * KB, triangles: 12_000 } } as const

  for (const lod of ['simple', 'high'] as const) {
    describe(lod, () => {
      const glb = load(`inserts/mag-spin/${lod}.glb`)

      it('fits the budget and is not a stub', () => {
        expect(glb.byteLength).toBeLessThanOrEqual(BUDGET[lod].bytes)
        expect(glb.byteLength).toBeGreaterThan(10 * KB)
        expect(triangleCount(glb)).toBeLessThanOrEqual(BUDGET[lod].triangles)
      })

      it('carries the node-name contract and no scene extras', () => {
        const names = nodeNames(glb)
        for (const n of MAG_SPIN_REQUIRED_NODES as string[]) expect(names).toContain(n)
        for (const n of MAG_SPIN_HIGH_ONLY_NODES as string[]) {
          if (lod === 'high') expect(names).toContain(n)
          else expect(names).not.toContain(n)
        }
        expectNoSceneExtras(glb)
      })

      it('stays inside the well footprint and under the procedural spin rings', () => {
        const { min, max } = babylonBounds(glb)
        expect(Math.max(-min[0], max[0], -min[2], max[2])).toBeLessThanOrEqual(2.2)
        expect(min[1]).toBeGreaterThanOrEqual(-0.6)
        expect(max[1]).toBeLessThanOrEqual(0.8)
        // The bowl rim stays below the lowest ring (y 0.35 − tube 0.075).
        expect(babylonBounds(glb, 'magSpinWell').max[1]).toBeLessThanOrEqual(0.3 + 1e-6)
      })

      it('keeps the bowl opening at the well radius', () => {
        const { min, max } = babylonBounds(glb, 'magSpinFloor')
        expect((max[0] - min[0]) / 2).toBeCloseTo(1.75, 2)
      })

      it('winds closed parts counter-clockwise from outside', () => {
        for (const n of ['magSpinWell', 'magSpinFloor']) expect(signedVolume(glb, n), n).toBeGreaterThan(0)
      })

      it('matches what the generator produces today', () => {
        const fresh = parseGlb(generated[lod].glb)
        expect(fresh.json).toEqual(glb.json)
        expect(maxBinaryDelta(fresh, glb)).toBeLessThan(1e-5)
      })
    })
  }
})

describe('placeholder inserts', () => {
  it('Prism Core keeps its shard on +X in Babylon space (handedness canary)', () => {
    const glb = load('inserts/prism-core/high.glb')
    const { min, max } = babylonBounds(glb, 'prismCoreShardDetail')
    expect((min[0] + max[0]) / 2).toBeCloseTo(0.9, 3)
    expect(signedVolume(glb, 'prismCoreOuter')).toBeGreaterThan(0)
  })

  it('Nano-Loom placeholders wind outward', () => {
    const glb = load('inserts/nano-loom/high.glb')
    for (const n of ['nanoLoomFrame', 'nanoLoomIntake']) expect(signedVolume(glb, n), n).toBeGreaterThan(0)
  })
})
