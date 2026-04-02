/**
 * Cabinet Builder - Full 3D Arcade Cabinet System
 *
 * Creates a realistic physical arcade cabinet around the LCD playfield
 * and backbox display. Uses PBR materials, neon trim, and reactive
 * interior lighting that matches the current LCD table theme.
 *
 * Architecture:
 * - Modular design: each cabinet section is a separate builder method
 * - PBR wood/metal materials with procedural wear
 * - Neon edge strips reactive to table map colors
 * - Interior point/spot lights for arcade ambience
 * - Easy to swap for different cabinet shapes later
 */

import {
  Scene,
  MeshBuilder,
  Mesh,
  Vector3,
  StandardMaterial,
  Color3,
  PointLight,
  SpotLight,
} from '@babylonjs/core'
import { getMaterialLibrary } from './material-library'
import { PALETTE, SURFACES, color } from './visual-language'
import type { TableMapType } from '../shaders/lcd-table'
import { TABLE_MAPS } from '../shaders/lcd-table'

export interface CabinetConfig {
  /** Main wood color */
  woodColor?: string
  /** Metal trim color */
  metalColor?: string
  /** Neon accent color */
  neonColor?: string
  /** Width of the cabinet body */
  width?: number
  /** Depth of the cabinet body */
  depth?: number
  /** Height of the side panels */
  sideHeight?: number
  /** Y position of the bottom base */
  baseY?: number
  /** Z offset of the backbox from playfield center */
  backboxZ?: number
}

export class CabinetBuilder {
  private scene: Scene
  private cabinetMeshes: Mesh[] = []
  private neonMeshes: Mesh[] = []
  private interiorLights: (PointLight | SpotLight)[] = []
  private currentNeonColor: string = PALETTE.CYAN
  private config: Required<CabinetConfig>

  constructor(scene: Scene, config?: CabinetConfig) {
    this.scene = scene
    this.config = {
      woodColor: PALETTE.CYAN,
      metalColor: SURFACES.METAL_LIGHT,
      neonColor: PALETTE.CYAN,
      width: 32,
      depth: 44,
      sideHeight: 20,
      baseY: -10,
      backboxZ: 30,
      ...config,
    }
  }

  /**
   * Build the complete cabinet around the playfield and backbox.
   * Call this once during scene initialization.
   */
  buildCabinet(): void {
    this.dispose()

    const matLib = getMaterialLibrary(this.scene)

    // Create materials
    const woodMat = matLib.getCabinetWoodMaterial()
    const metalMat = matLib.getCabinetMetalTrimMaterial()
    const interiorMat = matLib.getCabinetInteriorMaterial()
    const neonMat = matLib.getCabinetNeonMaterial(this.currentNeonColor)

    // Dimensions
    const halfW = this.config.width / 2
    const halfD = this.config.depth / 2
    const playfieldW = 28
    const playfieldD = 36
    const pfHalfW = playfieldW / 2
    const pfHalfD = playfieldD / 2
    const sideThick = 2
    const panelZ = 5 // Playfield center Z

    // ========================================================================
    // 1. SIDE PANELS (wood with metal trim)
    // ========================================================================
    // Left side
    const leftSide = MeshBuilder.CreateBox(
      'cabinetLeftSide',
      { width: sideThick, height: this.config.sideHeight, depth: this.config.depth },
      this.scene
    )
    leftSide.position.set(-halfW - sideThick / 2, this.config.sideHeight / 2 - 2, panelZ)
    leftSide.material = woodMat
    this.cabinetMeshes.push(leftSide)

    // Right side
    const rightSide = MeshBuilder.CreateBox(
      'cabinetRightSide',
      { width: sideThick, height: this.config.sideHeight, depth: this.config.depth },
      this.scene
    )
    rightSide.position.set(halfW + sideThick / 2, this.config.sideHeight / 2 - 2, panelZ)
    rightSide.material = woodMat
    this.cabinetMeshes.push(rightSide)

    // Side trim rails (metal)
    const railHeight = this.config.sideHeight - 2
    const railThick = 0.4
    const leftRail = MeshBuilder.CreateBox(
      'cabinetLeftRail',
      { width: railThick, height: railHeight, depth: this.config.depth + 1 },
      this.scene
    )
    leftRail.position.set(-halfW + railThick / 2, this.config.sideHeight / 2 - 2, panelZ)
    leftRail.material = metalMat
    this.cabinetMeshes.push(leftRail)

    const rightRail = MeshBuilder.CreateBox(
      'cabinetRightRail',
      { width: railThick, height: railHeight, depth: this.config.depth + 1 },
      this.scene
    )
    rightRail.position.set(halfW - railThick / 2, this.config.sideHeight / 2 - 2, panelZ)
    rightRail.material = metalMat
    this.cabinetMeshes.push(rightRail)

    // ========================================================================
    // 2. FRONT PANEL (below playfield, with coin door cutout illusion)
    // ========================================================================
    const frontPanel = MeshBuilder.CreateBox(
      'cabinetFrontPanel',
      { width: playfieldW + 2, height: 8, depth: sideThick },
      this.scene
    )
    frontPanel.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 1)
    frontPanel.material = woodMat
    this.cabinetMeshes.push(frontPanel)

