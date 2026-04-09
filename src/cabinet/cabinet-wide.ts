/**
 * Wide Cabinet Preset
 * Extra wide cabinet for deluxe experience
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

export const WIDE_CONFIG: CabinetPreset = {
  type: 'wide',
  name: 'Deluxe Wide',
  description: 'Extra wide cabinet for deluxe experience',

  width: 38,
  depth: 48,
  sideHeight: 20,
  baseY: -10,
  backboxZ: 32,
  backboxHeight: 18,
  backboxDepth: 10,

  bodyMaterial: 'metal',
  trimMaterial: 'gold',
  interiorMaterial: 'dark_felt',

  neonLayout: {
    frontVertical: true,
    sideHorizontal: true,
    marquee: true,
    coinDoor: true,
    underCabinet: false,
    backboxEdge: true,
  },

  lightPoints: {
    interior: new Vector3(0, 2, 5),
    leftAccent: new Vector3(-18, 6, -8),
    rightAccent: new Vector3(18, 6, -8),
    marqueeSpot: {
      pos: new Vector3(0, 19, 28),
      target: new Vector3(0, -1, 0.3),
    },
  },

  hasAngledSides: false,
  hasExtendedMarquee: false,
  hasCoinDoor: true,
}

export function createWideCabinet(scene: Scene, materials: ReturnType<typeof getMaterialLibrary>): Mesh[] {
  const meshes: Mesh[] = []
  const preset = WIDE_CONFIG

  const matLib = materials
  const bodyMat = matLib.getCabinetMetalTrimMaterial()
  const trimMat = matLib.getGoldMaterial()
  const interiorMat = matLib.getCabinetInteriorMaterial()
  const neonMat = matLib.getCabinetNeonMaterial(PALETTE.CYAN)

  const halfW = preset.width / 2
  const halfD = preset.depth / 2
  const playfieldW = 28
  const playfieldD = 36
  const pfHalfW = playfieldW / 2
  const pfHalfD = playfieldD / 2
  const sideThick = 2
  const panelZ = 5

  // 1. SIDE PANELS - Classic straight sides, wider
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

  // Gold trim rails
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

  // 2. FRONT PANEL WITH COIN DOOR
  const frontPanel = MeshBuilder.CreateBox(
    'cabinetFrontPanel',
    { width: playfieldW + 2, height: 8, depth: sideThick },
    scene
  )
  frontPanel.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 1)
  frontPanel.material = bodyMat
  meshes.push(frontPanel)

  // Coin door
  const coinDoor = MeshBuilder.CreateBox('cabinetCoinDoor', { width: 8, height: 5, depth: 0.3 }, scene)
  coinDoor.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 0.8)
  const coinMat = new StandardMaterial('coinDoorMat', scene)
  coinMat.diffuseColor = new Color3(0.05, 0.05, 0.05)
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

  // Legs - Classic style for deluxe feel
  const legPositions = [
    new Vector3(-halfW + 1, preset.baseY - 3, panelZ - halfD + 2),
    new Vector3(halfW - 1, preset.baseY - 3, panelZ - halfD + 2),
    new Vector3(-halfW + 1, preset.baseY - 3, panelZ + halfD - 2),
    new Vector3(halfW - 1, preset.baseY - 3, panelZ + halfD - 2),
  ]

  for (let i = 0; i < legPositions.length; i++) {
    const leg = MeshBuilder.CreateCylinder(`cabinetLeg${i}`, { diameter: 1.8, height: 6 }, scene)
    leg.position = legPositions[i]
    leg.material = trimMat
    meshes.push(leg)

    // Gold foot pad
    const foot = MeshBuilder.CreateCylinder(`cabinetFoot${i}`, { diameter: 2.4, height: 0.5 }, scene)
    foot.position = legPositions[i].clone()
    foot.position.y -= 3
    foot.material = trimMat
    meshes.push(foot)
  }

  // 5. WIDE BACKBOX
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

  // Marquee panel
  const marqueeHeight = 2
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

  // Gold marquee lip
  const marqueeLip = MeshBuilder.CreateBox(
    'cabinetMarqueeLip',
    { width: bbWidth, height: 0.5, depth: 0.5 },
    scene
  )
  marqueeLip.position.set(0, preset.sideHeight + bbHeight - 2, preset.backboxZ - bbDepth - 2.25)
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

  // 7. NEON TRIM - Wide layout with extra strips
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

  // Side horizontal strips
  const neonSideTop = MeshBuilder.CreateBox(
    'cabinetNeonSideTop',
    { width: 0.3, height: 0.3, depth: preset.depth },
    scene
  )
  neonSideTop.position.set(-halfW, preset.sideHeight - 4, panelZ)
  neonSideTop.material = neonMat
  meshes.push(neonSideTop)

  const neonSideTopRight = MeshBuilder.CreateBox(
    'cabinetNeonSideTopRight',
    { width: 0.3, height: 0.3, depth: preset.depth },
    scene
  )
  neonSideTopRight.position.set(halfW, preset.sideHeight - 4, panelZ)
  neonSideTopRight.material = neonMat
  meshes.push(neonSideTopRight)

  // Marquee neon
  const neonMarquee = MeshBuilder.CreateBox(
    'cabinetNeonMarquee',
    { width: preset.width, height: 0.3, depth: 0.3 },
    scene
  )
  neonMarquee.position.set(0, preset.sideHeight - 2, preset.backboxZ - 5.5)
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

  // 8. WIDE-SPECIFIC DECORATIVE DETAILS
  // Extra wide accent lighting bars on sides
  const accentBarHeight = preset.sideHeight * 0.6
  const accentBarWidth = 0.5
  const accentBarDepth = 0.3

  for (const side of [-1, 1]) {
    const accentBar = MeshBuilder.CreateBox(
      `cabinetWideAccentBar${side > 0 ? 'Right' : 'Left'}`,
      { width: accentBarWidth, height: accentBarHeight, depth: accentBarDepth },
      scene
    )
    accentBar.position.set(
      side * (halfW + sideThick / 2 + accentBarDepth / 2 + 0.1),
      preset.sideHeight / 2 - 2,
      panelZ - halfD / 3
    )
    accentBar.material = neonMat
    meshes.push(accentBar)
  }

  // Deluxe side panels - decorative gold insets
  const insetWidth = 6
  const insetHeight = 10
  const insetDepth = 0.2

  for (const side of [-1, 1]) {
    const inset = MeshBuilder.CreateBox(
      `cabinetWideInset${side > 0 ? 'Right' : 'Left'}`,
      { width: insetDepth, height: insetHeight, depth: insetWidth },
      scene
    )
    inset.position.set(
      side * (halfW + sideThick / 2 + insetDepth / 2),
      preset.sideHeight / 2,
      panelZ
    )
    inset.material = trimMat
    meshes.push(inset)
  }

  return meshes
}
