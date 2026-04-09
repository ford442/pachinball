/**
 * Vertical Cabinet Preset
 * Tall narrow cabinet for vertical orientation games
 */

import {
  Scene,
  MeshBuilder,
  Mesh,
  Vector3,
  StandardMaterial,
  Color3,
} from '@babylonjs/core'
import { getMaterialLibrary } from '../materials'
import { PALETTE, color } from '../game-elements/visual-language'
import type { CabinetPreset } from './cabinet-types'

export const VERTICAL_CONFIG: CabinetPreset = {
  type: 'vertical',
  name: 'Vertical Shooter',
  description: 'Tall narrow cabinet for vertical orientation games',

  width: 26,
  depth: 38,
  sideHeight: 22,
  baseY: -10,
  backboxZ: 24,
  backboxHeight: 24,
  backboxDepth: 12,

  bodyMaterial: 'carbon_fiber',
  trimMaterial: 'copper',
  interiorMaterial: 'matte_black',

  neonLayout: {
    frontVertical: true,
    sideHorizontal: false,
    marquee: true,
    coinDoor: false,
    underCabinet: true,
    backboxEdge: true,
  },

  lightPoints: {
    interior: new Vector3(0, 3, 5),
    leftAccent: new Vector3(-12, 8, -6),
    rightAccent: new Vector3(12, 8, -6),
    marqueeSpot: {
      pos: new Vector3(0, 21, 20),
      target: new Vector3(0, -1, 0.4),
    },
    underGlow: new Vector3(0, -8, 5),
  },

  hasAngledSides: false,
  hasExtendedMarquee: true,
  hasCoinDoor: false,
}

