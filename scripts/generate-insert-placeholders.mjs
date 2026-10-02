#!/usr/bin/env node
/**
 * Placeholder insert GLBs for the toys that do not have authored art yet
 * (Prism Core, Nano-Loom). Mag-Spin is authored: scripts/generate-mag-spin-insert.mjs.
 *
 * Shapes are simple boxes, but they go through the shared glb-writer so they
 * load with correct handedness and winding (see docs/CABINET_GLTF.md).
 * Coordinates are relative to the toy's anchor.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeGlb } from './lib/glb-writer.mjs'
import { box, transform } from './lib/mesh-primitives.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const MATERIALS = {
  shell: { baseColor: [0.2, 0.22, 0.28], metallic: 0.4, roughness: 0.4 },
  glass: { baseColor: [0.35, 0.6, 0.9, 0.28], metallic: 0, roughness: 0.1 },
  core: { baseColor: [0.2, 0.05, 0.25], metallic: 0, roughness: 0.3, emissive: [0.6, 0.1, 0.9] },
}

/** Box centred at (cx, cy, cz) with half-extents (hx, hy, hz). */
const node = (name, material, [cx, cy, cz], [hx, hy, hz]) => ({
  name,
  material,
  geometry: transform(box(hx * 2, hy * 2, hz * 2), { t: [cx, cy, cz] }),
})

function writeInsert(toyId, simpleNodes, highNodes) {
  const dir = join(__dirname, '../public/models/inserts', toyId)
  mkdirSync(dir, { recursive: true })
  const glb = (nodes) => writeGlb({ nodes, materials: MATERIALS, generator: 'pachinball generate-insert-placeholders.mjs' })
  const simple = glb(simpleNodes)
  const high = glb(highNodes)
  writeFileSync(join(dir, 'simple.glb'), simple)
  writeFileSync(join(dir, 'high.glb'), high)
  console.log(`Wrote ${toyId} insert placeholders: simple=${simple.byteLength}B high=${high.byteLength}B → ${dir}`)
}

const prismInner = node('prismCoreInner', 'core', [0, 0, 0], [0.5, 0.5, 0.5])
const prismOuter = node('prismCoreOuter', 'glass', [0, 0, 0], [1.25, 1.0, 1.25])
writeInsert('prism-core', [prismInner, prismOuter], [
  prismInner,
  prismOuter,
  node('prismCoreShardDetail', 'core', [0.9, 0.4, 0], [0.15, 0.6, 0.15]),
])

const loomFrame = node('nanoLoomFrame', 'shell', [0, 0, 0], [1.5, 2.0, 0.4])
const loomIntake = node('nanoLoomIntake', 'shell', [0, 2.2, 0], [0.6, 0.5, 0.6])
writeInsert('nano-loom', [loomFrame, loomIntake], [
  loomFrame,
  loomIntake,
  node('nanoLoomPinDetail', 'core', [0, 0, 0.3], [1.2, 1.6, 0.05]),
])
