/**
 * Classic Cabinet Preset
 * Traditional wooden pinball cabinet with chrome trim
 */

import {
  Scene,
  MeshBuilder,
  Mesh,
  Vector3,
  StandardMaterial,
  PBRMaterial,
  Color3,
  DynamicTexture,
} from '@babylonjs/core'
import { getMaterialLibrary } from '../materials'
import { PALETTE } from '../game-elements/visual-language'
import type { CabinetPreset } from './cabinet-types'

export const CLASSIC_CONFIG: CabinetPreset = {
  type: 'classic',
  name: 'Classic Pinball',
  description: 'Traditional wooden cabinet with chrome trim',

  width: 32,
  depth: 44,
  sideHeight: 20,
  baseY: -10,
  backboxZ: 30,
  backboxHeight: 18,
  backboxDepth: 10,

  bodyMaterial: 'wood',
  trimMaterial: 'chrome',
  interiorMaterial: 'dark_felt',

  neonLayout: {
    frontVertical: true,
    sideHorizontal: false,
    marquee: true,
    coinDoor: true,
    underCabinet: false,
    backboxEdge: false,
  },

  lightPoints: {
    interior: new Vector3(0, 2, 5),
    leftAccent: new Vector3(-15, 6, -8),
    rightAccent: new Vector3(15, 6, -8),
    marqueeSpot: {
      pos: new Vector3(0, 19, 26),
      target: new Vector3(0, -1, 0.3),
    },
  },

  hasAngledSides: false,
  hasExtendedMarquee: false,
  hasCoinDoor: true,
}