export function createVerticalCabinet(scene: Scene, materials: ReturnType<typeof getMaterialLibrary>): Mesh[] {
  const meshes: Mesh[] = []
  const preset = VERTICAL_CONFIG

  const matLib = materials
  const bodyMat = matLib.getCarbonFiberMaterial()
  const trimMat = matLib.getCopperMaterial()
  const interiorMat = matLib.getMatteBlackMaterial()
  const neonMat = matLib.getCabinetNeonMaterial(PALETTE.CYAN)

  const halfW = preset.width / 2
  const halfD = preset.depth / 2
  const playfieldW = 28
  const playfieldD = 36
  const pfHalfW = playfieldW / 2
  const pfHalfD = playfieldD / 2
  const sideThick = 2
  const panelZ = 5

  // 1. TALL SIDE PANELS - Straight sides
  const leftSide = MeshBuilder.CreateBox(
    'cabinetLeftSide',
    { width: sideThick, height: preset.sideHeight, depth: preset.depth },
    scene
  )
  leftSide.position.set(-halfW - sideThick / 2, preset.sideHeight / 2 - 2, panelZ)
  leftSide.material = bodyMat
  meshes.push(leftSide)

  const rightSide = MeshBuilder.CreateBox(
    'cabinetRightSide',
    { width: sideThick, height: preset.sideHeight, depth: preset.depth },
    scene
  )
  rightSide.position.set(halfW + sideThick / 2, preset.sideHeight / 2 - 2, panelZ)
  rightSide.material = bodyMat
  meshes.push(rightSide)

  // Metal trim rails
  const railHeight = preset.sideHeight - 2
  const railThick = 0.4

  const leftRail = MeshBuilder.CreateBox(
    'cabinetLeftRail',
    { width: railThick, height: railHeight, depth: preset.depth + 1 },
    scene
  )
  leftRail.position.set(-halfW + railThick / 2, preset.sideHeight / 2 - 2, panelZ)
  leftRail.material = trimMat
  meshes.push(leftRail)

  const rightRail = MeshBuilder.CreateBox(
    'cabinetRightRail',
    { width: railThick, height: railHeight, depth: preset.depth + 1 },
    scene
  )
  rightRail.position.set(halfW - railThick / 2, preset.sideHeight / 2 - 2, panelZ)
  rightRail.material = trimMat
  meshes.push(rightRail)

  // 2. FRONT PANEL - Solid (no coin door)
  const frontPanel = MeshBuilder.CreateBox(
    'cabinetFrontPanel',
    { width: playfieldW + 2, height: 8, depth: sideThick },
    scene
  )
  frontPanel.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 1)
  frontPanel.material = bodyMat
  meshes.push(frontPanel)

  // 3. BACK PANEL
  const backPanel = MeshBuilder.CreateBox(
    'cabinetBackPanel',
    { width: playfieldW + 2, height: preset.sideHeight, depth: sideThick },
    scene
  )
  backPanel.position.set(0, preset.sideHeight / 2 - 2, panelZ + pfHalfD + sideThick / 2 + 1)
  backPanel.material = bodyMat
  meshes.push(backPanel)

  // 4. BOTTOM BASE & LEGS
  // Base
  const base = MeshBuilder.CreateBox(
    'cabinetBase',
    { width: preset.width + 2, height: 2, depth: preset.depth + 2 },
    scene
  )
  base.position.set(0, preset.baseY + 1, panelZ)
  base.material = bodyMat
  meshes.push(base)

  // Modern straight legs
  const legPositions = [
    new Vector3(-halfW + 1, preset.baseY - 3, panelZ - halfD + 2),
    new Vector3(halfW - 1, preset.baseY - 3, panelZ - halfD + 2),
    new Vector3(-halfW + 1, preset.baseY - 3, panelZ + halfD - 2),
    new Vector3(halfW - 1, preset.baseY - 3, panelZ + halfD - 2),
  ]

  for (let i = 0; i < legPositions.length; i++) {
    const leg = MeshBuilder.CreateBox(`cabinetLeg${i}`, { width: 1.5, height: 6, depth: 1.5 }, scene)
    leg.position = legPositions[i]
    leg.material = trimMat
    meshes.push(leg)

    // Foot pad
    const foot = MeshBuilder.CreateCylinder(`cabinetFoot${i}`, { diameter: 2.4, height: 0.5 }, scene)
    foot.position = legPositions[i].clone()
    foot.position.y -= 3
    foot.material = trimMat
    meshes.push(foot)
  }

  // 5. TALL BACKBOX - Extended marquee
  const bbWidth = preset.width + 2
  const bbHeight = preset.backboxHeight
  const bbDepth = preset.backboxDepth

  // Main backbox
  const backbox = MeshBuilder.CreateBox(
    'cabinetBackbox',
    { width: bbWidth, height: bbHeight, depth: bbDepth },
    scene
  )
  backbox.position.set(0, preset.sideHeight + bbHeight / 2 - 1, preset.backboxZ - bbDepth / 2)
  backbox.material = bodyMat
  meshes.push(backbox)

  // Extended marquee
  const marqueeHeight = 4
  const marquee = MeshBuilder.CreateBox(
    'cabinetMarquee',
    { width: bbWidth, height: marqueeHeight, depth: 2 },
    scene
  )
  marquee.position.set(
    0,
    preset.sideHeight + bbHeight - marqueeHeight / 2,
    preset.backboxZ - bbDepth - 1
  )
  marquee.material = bodyMat
  meshes.push(marquee)

  // Double lip for extended look
  const marqueeLip = MeshBuilder.CreateBox(
    'cabinetMarqueeLip',
    { width: bbWidth, height: 0.6, depth: 0.8 },
    scene
  )
  marqueeLip.position.set(0, preset.sideHeight + bbHeight - 2.7, preset.backboxZ - bbDepth - 2.5)
  marqueeLip.material = trimMat
  meshes.push(marqueeLip)

  // 6. INTERIOR WALLS
  const leftInner = MeshBuilder.CreateBox(
    'cabinetLeftInner',
    { width: 0.5, height: preset.sideHeight - 4, depth: 36 },
    scene
  )
  leftInner.position.set(-pfHalfW - 0.25, preset.sideHeight / 2 - 4, panelZ)
  leftInner.material = interiorMat
  meshes.push(leftInner)

  const rightInner = MeshBuilder.CreateBox(
    'cabinetRightInner',
    { width: 0.5, height: preset.sideHeight - 4, depth: 36 },
    scene
  )
  rightInner.position.set(pfHalfW + 0.25, preset.sideHeight / 2 - 4, panelZ)
  rightInner.material = interiorMat
  meshes.push(rightInner)

  // 7. NEON TRIM - Vertical layout
  // Front vertical strips
  const neonLeft = MeshBuilder.CreateBox(
    'cabinetNeonLeft',
    { width: 0.3, height: preset.sideHeight - 4, depth: 0.3 },
    scene
  )
  neonLeft.position.set(-halfW, preset.sideHeight / 2 - 2, panelZ - halfD + 0.5)
  neonLeft.material = neonMat
  meshes.push(neonLeft)

  const neonRight = MeshBuilder.CreateBox(
    'cabinetNeonRight',
    { width: 0.3, height: preset.sideHeight - 4, depth: 0.3 },
    scene
  )
  neonRight.position.set(halfW, preset.sideHeight / 2 - 2, panelZ - halfD + 0.5)
  neonRight.material = neonMat
  meshes.push(neonRight)

  // Marquee neon
  const neonMarquee = MeshBuilder.CreateBox(
    'cabinetNeonMarquee',
    { width: preset.width, height: 0.3, depth: 0.3 },
    scene
  )
  neonMarquee.position.set(0, preset.sideHeight - 2, preset.backboxZ - 5.5)
  neonMarquee.material = neonMat
  meshes.push(neonMarquee)

  // Under cabinet glow
  const neonUnder = MeshBuilder.CreateBox(
    'cabinetNeonUnder',
    { width: preset.width - 4, height: 0.3, depth: preset.depth - 4 },
    scene
  )
  neonUnder.position.set(0, preset.baseY, panelZ)
  neonUnder.material = neonMat
  meshes.push(neonUnder)

  // Backbox edge neon
  const neonBackbox = MeshBuilder.CreateBox(
    'cabinetNeonBackbox',
    { width: bbWidth + 0.6, height: bbHeight, depth: 0.3 },
    scene
  )
  neonBackbox.position.set(
    0,
    preset.sideHeight + bbHeight / 2 - 1,
    preset.backboxZ + 0.5
  )
  neonBackbox.material = neonMat
  meshes.push(neonBackbox)

  // 8. VERTICAL-SPECIFIC DETAILS
  // Tall vertical light bars on sides
  const lightBarHeight = preset.sideHeight + preset.backboxHeight - 2
  const lightBarWidth = 0.4
  const lightBarDepth = 0.4

  // Left vertical light bar
  const leftLightBar = MeshBuilder.CreateBox(
    'cabinetVLightBarLeft',
    { width: lightBarWidth, height: lightBarHeight, depth: lightBarDepth },
    scene
  )
  leftLightBar.position.set(-halfW - 0.5, lightBarHeight / 2 - 2, panelZ)
  leftLightBar.material = neonMat
  meshes.push(leftLightBar)

  // Right vertical light bar
  const rightLightBar = MeshBuilder.CreateBox(
    'cabinetVLightBarRight',
    { width: lightBarWidth, height: lightBarHeight, depth: lightBarDepth },
    scene
  )
  rightLightBar.position.set(halfW + 0.5, lightBarHeight / 2 - 2, panelZ)
  rightLightBar.material = neonMat
  meshes.push(rightLightBar)

  // Speaker grilles on left/right panels at mid-height
  const speakerY = preset.sideHeight / 2
  const speakerMat = new StandardMaterial('speakerGrilleMat', scene)
  speakerMat.diffuseColor = new Color3(0.08, 0.08, 0.08)
  speakerMat.specularColor = new Color3(0.15, 0.15, 0.15)
  speakerMat.alpha = 0.95

  // Left speaker grille (oval using scaled cylinder)
  const leftSpeaker = MeshBuilder.CreateCylinder(
    'cabinetSpeakerLeft',
    { diameter: 6, height: 0.2, tessellation: 16 },
    scene
  )
  leftSpeaker.position.set(-halfW - 0.8, speakerY, panelZ + 5)
  leftSpeaker.rotation.z = Math.PI / 2
  leftSpeaker.scaling.y = 1.5
  leftSpeaker.material = speakerMat
  meshes.push(leftSpeaker)

  // Right speaker grille
  const rightSpeaker = MeshBuilder.CreateCylinder(
    'cabinetSpeakerRight',
    { diameter: 6, height: 0.2, tessellation: 16 },
    scene
  )
  rightSpeaker.position.set(halfW + 0.8, speakerY, panelZ + 5)
  rightSpeaker.rotation.z = Math.PI / 2
  rightSpeaker.scaling.y = 1.5
  rightSpeaker.material = speakerMat
  meshes.push(rightSpeaker)

  // Speaker mesh detail dots
  const speakerDetailMat = new StandardMaterial('speakerDetailMat', scene)
  speakerDetailMat.diffuseColor = new Color3(0.04, 0.04, 0.04)

  for (let i = 0; i < 2; i++) {
    const dot = MeshBuilder.CreateSphere(
      `cabinetSpeakerLeftDetail${i}`,
      { diameter: 0.8 },
      scene
    )
    dot.position.set(-halfW - 0.9, speakerY + (i - 0.5) * 2, panelZ + 5)
    dot.material = speakerDetailMat
    meshes.push(dot)
  }

  for (let i = 0; i < 2; i++) {
    const dot = MeshBuilder.CreateSphere(
      `cabinetSpeakerRightDetail${i}`,
      { diameter: 0.8 },
      scene
    )
    dot.position.set(halfW + 0.9, speakerY + (i - 0.5) * 2, panelZ + 5)
    dot.material = speakerDetailMat
    meshes.push(dot)
  }

  // Circuit-board style engravings on backbox front face
  const bbFrontZ = preset.backboxZ - preset.backboxDepth - 0.5
  const bbY = preset.sideHeight + bbHeight / 2 - 1

  // Create circuit trace material with subtle glow
  const circuitMat = new StandardMaterial('circuitTraceMat', scene)
  circuitMat.diffuseColor = new Color3(0.1, 0.15, 0.2)
  circuitMat.emissiveColor = color(PALETTE.CYAN).scale(0.15)
  circuitMat.alpha = 0.9

  // Horizontal main trace lines
  for (let i = 0; i < 3; i++) {
    const traceY = bbY - bbHeight / 2 + 4 + i * (bbHeight - 8) / 2
    const trace = MeshBuilder.CreateBox(
      `cabinetCircuitTraceH${i}`,
      { width: bbWidth - 4, height: 0.15, depth: 0.1 },
      scene
    )
    trace.position.set(0, traceY, bbFrontZ)
    trace.material = circuitMat
    meshes.push(trace)
  }

  // Vertical connecting traces
  const vTracePositions = [-5, 5]
  for (let i = 0; i < vTracePositions.length; i++) {
    const traceX = vTracePositions[i]
    const trace = MeshBuilder.CreateBox(
      `cabinetCircuitTraceV${i}`,
      { width: 0.15, height: bbHeight - 4, depth: 0.1 },
      scene
    )
    trace.position.set(traceX, bbY, bbFrontZ)
    trace.material = circuitMat
    meshes.push(trace)

    // Circuit nodes at intersections
    const node = MeshBuilder.CreateBox(
      `cabinetCircuitNode${i}`,
      { width: 0.8, height: 0.8, depth: 0.15 },
      scene
    )
    node.position.set(traceX, bbY, bbFrontZ)
    node.material = circuitMat
    meshes.push(node)
  }

  // Diagonal accent traces
  for (let i = 0; i < 2; i++) {
    const traceAngle = i === 0 ? Math.PI / 6 : -Math.PI / 6
    const trace = MeshBuilder.CreateBox(
      `cabinetCircuitTraceD${i}`,
      { width: 10, height: 0.1, depth: 0.1 },
      scene
    )
    trace.position.set(i === 0 ? -6 : 6, bbY + (i === 0 ? 3 : -3), bbFrontZ)
    trace.rotation.z = traceAngle
    trace.material = circuitMat
    meshes.push(trace)
  }

  // Extended marquee lighting - point lights at corners
  const marqueeY = preset.sideHeight + bbHeight - 2
  const marqueeZ = preset.backboxZ - preset.backboxDepth - 2
  const marqueeHalfW = bbWidth / 2

  // Small glowing bulbs at corners
  const bulbMat = new StandardMaterial('marqueeBulbMat', scene)
  bulbMat.diffuseColor = new Color3(1, 0.9, 0.7)
  bulbMat.emissiveColor = new Color3(0.8, 0.7, 0.5)

  const cornerPositions = [
    new Vector3(-marqueeHalfW + 1, marqueeY, marqueeZ),
    new Vector3(marqueeHalfW - 1, marqueeY, marqueeZ),
    new Vector3(-marqueeHalfW + 1, marqueeY - 2, marqueeZ + 1),
    new Vector3(marqueeHalfW - 1, marqueeY - 2, marqueeZ + 1),
  ]

  for (let i = 0; i < cornerPositions.length; i++) {
    const bulb = MeshBuilder.CreateSphere(
      `cabinetMarqueeBulb${i}`,
      { diameter: 0.6 },
      scene
    )
    bulb.position = cornerPositions[i]
    bulb.material = bulbMat
    meshes.push(bulb)
  }

  return meshes
}
