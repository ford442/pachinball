/**
 * Generates the classic cabinet glTF LODs:
 *   public/models/cabinet/classic/simple.glb  (QualityTier.LOW)
 *   public/models/cabinet/classic/high.glb    (MEDIUM / HIGH)
 *
 * A late-70s cabinet in neon-noir: walnut-black chamfered sides with chrome
 * T-molding, a lockdown bar over a cyan light bar, a coin door with a lit
 * frame, tapered chrome legs, and a head that frames the backbox display with
 * a lit marquee on top.
 *
 * Coordinates are Babylon world space, the same numbers cabinet-classic.ts
 * uses (playfield centred on z = panelZ = 5, front at z = −17); glb-writer
 * converts handedness. The head is built around the display the game actually
 * renders (DisplaySystem.createBackbox at (0, 13.5, 26.5), 20 × 12) so it
 * frames the backbox rather than hiding it. Visual only — collision stays in
 * code (object-walls.ts); node names follow docs/CABINET_GLTF.md.
 *
 * Run: npm run models:classic-cabinet
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeGlb } from './lib/glb-writer.mjs'
import { box, cylinder, merge, prism, torus, transform, triangleCount } from './lib/mesh-primitives.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '../public/models/cabinet/classic')

const deg = (d) => (d * Math.PI) / 180

export const CLASSIC_MATERIALS = {
  wood: { baseColor: [0.16, 0.095, 0.055], metallic: 0, roughness: 0.5 },
  chrome: { baseColor: [0.9, 0.91, 0.95], metallic: 0.7, roughness: 0.22 },
  brass: { baseColor: [0.78, 0.58, 0.22], metallic: 0.6, roughness: 0.32 },
  steel: { baseColor: [0.08, 0.085, 0.1], metallic: 0.4, roughness: 0.4 },
  interior: { baseColor: [0.07, 0.08, 0.11], metallic: 0, roughness: 0.85 },
  bezel: { baseColor: [0.02, 0.02, 0.025], metallic: 0.1, roughness: 0.15 },
  cloth: { baseColor: [0.03, 0.03, 0.035], metallic: 0, roughness: 0.95 },
  slit: { baseColor: [0, 0, 0], metallic: 0, roughness: 1 },
  sidePlate: { baseColor: [0.12, 0.09, 0.05], metallic: 0.5, roughness: 0.4, emissive: [0, 0.1, 0.12] },
  neon: { baseColor: [0, 0.2, 0.25], metallic: 0, roughness: 0.3, emissive: [0, 0.85, 1], emissiveStrength: 2.5 },
  marqueeLight: { baseColor: [0.05, 0.05, 0.08], metallic: 0, roughness: 0.4, emissive: [0.15, 0.75, 1], emissiveStrength: 1.6 },
  accent: { baseColor: [0.25, 0, 0.2], metallic: 0, roughness: 0.35, emissive: [1, 0, 0.75], emissiveStrength: 1.8 },
  lampRed: { baseColor: [0.3, 0.02, 0.02], metallic: 0, roughness: 0.3, emissive: [1, 0.12, 0.06], emissiveStrength: 2 },
}

/** Nodes present in both LODs (the runtime / doc contract). */
export const CLASSIC_REQUIRED_NODES = [
  'cabinetLeftSide', 'cabinetRightSide', 'cabinetLeftRail', 'cabinetRightRail',
  'cabinetFrontPanel', 'cabinetCoinDoor', 'cabinetCoinSlot', 'cabinetBackPanel', 'cabinetBase',
  'cabinetLeg0', 'cabinetLeg1', 'cabinetLeg2', 'cabinetLeg3',
  'cabinetFoot0', 'cabinetFoot1', 'cabinetFoot2', 'cabinetFoot3',
  'cabinetBackbox', 'cabinetMarquee', 'cabinetMarqueeLip', 'cabinetLeftInner', 'cabinetRightInner',
  'cabinetNeonLeft', 'cabinetNeonRight', 'cabinetNeonMarquee', 'cabinetNeonCoin', 'cabinetLightBar',
  'classicSidePlateLeft', 'classicSidePlateRight', 'classicSpeakerGrille',
]
export const CLASSIC_HIGH_ONLY_NODES = ['cabinetTrimDetail', 'cabinetLegLevelerDetail', 'cabinetCoinReturnDetail']

const at = (geom, t, r = [0, 0, 0]) => transform(geom, { t, r })

/** A box spanning [x0,x1] × [y0,y1] × [z0,z1]. */
function span([x0, x1], [y0, y1], [z0, z1], bevel = 0) {
  return at(box(x1 - x0, y1 - y0, z1 - z0, bevel), [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2])
}

/** Box of cross-section w × h stretched between two points in the y/z plane at x. */
function strut(x, [z0, y0], [z1, y1], w, h, bevel = 0) {
  const len = Math.hypot(z1 - z0, y1 - y0)
  const angle = Math.atan2(y1 - y0, z1 - z0)
  // Rx(−θ) lifts the +Z end by sin θ (see rotMatrix in mesh-primitives).
  return at(box(w, h, len, bevel), [x, (y0 + y1) / 2, (z0 + z1) / 2], [-angle, 0, 0])
}

