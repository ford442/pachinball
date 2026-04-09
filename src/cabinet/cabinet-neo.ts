/**
 * Neo Cabinet Preset
 * Sleek black metal with aggressive angles and intense neon
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
import { PALETTE } from '../game-elements/visual-language'
import type { CabinetPreset } from './cabinet-types'

export const NEO_CONFIG: CabinetPreset = {
  type: 'neo',
  name: 'Neo Arcade',
  description: 'Sleek black metal with aggressive angles and intense neon',

  width: 30,
  depth: 42,
  sideHeight: 18,
  baseY: -10,
  backboxZ: 28,
  backboxHeight: 16,
  backboxDepth: 8,

  bodyMaterial: 'matte_black',
  trimMaterial: 'black_metal',
  interiorMaterial: 'gloss_black',

  neonLayout: {
    frontVertical: true,
    sideHorizontal: true,
    marquee: true,
    coinDoor: true,
    underCabinet: true,
    backboxEdge: true,
  },

  lightPoints: {
    interior: new Vector3(0, 1, 5),
    leftAccent: new Vector3(-14, 4, -10),
    rightAccent: new Vector3(14, 4, -10),
    marqueeSpot: {
      pos: new Vector3(0, 17, 24),
      target: new Vector3(0, -1, 0.2),
    },
    underGlow: new Vector3(0, -8, 5),
  },

  hasAngledSides: true,
  hasExtendedMarquee: true,
  hasCoinDoor: true,
}

export function createNeoCabinet(scene: Scene, materials: ReturnType<typeof getMaterialLibrary>): Mesh[] {
  const meshes: Mesh[] = []
  const preset = NEO_CONFIG

  const matLib = materials
  const bodyMat = matLib.getMatteBlackMaterial()
  const trimMat = matLib.getBlackMetalMaterial()
  const interiorMat = matLib.getGlossBlackMaterial()
  const neonMat = matLib.getCabinetNeonMaterial(PALETTE.CYAN)

  const halfW = preset.width / 2
  const halfD = preset.depth / 2
  const playfieldW = 28
  const playfieldD = 36
  const pfHalfW = playfieldW / 2
  const pfHalfD = playfieldD / 2
  const sideThick = 2
  const panelZ = 5
  const sideHeight = preset.sideHeight
  const angle = Math.PI / 24 // 7.5 degree inward angle

  // 1. ANGLED SIDE PANELS
  // Left side
  const leftSide = MeshBuilder.CreateBox(
    'cabinetLeftSide',
    { width: sideThick, height: sideHeight, depth: preset.depth },
    scene
  )
  leftSide.position.set(-halfW - sideThick / 2, sideHeight / 2 - 2, panelZ)
  leftSide.rotation.z = angle
  leftSide.material = bodyMat
  meshes.push(leftSide)

  // Right side
  const rightSide = MeshBuilder.CreateBox(
    'cabinetRightSide',
    { width: sideThick, height: sideHeight, depth: preset.depth },
    scene
  )
  rightSide.position.set(halfW + sideThick / 2, sideHeight / 2 - 2, panelZ)
  rightSide.rotation.z = -angle
  rightSide.material = bodyMat
  meshes.push(rightSide)

  // Metal trim rails
  const railHeight = sideHeight - 2
  const railThick = 0.4

  const leftRail = MeshBuilder.CreateBox(
    'cabinetLeftRail',
    { width: railThick, height: railHeight, depth: preset.depth + 1 },
    scene
  )
  leftRail.position.set(-halfW + railThick / 2, sideHeight / 2 - 2, panelZ)
  leftRail.rotation.z = angle
  leftRail.material = trimMat
  meshes.push(leftRail)

  const rightRail = MeshBuilder.CreateBox(
    'cabinetRightRail',
    { width: railThick, height: railHeight, depth: preset.depth + 1 },
    scene
  )
  rightRail.position.set(halfW - railThick / 2, sideHeight / 2 - 2, panelZ)
  rightRail.rotation.z = -angle
  rightRail.material = trimMat
  meshes.push(rightRail)

  // 2. ANGLED FRONT PANEL WITH COIN DOOR
  const frontPanel = MeshBuilder.CreateBox(
    'cabinetFrontPanel',
    { width: playfieldW + 2, height: 9, depth: sideThick },
    scene
  )
  frontPanel.position.set(0, -6.5, panelZ - pfHalfD - sideThick / 2 - 0.5)
  frontPanel.rotation.x = 0.15 // Angled back
  frontPanel.material = bodyMat
  meshes.push(frontPanel)

  // Coin door
  const coinDoor = MeshBuilder.CreateBox('cabinetCoinDoor', { width: 8, height: 5, depth: 0.3 }, scene)
  coinDoor.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 0.8)
  const coinMat = new StandardMaterial('coinDoorMat', scene)
  coinMat.diffuseColor = new Color3(0.02, 0.02, 0.02)
  coinMat.specularColor = new Color3(0.3, 0.3, 0.3)
  coinDoor.material = coinMat
  meshes.push(coinDoor)

  // Coin slot
  const coinSlot = MeshBuilder.CreateBox('cabinetCoinSlot', { width: 0.8, height: 2, depth: 0.4 }, scene)
  coinSlot.position.set(-2, -6, panelZ - pfHalfD - sideThick / 2 - 0.7)
  coinSlot.material = trimMat
  meshes.push(coinSlot)

  // 3. BACK PANEL
  const backPanel = MeshBuilder.CreateBox(
    'cabinetBackPanel',
    { width: playfieldW + 2, height: sideHeight, depth: sideThick },
    scene
  )
  backPanel.position.set(0, sideHeight / 2 - 2, panelZ + pfHalfD + sideThick / 2 + 1)
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

  // Sleek tapered legs
  const legPositions = [
    new Vector3(-halfW + 1, preset.baseY - 3, panelZ - halfD + 2),
    new Vector3(halfW - 1, preset.baseY - 3, panelZ - halfD + 2),
    new Vector3(-halfW + 1, preset.baseY - 3, panelZ + halfD - 2),
    new Vector3(halfW - 1, preset.baseY - 3, panelZ + halfD - 2),
  ]

  for (let i = 0; i < legPositions.length; i++) {
    const leg = MeshBuilder.CreateCylinder(`cabinetLeg${i}`, {
      diameterTop: 1.2,
      diameterBottom: 1.8,
      height: 6
    }, scene)
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

  // 5. BACKBOX - Angular marquee
  const bbWidth = preset.width + 2
  const bbHeight = preset.backboxHeight
  const bbDepth = preset.backboxDepth

  const backbox = MeshBuilder.CreateBox(
    'cabinetBackbox',
    { width: bbWidth, height: bbHeight, depth: bbDepth },
    scene
  )
  backbox.position.set(0, sideHeight + bbHeight / 2 - 1, preset.backboxZ - bbDepth / 2)
  backbox.material = bodyMat
  meshes.push(backbox)

  // Extended angular marquee
  const marqueeHeight = 4
  const marquee = MeshBuilder.CreateBox(
    'cabinetMarquee',
    { width: bbWidth, height: marqueeHeight, depth: 2 },
    scene
  )
  marquee.position.set(
    0,
    sideHeight + bbHeight - marqueeHeight / 2,
    preset.backboxZ - bbDepth - 1
  )
  marquee.material = bodyMat
  meshes.push(marquee)

  // Sharp marquee lip
  const marqueeLip = MeshBuilder.CreateBox(
    'cabinetMarqueeLip',
    { width: bbWidth + 0.5, height: 0.3, depth: 0.8 },
    scene
  )
  marqueeLip.position.set(0, sideHeight + bbHeight - 1.5, preset.backboxZ - bbDepth - 2)
  marqueeLip.material = trimMat
  meshes.push(marqueeLip)

  // 6. INTERIOR WALLS
  const leftInner = MeshBuilder.CreateBox(
    'cabinetLeftInner',
    { width: 0.5, height: sideHeight - 4, depth: 36 },
    scene
  )
  leftInner.position.set(-pfHalfW - 0.25, sideHeight / 2 - 4, panelZ)
  leftInner.material = interiorMat
  meshes.push(leftInner)

  const rightInner = MeshBuilder.CreateBox(
    'cabinetRightInner',
    { width: 0.5, height: sideHeight - 4, depth: 36 },
    scene
  )
  rightInner.position.set(pfHalfW + 0.25, sideHeight / 2 - 4, panelZ)
  rightInner.material = interiorMat
  meshes.push(rightInner)

  // 7. NEON TRIM - Neo has extra strips
  // Front vertical strips
  const neonLeft = MeshBuilder.CreateBox(
    'cabinetNeonLeft',
    { width: 0.3, height: sideHeight - 4, depth: 0.3 },
    scene
  )
  neonLeft.position.set(-halfW, sideHeight / 2 - 2, panelZ - halfD + 0.5)
  neonLeft.material = neonMat
  meshes.push(neonLeft)

  const neonRight = MeshBuilder.CreateBox(
    'cabinetNeonRight',
    { width: 0.3, height: sideHeight - 4, depth: 0.3 },
    scene
  )
  neonRight.position.set(halfW, sideHeight / 2 - 2, panelZ - halfD + 0.5)
  neonRight.material = neonMat
  meshes.push(neonRight)

  // Side horizontal strips
  const neonSideTop = MeshBuilder.CreateBox(
    'cabinetNeonSideTop',
    { width: 0.3, height: 0.3, depth: preset.depth },
    scene
  )
  neonSideTop.position.set(-halfW, sideHeight - 4, panelZ)
  neonSideTop.material = neonMat
  meshes.push(neonSideTop)

  const neonSideTopRight = MeshBuilder.CreateBox(
    'cabinetNeonSideTopRight',
    { width: 0.3, height: 0.3, depth: preset.depth },
    scene
  )
  neonSideTopRight.position.set(halfW, sideHeight - 4, panelZ)
  neonSideTopRight.material = neonMat
  meshes.push(neonSideTopRight)

  // Top edge neon
  const topNeon = MeshBuilder.CreateBox(
    'cabinetTopNeon',
    { width: preset.width + 1, height: 0.2, depth: 0.2 },
    scene
  )
  topNeon.position.set(0, sideHeight - 0.5, panelZ)
  topNeon.material = neonMat
  meshes.push(topNeon)

  // Marquee neon
  const neonMarquee = MeshBuilder.CreateBox(
    'cabinetNeonMarquee',
    { width: preset.width, height: 0.3, depth: 0.3 },
    scene
  )
  neonMarquee.position.set(0, sideHeight - 2, preset.backboxZ - 5.5)
  neonMarquee.material = neonMat
  meshes.push(neonMarquee)

  // Coin door neon
  const neonCoin = MeshBuilder.CreateBox(
    'cabinetNeonCoin',
    { width: 8.4, height: 5.4, depth: 0.2 },
    scene
  )
  neonCoin.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 0.6)
  neonCoin.scaling = new Vector3(1, 1, 0.1)
  neonCoin.material = neonMat
  meshes.push(neonCoin)

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
    sideHeight + bbHeight / 2 - 1,
    preset.backboxZ + 0.5
  )
  neonBackbox.material = neonMat
  meshes.push(neonBackbox)

  // 8. NEO-SPECIFIC DECORATIVE DETAILS
  // Sharp angular engravings on upper sides
  for (let i = 0; i < 3; i++) {
    const yPos = sideHeight - 6 - i * 3.5
    const zOffset = -8 + i * 4

    // Left side gouges
    const leftGouge = MeshBuilder.CreateBox(
      `neoLeftGouge${i}`,
      { width: 0.8, height: 0.15, depth: 6 },
      scene
    )
    leftGouge.position.set(-halfW - 0.2, yPos, panelZ + zOffset)
    leftGouge.rotation.z = angle
    leftGouge.rotation.y = -Math.PI / 12
    leftGouge.rotation.x = -Math.PI / 8
    leftGouge.material = bodyMat
    meshes.push(leftGouge)

    // Left gouge glow
    const leftGougeGlow = MeshBuilder.CreateBox(
      `neoLeftGougeGlow${i}`,
      { width: 0.85, height: 0.05, depth: 6 },
      scene
    )
    leftGougeGlow.position.set(-halfW - 0.25, yPos + 0.05, panelZ + zOffset)
    leftGougeGlow.rotation.z = angle
    leftGougeGlow.rotation.y = -Math.PI / 12
    leftGougeGlow.rotation.x = -Math.PI / 8
    leftGougeGlow.material = neonMat
    meshes.push(leftGougeGlow)

    // Right side gouges
    const rightGouge = MeshBuilder.CreateBox(
      `neoRightGouge${i}`,
      { width: 0.8, height: 0.15, depth: 6 },
      scene
    )
    rightGouge.position.set(halfW + 0.2, yPos, panelZ + zOffset)
    rightGouge.rotation.z = -angle
    rightGouge.rotation.y = Math.PI / 12
    rightGouge.rotation.x = -Math.PI / 8
    rightGouge.material = bodyMat
    meshes.push(rightGouge)

    // Right gouge glow
    const rightGougeGlow = MeshBuilder.CreateBox(
      `neoRightGougeGlow${i}`,
      { width: 0.85, height: 0.05, depth: 6 },
      scene
    )
    rightGougeGlow.position.set(halfW + 0.25, yPos + 0.05, panelZ + zOffset)
    rightGougeGlow.rotation.z = -angle
    rightGougeGlow.rotation.y = Math.PI / 12
    rightGougeGlow.rotation.x = -Math.PI / 8
    rightGougeGlow.material = neonMat
    meshes.push(rightGougeGlow)
  }

  // Front bottom neon strip
  const frontBottomStrip = MeshBuilder.CreateBox(
    'neoFrontBottomStrip',
    { width: preset.width, height: 0.4, depth: 0.4 },
    scene
  )
  frontBottomStrip.position.set(0, -8, panelZ - halfD - 0.3)
  frontBottomStrip.material = neonMat
  meshes.push(frontBottomStrip)

  // Corner accent lights
  const cornerPositions = [
    new Vector3(-halfW - 0.5, -8, panelZ - halfD - 0.5),
    new Vector3(halfW + 0.5, -8, panelZ - halfD - 0.5),
    new Vector3(-halfW - 0.5, sideHeight - 2, panelZ - halfD + 0.5),
    new Vector3(halfW + 0.5, sideHeight - 2, panelZ - halfD + 0.5),
  ]

  cornerPositions.forEach((pos, i) => {
    const cornerGlow = MeshBuilder.CreateBox(
      `neoCornerGlow${i}`,
      { width: 1, height: 0.3, depth: 0.3 },
      scene
    )
    cornerGlow.position = pos
    cornerGlow.material = neonMat
    meshes.push(cornerGlow)
  })

  // Blacked-out speaker grilles with neon outlines
  const speakerZ = panelZ - halfD - 0.8
  const speakerY = -7
  const speakerX = 8
  const grilleMat = new StandardMaterial('neoGrilleMat', scene)
  grilleMat.diffuseColor = new Color3(0.02, 0.02, 0.02)
  grilleMat.specularColor = new Color3(0.1, 0.1, 0.1)

  // Left speaker
  const leftGrille = MeshBuilder.CreateCylinder(
    'neoSpeakerLeft',
    { diameter: 4.5, height: 0.3, tessellation: 16 },
    scene
  )
  leftGrille.position.set(-speakerX, speakerY, speakerZ)
  leftGrille.rotation.x = Math.PI / 2
  leftGrille.material = grilleMat
  meshes.push(leftGrille)

  // Left speaker neon ring
  const leftNeonRing = MeshBuilder.CreateTorus(
    'neoSpeakerLeftRing',
    { diameter: 5, thickness: 0.15, tessellation: 16 },
    scene
  )
  leftNeonRing.position.set(-speakerX, speakerY, speakerZ + 0.15)
  leftNeonRing.rotation.x = Math.PI / 2
  leftNeonRing.material = neonMat
  meshes.push(leftNeonRing)

  // Right speaker
  const rightGrille = MeshBuilder.CreateCylinder(
    'neoSpeakerRight',
    { diameter: 4.5, height: 0.3, tessellation: 16 },
    scene
  )
  rightGrille.position.set(speakerX, speakerY, speakerZ)
  rightGrille.rotation.x = Math.PI / 2
  rightGrille.material = grilleMat
  meshes.push(rightGrille)

  // Right speaker neon ring
  const rightNeonRing = MeshBuilder.CreateTorus(
    'neoSpeakerRightRing',
    { diameter: 5, thickness: 0.15, tessellation: 16 },
    scene
  )
  rightNeonRing.position.set(speakerX, speakerY, speakerZ + 0.15)
  rightNeonRing.rotation.x = Math.PI / 2
  rightNeonRing.material = neonMat
  meshes.push(rightNeonRing)

  // Angular light bars
  const innerLightZ = panelZ - 5
  const innerLightY = 2

  // Left diagonal bar
  const leftLightBar = MeshBuilder.CreateBox(
    'neoLeftLightBar',
    { width: 0.3, height: 0.3, depth: 12 },
    scene
  )
  leftLightBar.position.set(-12, innerLightY, innerLightZ)
  leftLightBar.rotation.x = -Math.PI / 6
  leftLightBar.rotation.y = -Math.PI / 12
  leftLightBar.material = neonMat
  meshes.push(leftLightBar)

  // Right diagonal bar
  const rightLightBar = MeshBuilder.CreateBox(
    'neoRightLightBar',
    { width: 0.3, height: 0.3, depth: 12 },
    scene
  )
  rightLightBar.position.set(12, innerLightY, innerLightZ)
  rightLightBar.rotation.x = -Math.PI / 6
  rightLightBar.rotation.y = Math.PI / 12
  rightLightBar.material = neonMat
  meshes.push(rightLightBar)

  // Horizontal accent bar at back
  const backLightBar = MeshBuilder.CreateBox(
    'neoBackLightBar',
    { width: 20, height: 0.25, depth: 0.25 },
    scene
  )
  backLightBar.position.set(0, innerLightY + 2, panelZ + halfD - 2)
  backLightBar.rotation.y = Math.PI / 16
  backLightBar.material = neonMat
  meshes.push(backLightBar)

  return meshes
}
