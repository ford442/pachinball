import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Scene } from '@babylonjs/core/scene'
import { emissive, PALETTE } from '../../game-elements/visual-language'
import { DecorationFactory } from './decoration-factory'

// -----------------------------------------------------------------------------
// Artistic helper functions — the real creative heart of Nexus Cascade
// Each function is a self-contained visual motif. All low-poly + emissive.
// -----------------------------------------------------------------------------

/** Shared materials for performance (created once per decoration pass) */
let _sharedMats: Record<string, StandardMaterial> | null = null

/** Resets the shared material cache — call once at the start of a decoration pass. */
export function resetSharedMats(): void {
  _sharedMats = null
}

function getSharedMat(scene: Scene, key: string, emissiveHex: string, intensity: number): StandardMaterial {
  if (!_sharedMats) _sharedMats = {}
  if (!_sharedMats[key]) {
    const m = new StandardMaterial(`sharedDecor_${key}`, scene)
    m.emissiveColor = emissive(emissiveHex, intensity)
    m.diffuseColor = Color3.Black()
    m.disableLighting = true
    _sharedMats[key] = m
  }
  return _sharedMats[key]
}

function createEmissiveTrace(
  scene: Scene,
  parent: TransformNode,
  from: Vector3,
  to: Vector3,
  hexColor: string,
  radius = 0.05,
  intensity = 1.15
): Mesh {
  const trace = MeshBuilder.CreateTube(
    `trace_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    { path: [from, to], radius, tessellation: 4, cap: 2 },
    scene
  )
  trace.parent = parent
  trace.material = getSharedMat(scene, `trace_${hexColor}`, hexColor, intensity)
  return trace
}

export function createPerimeterBezel(scene: Scene, parent: TransformNode): void {
  // Outer glowing "picture frame" — gives the whole table a premium machined bezel
  const matCyan = getSharedMat(scene, 'bezelCyan', PALETTE.CYAN, 0.85)
  const matGold = getSharedMat(scene, 'bezelGold', PALETTE.GOLD, 0.7)

  // Long left & right rails
  const leftRail = MeshBuilder.CreateBox('bezelLeft', { width: 0.18, height: 0.07, depth: 34 }, scene)
  leftRail.parent = parent
  leftRail.position.set(-12.8, 0.04, 4.8)
  leftRail.material = matCyan

  const rightRail = MeshBuilder.CreateBox('bezelRight', { width: 0.18, height: 0.07, depth: 34 }, scene)
  rightRail.parent = parent
  rightRail.position.set(12.8, 0.04, 4.8)
  rightRail.material = matCyan

  // Front (flipper) and back accent rails
  const frontRail = MeshBuilder.CreateBox('bezelFront', { width: 25.2, height: 0.07, depth: 0.16 }, scene)
  frontRail.parent = parent
  frontRail.position.set(0, 0.04, -11.6)
  frontRail.material = matGold

  const backRail = MeshBuilder.CreateBox('bezelBack', { width: 25.2, height: 0.07, depth: 0.16 }, scene)
  backRail.parent = parent
  backRail.position.set(0, 0.04, 21.6)
  backRail.material = matGold

  // Corner "rivet" nodes
  const corners = [
    new Vector3(-12.4, 0.12, -11.2), new Vector3(12.4, 0.12, -11.2),
    new Vector3(-12.4, 0.12, 21.2), new Vector3(12.4, 0.12, 21.2)
  ]
  corners.forEach((p, i) => {
    const rivet = MeshBuilder.CreateCylinder(`bezelRivet${i}`, { height: 0.09, diameter: 0.22 }, scene)
    rivet.parent = parent
    rivet.position = p
    rivet.material = getSharedMat(scene, 'rivet', PALETTE.MAGENTA, 1.4)
  })
}

export function createCentralReactorMotif(scene: Scene, parent: TransformNode): void {
  // Large elegant central "power core" — the visual heart of the table
  // Concentric rings + radial spokes + floating central orb
  const ringMat = getSharedMat(scene, 'reactorRing', PALETTE.CYAN, 1.05)
  const spokeMat = getSharedMat(scene, 'reactorSpoke', PALETTE.GOLD, 0.9)
  const coreMat = getSharedMat(scene, 'reactorCore', PALETTE.MAGENTA, 1.6)

  // Three concentric rings at slightly different heights
  for (let i = 0; i < 3; i++) {
    const r = 3.8 - i * 0.9
    const ring = MeshBuilder.CreateTorus(`reactorRing${i}`, {
      diameter: r * 2, thickness: 0.05 + i * 0.01, tessellation: 32
    }, scene)
    ring.parent = parent
    ring.position.set(0, 0.06 + i * 0.03, 5.5)
    ring.rotation.x = Math.PI / 2
    ring.material = ringMat
  }

  // Radial energy spokes (8 elegant lines)
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2
    const len = 3.6
    const spoke = MeshBuilder.CreateTube(`reactorSpoke${i}`, {
      path: [
        new Vector3(0, 0.05, 5.5),
        new Vector3(Math.cos(ang) * len, 0.05, 5.5 + Math.sin(ang) * len)
      ],
      radius: 0.035,
      tessellation: 3
    }, scene)
    spoke.parent = parent
    spoke.material = spokeMat
  }

  // Floating central holo-core (slightly above surface)
  const core = MeshBuilder.CreateSphere('reactorCore', { diameter: 0.85 }, scene)
  core.parent = parent
  core.position.set(0, 0.55, 5.5)
  core.material = coreMat

  // Tiny orbiting data nodes around the core
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2
    const orb = DecorationFactory.createTechNode(`coreOrb${i}`, scene, parent, new Vector3(
      Math.cos(angle) * 1.35, 0.35, 5.5 + Math.sin(angle) * 1.35
    ))
    orb.scaling.setAll(0.6)
  }
}

export function createLanePowerRails(scene: Scene, parent: TransformNode): void {
  // Premium double-line power rails that run the full length of the table
  // These frame the main play area beautifully without interfering with physics lanes
  const flowMat = getSharedMat(scene, 'flowArrow', PALETTE.CYAN, 1.35)

  // Left power rail (double line for depth)
  createEmissiveTrace(scene, parent, new Vector3(-8.2, 0.03, -10), new Vector3(-8.2, 0.03, 19.5), PALETTE.GOLD, 0.07, 1.2)
  createEmissiveTrace(scene, parent, new Vector3(-7.85, 0.025, -10), new Vector3(-7.85, 0.025, 19.5), PALETTE.CYAN, 0.04, 0.95)

  // Right power rail (mirrored)
  createEmissiveTrace(scene, parent, new Vector3(8.2, 0.03, -10), new Vector3(8.2, 0.03, 19.5), PALETTE.GOLD, 0.07, 1.2)
  createEmissiveTrace(scene, parent, new Vector3(7.85, 0.025, -10), new Vector3(7.85, 0.025, 19.5), PALETTE.CYAN, 0.04, 0.95)

  // Repeating "energy flow" chevrons pointing up the table (directional dynamism)
  for (let z = -7; z < 17; z += 2.6) {
    // Left side
    const cL = MeshBuilder.CreateBox(`flowL${z}`, { width: 0.9, height: 0.06, depth: 0.14 }, scene)
    cL.parent = parent
    cL.position.set(-8.0, 0.04, z)
    cL.rotation.y = 0.6
    cL.material = flowMat

    // Right side
    const cR = MeshBuilder.CreateBox(`flowR${z}`, { width: 0.9, height: 0.06, depth: 0.14 }, scene)
    cR.parent = parent
    cR.position.set(8.0, 0.04, z)
    cR.rotation.y = -0.6
    cR.material = flowMat
  }

  // Plunger lane special treatment (right side only)
  createEmissiveTrace(scene, parent, new Vector3(9.6, 0.04, -9), new Vector3(9.6, 0.04, 8), PALETTE.MAGENTA, 0.055, 1.0)
  createEmissiveTrace(scene, parent, new Vector3(10.1, 0.035, -9), new Vector3(10.1, 0.035, 8), PALETTE.CYAN, 0.04, 0.8)
}

export function createSideServerRacks(scene: Scene, parent: TransformNode): void {
  // Dense but elegant "server rack" clusters on the extreme left and right margins.
  // These sell the "high-end arcade cabinet" fantasy beautifully.
  const rackColors = [PALETTE.CYAN, PALETTE.MAGENTA, PALETTE.PURPLE]

  // LEFT SIDE — 3 distinct vertical clusters
  const leftClusters = [
    { x: -11.8, zBase: 15.5, count: 5 },
    { x: -11.4, zBase: 9.0, count: 4 },
    { x: -11.9, zBase: 2.5, count: 3 }
  ]

  leftClusters.forEach((cluster, ci) => {
    for (let i = 0; i < cluster.count; i++) {
      const z = cluster.zBase + i * 1.35
      const h = 1.4 + (i % 2) * 0.6
      const strut = DecorationFactory.createNeonStrut(`rackL${ci}_${i}`, scene, parent, new Vector3(cluster.x, h * 0.45, z))
      strut.scaling.y = h / 1.8

      // Cross bracing + nodes
      if (i % 2 === 0) {
        const brace = MeshBuilder.CreateBox(`rackBraceL${ci}_${i}`, { width: 0.7, height: 0.05, depth: 0.08 }, scene)
        brace.parent = parent
        brace.position.set(cluster.x + 0.4, h * 0.6, z)
        brace.material = getSharedMat(scene, 'brace', rackColors[(ci + i) % 3], 0.75)
      }
      DecorationFactory.createTechNode(`rackNodeL${ci}_${i}`, scene, parent, new Vector3(cluster.x + 0.25, h + 0.15, z))
    }
    // Hanging wire bundle from each cluster
    DecorationFactory.createWireBundle(`rackWiresL${ci}`, scene, parent,
      new Vector3(cluster.x + 0.3, 1.8, cluster.zBase + 1.5),
      new Vector3(cluster.x - 0.8, 0.4, cluster.zBase - 3.5),
      3, rackColors[ci % 3] as string
    )
  })

  // RIGHT SIDE — slightly different rhythm for visual interest
  const rightClusters = [
    { x: 11.6, zBase: 16.2, count: 4 },
    { x: 11.9, zBase: 8.5, count: 5 },
    { x: 11.5, zBase: 1.8, count: 3 }
  ]

  rightClusters.forEach((cluster, ci) => {
    for (let i = 0; i < cluster.count; i++) {
      const z = cluster.zBase + i * 1.45
      const h = 1.55 + ((i + 1) % 2) * 0.5
      const strut = DecorationFactory.createNeonStrut(`rackR${ci}_${i}`, scene, parent, new Vector3(cluster.x, h * 0.45, z))
      strut.scaling.y = h / 1.8

      if (i % 2 === 1) {
        const brace = MeshBuilder.CreateBox(`rackBraceR${ci}_${i}`, { width: 0.65, height: 0.05, depth: 0.08 }, scene)
        brace.parent = parent
        brace.position.set(cluster.x - 0.35, h * 0.55, z)
        brace.material = getSharedMat(scene, 'braceR', PALETTE.GOLD, 0.8)
      }
      DecorationFactory.createTechNode(`rackNodeR${ci}_${i}`, scene, parent, new Vector3(cluster.x - 0.2, h + 0.18, z))
    }
    DecorationFactory.createWireBundle(`rackWiresR${ci}`, scene, parent,
      new Vector3(cluster.x - 0.25, 1.9, cluster.zBase + 0.8),
      new Vector3(cluster.x + 0.9, 0.35, cluster.zBase - 4.2),
      4, PALETTE.MAGENTA as string
    )
  })
}

export function createFloatingHoloShards(scene: Scene, parent: TransformNode): void {
  // Delicate floating holographic elements in visually "quiet" pockets.
  // These catch light beautifully and sell the premium sci-fi fantasy.
  const shardPositions = [
    // Left quiet zones
    { p: new Vector3(-6.2, 0.45, 13.5), s: 1.15, t: PALETTE.MATRIX },
    { p: new Vector3(-5.8, 0.32, 7.8), s: 0.85, t: PALETTE.CYAN },
    // Right quiet zones
    { p: new Vector3(6.4, 0.48, 12.8), s: 1.25, t: PALETTE.GOLD },
    { p: new Vector3(5.9, 0.29, 4.2), s: 0.9, t: PALETTE.PURPLE },
    // Back corners (near bumpers but not blocking)
    { p: new Vector3(-4.1, 0.55, 17.2), s: 1.4, t: PALETTE.ALERT },
    { p: new Vector3(3.8, 0.51, 17.6), s: 1.1, t: PALETTE.MAGENTA },
    // Front side pockets (near slings but elevated)
    { p: new Vector3(-4.8, 0.38, -5.5), s: 0.75, t: PALETTE.CYAN },
    { p: new Vector3(4.6, 0.41, -5.2), s: 0.8, t: PALETTE.GOLD }
  ]

  shardPositions.forEach((cfg, idx) => {
    DecorationFactory.createHoloCrystal(`holoShard${idx}`, scene, parent, cfg.p, cfg.s, cfg.t)
    // Add a second tiny companion crystal for richness
    if (idx % 2 === 0) {
      DecorationFactory.createHoloCrystal(`holoShard${idx}_b`, scene, parent,
        new Vector3(cfg.p.x + 0.6, cfg.p.y - 0.18, cfg.p.z + 0.9), cfg.s * 0.55, PALETTE.PURPLE)
    }
  })

  // A few elegant floating rings above the shards
  DecorationFactory.createNeonRing('holoRingL', scene, parent, new Vector3(-5.5, 0.85, 11.0), 1.1, PALETTE.CYAN)
  DecorationFactory.createNeonRing('holoRingR', scene, parent, new Vector3(5.3, 0.9, 10.4), 1.25, PALETTE.MAGENTA as string)
}

export function createFiberOpticWiring(scene: Scene, parent: TransformNode): void {
  // Artistic snaking data cables that connect major clusters.
  // These add wonderful organic flow and "busy but premium" energy.
  const routes = [
    // Left-to-center data runs
    { s: new Vector3(-9.8, 0.3, 14), e: new Vector3(-2.5, 0.1, 9) },
    { s: new Vector3(-10.2, 0.25, 6), e: new Vector3(-1.8, 0.08, 3) },
    // Right-to-center
    { s: new Vector3(10.1, 0.28, 13.5), e: new Vector3(2.2, 0.12, 8) },
    { s: new Vector3(9.7, 0.22, 5), e: new Vector3(1.6, 0.07, 1.5) },
    // Cross-field long runs (very cyber)
    { s: new Vector3(-10.5, 0.35, 18), e: new Vector3(9.8, 0.15, -3) },
    { s: new Vector3(10.8, 0.32, 17), e: new Vector3(-9.2, 0.18, -2) }
  ]

  routes.forEach((r, i) => {
    DecorationFactory.createWireBundle(`fiber${i}`, scene, parent, r.s, r.e, 3 + (i % 2), (i % 2 ? PALETTE.CYAN : PALETTE.MAGENTA) as string)
  })
}

export function createWarningBarricadesAndHazards(scene: Scene, parent: TransformNode): void {
  // Industrial danger markings near outlanes, drain, and upper corners.
  // These add narrative "this machine is serious" energy.
  const alertMat = getSharedMat(scene, 'alertStripe', PALETTE.ALERT, 1.0)
  const stripeMat = getSharedMat(scene, 'hazardStripe', PALETTE.GOLD, 0.85)

  // Outlane danger chevrons (left)
  for (let i = 0; i < 3; i++) {
    const c = MeshBuilder.CreateBox(`outlaneAlertL${i}`, { width: 1.1, height: 0.05, depth: 0.22 }, scene)
    c.parent = parent
    c.position.set(-7.2, 0.03, -8.5 - i * 1.4)
    c.rotation.y = 0.8
    c.material = alertMat
  }

  // Outlane danger chevrons (right)
  for (let i = 0; i < 3; i++) {
    const c = MeshBuilder.CreateBox(`outlaneAlertR${i}`, { width: 1.1, height: 0.05, depth: 0.22 }, scene)
    c.parent = parent
    c.position.set(7.4, 0.03, -8.5 - i * 1.4)
    c.rotation.y = -0.8
    c.material = alertMat
  }

  // Upper back hazard striping (near bumpers)
  for (let x = -5; x <= 5; x += 2.2) {
    const stripe = MeshBuilder.CreateBox(`upperHazard${x}`, { width: 1.4, height: 0.04, depth: 0.55 }, scene)
    stripe.parent = parent
    stripe.position.set(x, 0.03, 15.8)
    stripe.rotation.y = (x % 3) * 0.15
    stripe.material = stripeMat
  }

  // Drain area "do not enter" style diagonal bars
  for (let i = 0; i < 4; i++) {
    const bar = MeshBuilder.CreateBox(`drainBar${i}`, { width: 2.8, height: 0.05, depth: 0.12 }, scene)
    bar.parent = parent
    bar.position.set(-1.5 + i * 1.1, 0.035, -9.8)
    bar.rotation.y = 0.35 + i * 0.08
    bar.material = alertMat
  }
}

export function createMicroLEDField(scene: Scene, parent: TransformNode): void {
  // Thousands of tiny "status LEDs" scattered across the surface like a living circuit board.
  // Extremely cheap (tiny boxes) but sells incredible density and quality.
  const ledColors = [PALETTE.CYAN, PALETTE.MAGENTA, PALETTE.GOLD, PALETTE.MATRIX]
  let idx = 0

  // Main field grid (avoiding the very center play lanes)
  for (let x = -11; x <= 11; x += 1.35) {
    for (let z = -8; z <= 18; z += 1.6) {
      // Skip the most critical ball paths
      if (Math.abs(x) < 5.5 && z > -4 && z < 12) continue
      if (Math.abs(x) > 9.5) continue // already covered by server racks

      const led = MeshBuilder.CreateBox(`microLED_${idx++}`, { size: 0.08 }, scene)
      led.parent = parent
      led.position.set(x + (Math.random() - 0.5) * 0.3, 0.015, z + (Math.random() - 0.5) * 0.25)
      led.material = getSharedMat(scene, `led${idx % 4}`, ledColors[idx % 4], 0.6 + Math.random() * 0.5)
    }
  }
}

export function createUpperMaintenanceCluster(scene: Scene, parent: TransformNode): void {
  // The "brain" of the machine — a dense cluster of panels, ports, and readouts
  // right under the backbox. Feels like real high-end pinball backglass support hardware.
  const panelMat = getSharedMat(scene, 'maintPanel', PALETTE.PURPLE, 0.65)
  const portMat = getSharedMat(scene, 'maintPort', PALETTE.CYAN, 1.3)

  // Large base maintenance plate
  const plate = MeshBuilder.CreateBox('maintPlate', { width: 11, height: 0.06, depth: 5.5 }, scene)
  plate.parent = parent
  plate.position.set(0, 0.03, 18.8)
  plate.material = panelMat

  // Grid of glowing "access ports"
  for (let x = -4; x <= 4; x += 1.6) {
    for (let z = 16.5; z <= 20.5; z += 1.3) {
      const port = MeshBuilder.CreateCylinder(`maintPort_${x}_${z}`, { height: 0.04, diameter: 0.38 }, scene)
      port.parent = parent
      port.position.set(x, 0.06, z)
      port.material = portMat

      // Tiny status LED on each port
      const led = MeshBuilder.CreateBox(`portLED_${x}_${z}`, { size: 0.07 }, scene)
      led.parent = parent
      led.position.set(x + 0.18, 0.09, z)
      led.material = getSharedMat(scene, 'portLED', PALETTE.MATRIX, 1.8)
    }
  }

  // A few elegant vertical "diagnostic" struts rising from the plate
  for (let i = 0; i < 3; i++) {
    const s = DecorationFactory.createNeonStrut(`diagStrut${i}`, scene, parent, new Vector3(-3 + i * 3, 0.9, 19.2))
    s.scaling.y = 0.9
  }
}
