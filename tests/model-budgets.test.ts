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