    // Coin door (black plastic inset)
    const coinDoor = MeshBuilder.CreateBox('cabinetCoinDoor', { width: 8, height: 5, depth: 0.3 }, this.scene)
    coinDoor.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 0.8)
    const coinMat = new StandardMaterial('coinDoorMat', this.scene)
    coinMat.diffuseColor = new Color3(0.05, 0.05, 0.05)
    coinMat.specularColor = new Color3(0.3, 0.3, 0.3)
    coinDoor.material = coinMat
    this.cabinetMeshes.push(coinDoor)

    // Coin slot detail
    const coinSlot = MeshBuilder.CreateBox('cabinetCoinSlot', { width: 0.8, height: 2, depth: 0.4 }, this.scene)
    coinSlot.position.set(-2, -6, panelZ - pfHalfD - sideThick / 2 - 0.7)
    coinSlot.material = metalMat
    this.cabinetMeshes.push(coinSlot)

    // ========================================================================
    // 3. BACK PANEL
    // ========================================================================
    const backPanel = MeshBuilder.CreateBox(
      'cabinetBackPanel',
      { width: playfieldW + 2, height: this.config.sideHeight, depth: sideThick },
      this.scene
    )
    backPanel.position.set(0, this.config.sideHeight / 2 - 2, panelZ + pfHalfD + sideThick / 2 + 1)
    backPanel.material = woodMat
    this.cabinetMeshes.push(backPanel)

    // ========================================================================
    // 4. BOTTOM BASE & LEGS
    // ========================================================================
    const base = MeshBuilder.CreateBox(
      'cabinetBase',
      { width: this.config.width + 2, height: 2, depth: this.config.depth + 2 },
      this.scene
    )
    base.position.set(0, this.config.baseY + 1, panelZ)
    base.material = woodMat
    this.cabinetMeshes.push(base)

    // Legs (metal cylinders)
    const legPositions = [
      new Vector3(-halfW + 1, this.config.baseY - 3, panelZ - halfD + 2),
      new Vector3(halfW - 1, this.config.baseY - 3, panelZ - halfD + 2),
      new Vector3(-halfW + 1, this.config.baseY - 3, panelZ + halfD - 2),
      new Vector3(halfW - 1, this.config.baseY - 3, panelZ + halfD - 2),
    ]
    for (let i = 0; i < legPositions.length; i++) {
      const leg = MeshBuilder.CreateCylinder(`cabinetLeg${i}`, { diameter: 1.8, height: 6 }, this.scene)
      leg.position = legPositions[i]
      leg.material = metalMat
      this.cabinetMeshes.push(leg)
    }

    // Leg foot pads
    for (let i = 0; i < legPositions.length; i++) {
      const foot = MeshBuilder.CreateCylinder(`cabinetFoot${i}`, { diameter: 2.4, height: 0.5 }, this.scene)
      foot.position = legPositions[i].clone()
      foot.position.y -= 3
      foot.material = metalMat
      this.cabinetMeshes.push(foot)
    }

    // ========================================================================
    // 5. TOP MARQUEE / HEADER PANEL
    // ========================================================================
    const marquee = MeshBuilder.CreateBox(
      'cabinetMarquee',
      { width: this.config.width + 2, height: 2, depth: 8 },
      this.scene
    )
    marquee.position.set(0, this.config.sideHeight - 1, this.config.backboxZ - 2)
    marquee.material = woodMat
    this.cabinetMeshes.push(marquee)

    // Marquee front lip (metal)
    const marqueeLip = MeshBuilder.CreateBox('cabinetMarqueeLip', { width: this.config.width + 2, height: 0.5, depth: 0.5 }, this.scene)
    marqueeLip.position.set(0, this.config.sideHeight - 2.25, this.config.backboxZ - 5.75)
    marqueeLip.material = metalMat
    this.cabinetMeshes.push(marqueeLip)

    // ========================================================================
    // 6. INTERIOR SIDE WALLS (dark felt to hide internal gaps)
    // ========================================================================
    const leftInner = MeshBuilder.CreateBox(
      'cabinetLeftInner',
      { width: 0.5, height: this.config.sideHeight - 4, depth: playfieldD },
      this.scene
    )
    leftInner.position.set(-pfHalfW - 0.25, this.config.sideHeight / 2 - 4, panelZ)
    leftInner.material = interiorMat
    this.cabinetMeshes.push(leftInner)

    const rightInner = MeshBuilder.CreateBox(
      'cabinetRightInner',
      { width: 0.5, height: this.config.sideHeight - 4, depth: playfieldD },
      this.scene
    )
    rightInner.position.set(pfHalfW + 0.25, this.config.sideHeight / 2 - 4, panelZ)
    rightInner.material = interiorMat
    this.cabinetMeshes.push(rightInner)

    // ========================================================================
    // 7. NEON EDGE TRIM (reactive to LCD theme)
    // ========================================================================
    // Vertical neon strips on front edges of side panels
    const neonLeft = MeshBuilder.CreateBox('cabinetNeonLeft', { width: 0.3, height: this.config.sideHeight - 4, depth: 0.3 }, this.scene)
    neonLeft.position.set(-halfW, this.config.sideHeight / 2 - 2, panelZ - halfD + 0.5)
    neonLeft.material = neonMat
    this.neonMeshes.push(neonLeft)

    const neonRight = MeshBuilder.CreateBox('cabinetNeonRight', { width: 0.3, height: this.config.sideHeight - 4, depth: 0.3 }, this.scene)
    neonRight.position.set(halfW, this.config.sideHeight / 2 - 2, panelZ - halfD + 0.5)
    neonRight.material = neonMat
    this.neonMeshes.push(neonRight)

    // Horizontal neon under marquee
    const neonMarquee = MeshBuilder.CreateBox('cabinetNeonMarquee', { width: this.config.width, height: 0.3, depth: 0.3 }, this.scene)
    neonMarquee.position.set(0, this.config.sideHeight - 2, this.config.backboxZ - 5.5)
    neonMarquee.material = neonMat
    this.neonMeshes.push(neonMarquee)

    // Coin door neon ring
    const neonCoin = MeshBuilder.CreateBox('cabinetNeonCoin', { width: 8.4, height: 5.4, depth: 0.2 }, this.scene)
    neonCoin.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 0.6)
    // Make it a hollow-looking frame by scaling UVs? No, just a thin rim:
    // Actually we'll use a slightly larger box behind the coin door
    neonCoin.scaling = new Vector3(1, 1, 0.1)
    neonCoin.material = neonMat
    this.neonMeshes.push(neonCoin)

    // ========================================================================
    // 8. INTERIOR ARCADE LIGHTING
    // ========================================================================
    // Point light inside cabinet casting upward glow on playfield edges
    const interiorGlow = new PointLight('cabinetInteriorGlow', new Vector3(0, 2, panelZ), this.scene)
    interiorGlow.intensity = 0.6
    interiorGlow.diffuse = color(this.currentNeonColor)
    interiorGlow.range = 25
    this.interiorLights.push(interiorGlow)

    // Spot light from marquee shining down on playfield
    const marqueeSpot = new SpotLight(
      'cabinetMarqueeSpot',
      new Vector3(0, this.config.sideHeight - 1, this.config.backboxZ - 4),
      new Vector3(0, -1, 0.3),
      Math.PI / 3,
      2,
      this.scene
    )
    marqueeSpot.intensity = 0.8
    marqueeSpot.diffuse = new Color3(1, 1, 0.95)
    this.interiorLights.push(marqueeSpot)

    // Side accent point lights near neon strips
    const leftAccent = new PointLight('cabinetLeftAccent', new Vector3(-halfW + 1, 6, panelZ - halfD + 2), this.scene)
    leftAccent.intensity = 0.4
    leftAccent.diffuse = color(this.currentNeonColor)
    leftAccent.range = 12
    this.interiorLights.push(leftAccent)

    const rightAccent = new PointLight('cabinetRightAccent', new Vector3(halfW - 1, 6, panelZ - halfD + 2), this.scene)
    rightAccent.intensity = 0.4
    rightAccent.diffuse = color(this.currentNeonColor)
    rightAccent.range = 12
    this.interiorLights.push(rightAccent)

    console.log('[Cabinet] Full 3D arcade cabinet built')
  }

  /**
   * Update the neon trim and interior lights to match a new LCD table map.
   */
  setThemeFromMap(mapName: TableMapType): void {
    const map = TABLE_MAPS[mapName]
    if (!map) return

    this.currentNeonColor = map.baseColor
    const matLib = getMaterialLibrary(this.scene)
    const newNeonMat = matLib.getCabinetNeonMaterial(this.currentNeonColor)

    // Update all neon meshes
    for (const mesh of this.neonMeshes) {
      mesh.material = newNeonMat
    }

    // Update interior light colors
    const glowColor = color(this.currentNeonColor)
    for (const light of this.interiorLights) {
      if (light.name === 'cabinetMarqueeSpot') continue // Keep spot white
      light.diffuse = glowColor
    }

    console.log(`[Cabinet] Theme updated to match map: ${mapName}`)
  }

  /**
   * Clean up all cabinet meshes and lights.
   */
  dispose(): void {
    for (const mesh of this.cabinetMeshes) {
      mesh.dispose(false, true)
    }
    this.cabinetMeshes = []

    for (const mesh of this.neonMeshes) {
      mesh.dispose(false, true)
    }
    this.neonMeshes = []

    for (const light of this.interiorLights) {
      light.dispose()
    }
    this.interiorLights = []
  }
}
