/**
 * Generates the Mag-Spin insert LODs:
 *   public/models/inserts/mag-spin/simple.glb  (QualityTier.LOW)
 *   public/models/inserts/mag-spin/high.glb    (MEDIUM / HIGH)
 *
 * A magnetic induction well: a turned gunmetal bowl with a rolled lip, a dark
 * floor carrying a glowing two-arm Archimedean spiral, and (high) a ring of
 * copper coil bobbins on the lip. Local coordinates are relative to the
 * feeder anchor (mag-spin config feederPosition); attachInsertMeshes moves the
 * glTF root there. The bowl's inner radius is WELL_DIAMETER / 2 = 1.75 and the
 * lip tops out at y 0.3, under the procedural spin rings (y 0.35…0.65) that
 * stay on screen for state feedback. Visual only: the well's physics is the
 * C++ axis-pull field / Rapier bowl in mag-spin-feeder.ts.
 *
 * Run: npm run models:mag-spin-insert
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeGlb } from './lib/glb-writer.mjs'
import { convexPolys, cylinder, lathe, merge, torus, transform, triangleCount } from './lib/mesh-primitives.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '../public/models/inserts/mag-spin')

export const WELL_RADIUS = 1.75

export const MAG_SPIN_MATERIALS = {
  wellMetal: { baseColor: [0.1, 0.11, 0.14], metallic: 0.6, roughness: 0.35, emissive: [0, 0.08, 0.1] },
  floor: { baseColor: [0.03, 0.035, 0.05], metallic: 0.3, roughness: 0.5 },
  spiral: { baseColor: [0, 0.3, 0.3], metallic: 0, roughness: 0.3, emissive: [0, 1, 1], emissiveStrength: 2.5 },
  copper: { baseColor: [0.72, 0.38, 0.2], metallic: 0.7, roughness: 0.35 },
}

export const MAG_SPIN_REQUIRED_NODES = ['magSpinWell', 'magSpinFloor', 'magSpinFloorSpiral']
export const MAG_SPIN_HIGH_ONLY_NODES = ['magSpinRingDetail']

/** Closed bowl-wall cross-section (r, y), clockwise: inner wall up, over the lip, outer wall down. */
const WALL_PROFILE = [
  [WELL_RADIUS, -0.45],
  [WELL_RADIUS, 0.2],
  [1.8, 0.27],
  [1.9, 0.3],
  [2.0, 0.28],
  [2.06, 0.22],
  [2.08, 0.1],
  [2.08, -0.5],
  [WELL_RADIUS, -0.5],
  [WELL_RADIUS, -0.45],
]

/** Two-arm Archimedean spiral ribbon lying on the floor, faces up. */
function spiral(steps, width = 0.12, y = -0.388) {
  const quads = []
  const r0 = 0.22
  const r1 = 1.58
  const turns = 1.75
  for (const arm of [0, Math.PI]) {
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps
      const t1 = (i + 1) / steps
      const edge = (t, side) => {
        const a = arm + t * turns * Math.PI * 2
        const r = r0 + (r1 - r0) * t + side * width * 0.5
        return [r * Math.cos(a), y, r * Math.sin(a)]
      }
      quads.push([edge(t0, -1), edge(t1, -1), edge(t1, 1), edge(t0, 1)])
    }
  }
  // Orient every quad away from a point below the floor: all face +Y.
  return convexPolys(quads, [0, -10, 0])
}

function buildMagSpin(lod) {
  const high = lod === 'high'
  const seg = high ? 64 : 24
  const nodes = [
    { name: 'magSpinWell', material: 'wellMetal', geometry: lathe(WALL_PROFILE, seg, { outward: false }) },
    { name: 'magSpinFloor', material: 'floor', geometry: transform(cylinder(WELL_RADIUS, WELL_RADIUS, 0.1, seg), { t: [0, -0.45, 0] }) },
    { name: 'magSpinFloorSpiral', material: 'spiral', geometry: spiral(high ? 96 : 32) },
  ]
  if (high) {
    const bobbins = []
    const count = 12
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      const x = 1.93 * Math.cos(a)
      const z = 1.93 * Math.sin(a)
      bobbins.push(transform(cylinder(0.075, 0.075, 0.14, 12), { t: [x, 0.37, z] }))
      for (const dy of [-0.035, 0, 0.035]) bobbins.push(transform(torus(0.085, 0.022, 12, 6), { t: [x, 0.37 + dy, z] }))
    }
    nodes.push({ name: 'magSpinRingDetail', material: 'copper', geometry: merge(...bobbins) })
  }
  return nodes
}

export function buildMagSpinInsert() {
  const out = {}
  for (const lod of ['simple', 'high']) {
    const nodes = buildMagSpin(lod)
    const used = new Set(nodes.map((n) => n.material))
    const materials = Object.fromEntries(Object.entries(MAG_SPIN_MATERIALS).filter(([k]) => used.has(k)))
    out[lod] = {
      glb: writeGlb({ nodes, materials, generator: 'pachinball generate-mag-spin-insert.mjs' }),
      triangles: nodes.reduce((n, node) => n + triangleCount(node.geometry), 0),
    }
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(outDir, { recursive: true })
  for (const [lod, { glb, triangles }] of Object.entries(buildMagSpinInsert())) {
    writeFileSync(join(outDir, `${lod}.glb`), glb)
    console.log(`Wrote mag-spin/${lod}.glb: ${glb.length} B, ${triangles} triangles`)
  }
}