export function createClassicCabinet(scene: Scene, materials: ReturnType<typeof getMaterialLibrary>): Mesh[] {
  const meshes: Mesh[] = []
  const preset = CLASSIC_CONFIG

  const matLib = materials
  const bodyMat = matLib.getCabinetWoodMaterial()
  const trimMat = matLib.getChromeMaterial()
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

  // 1. SIDE PANELS - Classic straight sides
  // Left side
  const leftSide = MeshBuilder.CreateBox(
    'cabinetLeftSide',
    { width: sideThick, height: preset.sideHeight, depth: preset.depth },
    scene
  )
  leftSide.position.set(-halfW - sideThick / 2, preset.sideHeight / 2 - 2, panelZ)
  leftSide.material = bodyMat
  meshes.push(leftSide)

  // Right side
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

  // Legs
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

    // Foot pad
    const foot = MeshBuilder.CreateCylinder(`cabinetFoot${i}`, { diameter: 2.4, height: 0.5 }, scene)
    foot.position = legPositions[i].clone()
    foot.position.y -= 3
    foot.material = trimMat
    meshes.push(foot)
  }

  // 5. BACKBOX (marquee area)
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

  // Marquee trim
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

  // 7. NEON TRIM - Classic layout
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

  // 8. CLASSIC-SPECIFIC DECORATIVE DETAILS
  // Engraved side art plates
  const plateWidth = 1.5
  const plateHeight = 8
  const plateDepth = 0.2
  const plateY = preset.sideHeight - 8

  const createEngravedTexture = (): DynamicTexture => {
    const size = 256
    const tex = new DynamicTexture('engravedPattern', size, scene, true)
    const ctx = tex.getContext()

    // Dark base
    ctx.fillStyle = '#1a1510'
    ctx.fillRect(0, 0, size, size)

    // Art deco style engraved pattern
    ctx.strokeStyle = '#3d3020'
    ctx.lineWidth = 3

    // Border frame
    ctx.strokeRect(10, 10, size - 20, size - 20)

    // Inner decorative lines
    ctx.lineWidth = 2
    for (let i = 40; i < size - 40; i += 30) {
      ctx.beginPath()
      ctx.moveTo(30, i)
      ctx.lineTo(size - 30, i)
      ctx.stroke()
    }

    // Diamond center accent
    const cx = size / 2
    const cy = size / 2
    ctx.beginPath()
    ctx.moveTo(cx, cy - 30)
    ctx.lineTo(cx + 20, cy)
    ctx.lineTo(cx, cy + 30)
    ctx.lineTo(cx - 20, cy)
    ctx.closePath()
    ctx.stroke()

    tex.update()
    return tex
  }

  const createPlateMaterial = (): PBRMaterial => {
    const mat = new PBRMaterial('sidePlateMat', scene)
    mat.albedoColor = new Color3(0.1, 0.08, 0.06)
    mat.metallic = 0.6
    mat.roughness = 0.4
    mat.environmentIntensity = 0.5

    const engravedTex = createEngravedTexture()
    mat.emissiveTexture = engravedTex
    mat.emissiveColor = new Color3(0.05, 0.04, 0.03)
    mat.emissiveIntensity = 0.3

    return mat
  }

  const plateMat = createPlateMaterial()

  // Left side plate
  const leftPlate = MeshBuilder.CreateBox(
    'classicSidePlateLeft',
    { width: plateDepth, height: plateHeight, depth: plateWidth },
    scene
  )
  leftPlate.position.set(-halfW - sideThick / 2 - plateDepth / 2, plateY, panelZ - 8)
  leftPlate.material = plateMat
  meshes.push(leftPlate)

  // Right side plate
  const rightPlate = MeshBuilder.CreateBox(
    'classicSidePlateRight',
    { width: plateDepth, height: plateHeight, depth: plateWidth },
    scene
  )
  rightPlate.position.set(halfW + sideThick / 2 + plateDepth / 2, plateY, panelZ - 8)
  rightPlate.material = plateMat
  meshes.push(rightPlate)

  // Brass speaker grilles on bottom front
  const brassMat = matLib.getBrushedMetalMaterial()
  brassMat.albedoColor = new Color3(0.8, 0.6, 0.2)

  const speakerRadius = 2.5
  const speakerTorus = MeshBuilder.CreateTorus(
    'classicSpeakerGrille',
    { diameter: speakerRadius * 2, thickness: 0.4 },
    scene
  )
  speakerTorus.position.set(0, -8, panelZ - halfD + 1)
  speakerTorus.rotation.x = Math.PI / 2
  speakerTorus.material = brassMat
  meshes.push(speakerTorus)

  const speakerMesh = MeshBuilder.CreateCylinder(
    'classicSpeakerMesh',
    { diameter: speakerRadius * 1.6, height: 0.2 },
    scene
  )
  speakerMesh.position.set(0, -8, panelZ - halfD + 0.9)
  speakerMesh.rotation.x = Math.PI / 2
  speakerMesh.material = brassMat
  meshes.push(speakerMesh)

  // Decorative coin-door trim (chrome frame around coin door)
  const chromeMat = matLib.getChromeMaterial()
  const coinDoorW = 8.4
  const coinDoorH = 5.4
  const trimThick = 0.3

  // Top trim
  const topTrim = MeshBuilder.CreateBox(
    'classicCoinTrimTop',
    { width: coinDoorW + trimThick * 2, height: trimThick, depth: 0.4 },
    scene
  )
  topTrim.position.set(0, -6 + coinDoorH / 2 + trimThick / 2, panelZ - pfHalfD - sideThick / 2 - 0.5)
  topTrim.material = chromeMat
  meshes.push(topTrim)

  // Bottom trim
  const bottomTrim = MeshBuilder.CreateBox(
    'classicCoinTrimBottom',
    { width: coinDoorW + trimThick * 2, height: trimThick, depth: 0.4 },
    scene
  )
  bottomTrim.position.set(0, -6 - coinDoorH / 2 - trimThick / 2, panelZ - pfHalfD - sideThick / 2 - 0.5)
  bottomTrim.material = chromeMat
  meshes.push(bottomTrim)

  // Left trim
  const leftTrim = MeshBuilder.CreateBox(
    'classicCoinTrimLeft',
    { width: trimThick, height: coinDoorH, depth: 0.4 },
    scene
  )
  leftTrim.position.set(-coinDoorW / 2 - trimThick / 2, -6, panelZ - pfHalfD - sideThick / 2 - 0.5)
  leftTrim.material = chromeMat
  meshes.push(leftTrim)

  // Right trim
  const rightTrim = MeshBuilder.CreateBox(
    'classicCoinTrimRight',
    { width: trimThick, height: coinDoorH, depth: 0.4 },
    scene
  )
  rightTrim.position.set(coinDoorW / 2 + trimThick / 2, -6, panelZ - pfHalfD - sideThick / 2 - 0.5)
  rightTrim.material = chromeMat
  meshes.push(rightTrim)

  return meshes
}