/** Cylinder of radius r between two points on a principal axis. */
function rod(axis, center, length, r, seg) {
  const rot = axis === 'x' ? [0, 0, deg(90)] : axis === 'z' ? [deg(90), 0, 0] : [0, 0, 0]
  return at(cylinder(r, r, length, seg), center, rot)
}

function buildCabinet(lod) {
  const high = lod === 'high'
  const bev = high ? 0.12 : 0
  const seg = high ? 32 : 12
  const nodes = []
  const add = (name, material, ...geoms) => nodes.push({ name, material, geometry: merge(...geoms) })

  // --- Body sides: chamfered wedges, front edge lower than the back ----------
  const sideOutline = [[-17, -10], [27, -10], [27, 18], [-15.5, 13], [-17, 12]] // (z, y)
  for (const [name, sx] of [['cabinetLeftSide', -1], ['cabinetRightSide', 1]]) {
    add(name, 'wood', at(prism(sideOutline, 2, 'zy', bev), [sx * 17, 0, 0]))
  }

  // Chrome T-molding along the sloped top edge of each side.
  for (const [name, sx] of [['cabinetLeftRail', -1], ['cabinetRightRail', 1]]) {
    add(
      name,
      'chrome',
      strut(sx * 17, [-15.5, 13.15], [27, 18.15], 2.3, 0.3, high ? 0.08 : 0),
      strut(sx * 17, [-17, 12.15], [-15.5, 13.15], 2.3, 0.3, high ? 0.08 : 0),
    )
  }

  // --- Front: apron, lockdown bar, light bar, coin door --------------------
  add('cabinetFrontPanel', 'wood', span([-16, 16], [-10, -1.6], [-17, -15], bev))
  add('cabinetLockdownBar', 'chrome', span([-16.2, 16.2], [-1.6, -0.9], [-17.1, -15.4], high ? 0.15 : 0))
  add('cabinetLightBar', 'neon', rod('x', [0, -2.05, -17.15], 26, 0.16, seg))

  add('cabinetCoinDoor', 'steel', span([-4, 4], [-8.5, -3.5], [-17.3, -17], high ? 0.06 : 0))
  const frame = 0.18
  add(
    'cabinetNeonCoin',
    'neon',
    span([-4.2, 4.2], [-3.5, -3.5 + frame], [-17.35, -17.15]),
    span([-4.2, 4.2], [-8.5 - frame, -8.5], [-17.35, -17.15]),
    span([-4.2, -4.2 + frame], [-8.5, -3.5], [-17.35, -17.15]),
    span([4.2 - frame, 4.2], [-8.5, -3.5], [-17.35, -17.15]),
  )
  // Coin entry left of centre — the asymmetric canary for handedness checks.
  add('cabinetCoinSlot', 'chrome', span([-2.6, -1.4], [-6.5, -4.3], [-17.45, -17.3], high ? 0.05 : 0))
  add('cabinetCoinSlit', 'slit', span([-2.07, -1.93], [-6, -4.8], [-17.5, -17.44]))
  if (high) {
    add('cabinetCoinReturnDetail', 'chrome', span([1.4, 2.6], [-7.8, -6.8], [-17.42, -17.3], 0.05))
    add('cabinetCoinLampDetail', 'lampRed', at(cylinder(0.22, 0.22, 0.14, 16), [2, -7.3, -17.47], [deg(90), 0, 0]))
  }

  // Speaker grilles either side of the door.
  const grilles = []
  const cloth = []
  for (const sx of [-1, 1]) {
    grilles.push(at(torus(1.8, high ? 0.16 : 0.2, seg, high ? 10 : 6), [sx * 10.5, -6, -17.12], [deg(90), 0, 0]))
    if (high) {
      for (const k of [0.6, 1.2]) grilles.push(at(torus(k, 0.06, 24, 6), [sx * 10.5, -6, -17.08], [deg(90), 0, 0]))
    }
    cloth.push(at(cylinder(1.7, 1.7, 0.08, seg), [sx * 10.5, -6, -17.04], [deg(90), 0, 0]))
  }
  add('classicSpeakerGrille', 'brass', ...grilles)
  add('classicSpeakerCloth', 'cloth', ...cloth)

  // --- Underside: base plate, tapered legs, levelers -----------------------
  add('cabinetBase', 'wood', span([-17, 17], [-10.8, -10], [-17, 27], high ? 0.08 : 0))
  const legs = [[-15, -15], [15, -15], [-15, 25], [15, 25]]
  const levelers = []
  legs.forEach(([x, z], i) => {
    add(`cabinetLeg${i}`, 'chrome', at(cylinder(0.95, 0.6, 5.2, seg), [x, -13.4, z]))
    add(`cabinetFoot${i}`, 'steel', at(cylinder(1.05, 1.1, 0.45, seg), [x, -16.6, z]))
    if (high) {
      levelers.push(at(cylinder(0.24, 0.24, 0.5, 12), [x, -16.15, z]))
      levelers.push(at(cylinder(1.05, 0.95, 0.3, seg), [x, -10.95, z])) // top mounting plate
    }
  })
  if (high) add('cabinetLegLevelerDetail', 'chrome', ...levelers)

  // --- Back wall, kept below the display (bottom edge at y 7.5) -------------
  add('cabinetBackPanel', 'wood', span([-16, 16], [-10, 7], [25, 27], bev))

  // --- Head framing the backbox display -------------------------------------
  // Display: centre (0, 13.5, 26.5), 20 × 12, layers within z 25.8 … 27.3.
  add(
    'cabinetBackbox',
    'wood',
    span([-17.5, -15.5], [6.5, 22.5], [25.4, 31], bev),
    span([15.5, 17.5], [6.5, 22.5], [25.4, 31], bev),
    span([-15.5, 15.5], [20.6, 22.5], [25.4, 31], bev),
    span([-15.5, 15.5], [6.5, 7.2], [25.4, 31]),
    span([-15.5, 15.5], [7.2, 20.6], [30.3, 31]),
  )
  // Gloss-black bezel around the display window.
  add(
    'cabinetBezelInset',
    'bezel',
    span([-15.5, -10.4], [7.2, 20.6], [25.3, 25.55]),
    span([10.4, 15.5], [7.2, 20.6], [25.3, 25.55]),
    span([-10.4, 10.4], [19.75, 20.6], [25.3, 25.55]),
    span([-10.4, 10.4], [7.2, 7.4], [25.3, 25.55]),
  )

  // Marquee on top of the head: slanted lit sign.
  add('cabinetMarquee', 'wood', at(prism([[24.6, 22.5], [31, 22.5], [31, 27.2], [25.6, 27.2]], 35, 'zy', bev), [0, 0, 0]))
  const tilt = Math.atan2(1.0, 4.7) // slant of the marquee front face
  add('cabinetMarqueeGlow', 'marqueeLight', at(box(30, 3.6, 0.12), [0, 24.85, 25.05], [tilt, 0, 0]))
  add('cabinetMarqueeLip', 'chrome', span([-17.6, 17.6], [22.25, 22.6], [24.4, 25]))
  add('cabinetNeonMarquee', 'neon', rod('x', [0, 27.35, 25.65], 34, 0.16, seg))

  // --- Interior walls flanking the playfield --------------------------------
  add('cabinetLeftInner', 'interior', span([-14.5, -14], [-2, 14], [-13, 23]))
  add('cabinetRightInner', 'interior', span([14, 14.5], [-2, 14], [-13, 23]))

  // --- Neon tubes up the front corners --------------------------------------
  add('cabinetNeonLeft', 'neon', rod('y', [-17, 1, -17.4], 22, 0.16, seg))
  add('cabinetNeonRight', 'neon', rod('y', [17, 1, -17.4], 22, 0.16, seg))

  // --- Side art: emissive inlay plates (+ racing stripes on high) -----------
  for (const [name, sx] of [['classicSidePlateLeft', -1], ['classicSidePlateRight', 1]]) {
    add(name, 'sidePlate', span(sx < 0 ? [-18.14, -18] : [18, 18.14], [1, 7], [-1, 11], high ? 0.04 : 0))
  }
  if (high) {
    const stripes = []
    for (const sx of [-1, 1]) {
      for (const [dz, w] of [[0, 0.9], [1.6, 0.5], [2.8, 0.3]]) {
        // Parallelogram rising toward the back, just proud of the side.
        const o = [[-14 + dz, -6], [-14 + dz + w, -6], [6 + dz + w, 10], [6 + dz, 10]]
        stripes.push(at(prism(o, 0.08, 'zy'), [sx * 18.04, 0, 0]))
      }
    }
    add('cabinetSideStripeAccent', 'accent', ...stripes)

    // Chrome T-molding down the front edge of each side.
    add(
      'cabinetTrimDetail',
      'chrome',
      span([-18.15, -15.85], [-10, 12], [-17.25, -16.95], 0.06),
      span([15.85, 18.15], [-10, 12], [-17.25, -16.95], 0.06),
    )
  }

  return { nodes, materials: CLASSIC_MATERIALS }
}

export function buildClassicCabinet() {
  const out = {}
  for (const lod of ['simple', 'high']) {
    const model = buildCabinet(lod)
    const used = new Set(model.nodes.map((n) => n.material))
    const materials = Object.fromEntries(Object.entries(model.materials).filter(([k]) => used.has(k)))
    out[lod] = {
      glb: writeGlb({ nodes: model.nodes, materials, generator: 'pachinball generate-classic-cabinet.mjs' }),
      triangles: model.nodes.reduce((n, node) => n + triangleCount(node.geometry), 0),
    }
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(outDir, { recursive: true })
  const built = buildClassicCabinet()
  for (const [lod, { glb, triangles }] of Object.entries(built)) {
    writeFileSync(join(outDir, `${lod}.glb`), glb)
    console.log(`Wrote classic/${lod}.glb: ${glb.length} B, ${triangles} triangles`)
  }
}
