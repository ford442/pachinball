/**
 * Cabinet Builder - Full 3D Arcade Cabinet System with Presets
 *
 * Creates realistic physical arcade cabinets around the LCD playfield
 * with three distinct styles: Classic, Neo, Vertical.
 *
 * Architecture:
 * - Preset system: Classic (wood), Neo (sleek metal), Vertical (tall modern)
 * - Sculpted details: beveled trim, engraved logos, light bars, leg styles
 * - PBR materials with procedural textures
 * - Neon strips reactive to table map colors
 * - Instant preset switching without affecting playfield/physics
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
  TransformNode,
} from '@babylonjs/core'
import { getMaterialLibrary } from './material-library'
import { PALETTE, SURFACES, color } from './visual-language'
import type { TableMapType } from '../shaders/lcd-table'
import { TABLE_MAPS } from '../shaders/lcd-table'

export type CabinetPreset = 'classic' | 'neo' | 'vertical'

export interface CabinetConfig {
  /** Main wood/metal color */
  primaryColor?: string
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
  private currentPreset: CabinetPreset = 'classic'
  private config: Required<CabinetConfig>
  private rootNode: TransformNode | null = null

  constructor(scene: Scene, preset: CabinetPreset = 'classic', config?: CabinetConfig) {
    this.scene = scene
    this.currentPreset = preset
    this.config = {
      primaryColor: PALETTE.CYAN,
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
   * Build the complete cabinet based on current preset
   */
  buildCabinet(): void {
    this.dispose()

    // Create root node for easy positioning
    this.rootNode = new TransformNode('cabinetRoot', this.scene)

    // Route to preset-specific builder
    switch (this.currentPreset) {
      case 'classic':
        this.buildClassic()
        break
      case 'neo':
        this.buildNeo()
        break
      case 'vertical':
        this.buildVertical()
        break
      default:
        this.buildClassic()
    }

    console.log(`[Cabinet] Built ${this.currentPreset} preset`)
  }

  /**
   * Switch to a different preset instantly
   * Disposes old cabinet and builds new one
   */
  switchPreset(preset: CabinetPreset): void {
    if (preset === this.currentPreset) return
    this.currentPreset = preset
    this.buildCabinet()
  }

  getCurrentPreset(): CabinetPreset {
    return this.currentPreset
  }

  /**
   * CLASSIC PRESET: Traditional wooden pinball cabinet
   * - Warm wood tones with lacquer finish
   * - Rounded side panels with beveled trim
   * - Classic straight cylinder legs with round feet
   * - Simple neon strips on front edges
   * - Engraved logo plate on front
   */
  private buildClassic(): void {
    const matLib = getMaterialLibrary(this.scene)
    const woodMat = matLib.getCabinetWoodMaterial()
    const metalMat = matLib.getCabinetMetalTrimMaterial()
    // interiorMat is reserved for future interior detail work
    // const _interiorMat = matLib.getCabinetInteriorMaterial()
    const neonMat = matLib.getCabinetNeonMaterial(this.currentNeonColor)

    // Classic proportions
    const width = 32
    const depth = 44
    const sideHeight = 20
    const halfW = width / 2
    const halfD = depth / 2
    const panelZ = 5
    const sideThick = 2

    // ================================================================
    // 1. SIDE PANELS - Classic wood with beveled edges
    // ================================================================
    
    // Left side with beveled front edge
    const leftSide = MeshBuilder.CreateBox('cabLeftSide', 
      { width: sideThick, height: sideHeight, depth }, this.scene)
    leftSide.position.set(-halfW - sideThick / 2, sideHeight / 2 - 2, panelZ)
    leftSide.material = woodMat
    leftSide.parent = this.rootNode!
    this.cabinetMeshes.push(leftSide)

    // Bevel strip on front edge
    const leftBevel = MeshBuilder.CreateBox('cabLeftBevel',
      { width: 0.4, height: sideHeight - 2, depth: 0.4 }, this.scene)
    leftBevel.position.set(-halfW - 0.2, sideHeight / 2 - 2, panelZ - halfD + 0.2)
    leftBevel.material = woodMat
    leftBevel.parent = this.rootNode!
    this.cabinetMeshes.push(leftBevel)

    // Right side
    const rightSide = MeshBuilder.CreateBox('cabRightSide',
      { width: sideThick, height: sideHeight, depth }, this.scene)
    rightSide.position.set(halfW + sideThick / 2, sideHeight / 2 - 2, panelZ)
    rightSide.material = woodMat
    rightSide.parent = this.rootNode!
    this.cabinetMeshes.push(rightSide)

    // Right bevel
    const rightBevel = MeshBuilder.CreateBox('cabRightBevel',
      { width: 0.4, height: sideHeight - 2, depth: 0.4 }, this.scene)
    rightBevel.position.set(halfW + 0.2, sideHeight / 2 - 2, panelZ - halfD + 0.2)
    rightBevel.material = woodMat
    rightBevel.parent = this.rootNode!
    this.cabinetMeshes.push(rightBevel)

    // ================================================================
    // 2. TRIM RAILS - Metal trim on front edges
    // ================================================================
    const railHeight = sideHeight - 2
    const leftRail = MeshBuilder.CreateBox('cabLeftRail',
      { width: 0.4, height: railHeight, depth: depth + 1 }, this.scene)
    leftRail.position.set(-halfW + 0.2, sideHeight / 2 - 2, panelZ)
    leftRail.material = metalMat
    leftRail.parent = this.rootNode!
    this.cabinetMeshes.push(leftRail)

    const rightRail = MeshBuilder.CreateBox('cabRightRail',
      { width: 0.4, height: railHeight, depth: depth + 1 }, this.scene)
    rightRail.position.set(halfW - 0.2, sideHeight / 2 - 2, panelZ)
    rightRail.material = metalMat
    rightRail.parent = this.rootNode!
    this.cabinetMeshes.push(rightRail)

    // ================================================================
    // 3. FRONT PANEL - With engraved logo plate
    // ================================================================
    const frontPanel = MeshBuilder.CreateBox('cabFront',
      { width: 28, height: 8, depth: sideThick }, this.scene)
    frontPanel.position.set(0, -6, panelZ - halfD - sideThick / 2 - 1)
    frontPanel.material = woodMat
    frontPanel.parent = this.rootNode!
    this.cabinetMeshes.push(frontPanel)

    // Engraved logo plate (metallic inset)
    const logoPlate = MeshBuilder.CreateBox('cabLogoPlate',
      { width: 10, height: 3, depth: 0.2 }, this.scene)
    logoPlate.position.set(0, -6, panelZ - halfD - sideThick / 2 - 0.4)
    logoPlate.material = metalMat
    logoPlate.parent = this.rootNode!
    this.cabinetMeshes.push(logoPlate)

    // Coin door (black plastic inset)
    const coinDoor = MeshBuilder.CreateBox('cabCoinDoor',
      { width: 8, height: 5, depth: 0.3 }, this.scene)
    coinDoor.position.set(0, -6, panelZ - halfD - sideThick / 2 - 0.8)
    const coinMat = new StandardMaterial('coinMat', this.scene)
    coinMat.diffuseColor = new Color3(0.05, 0.05, 0.05)
    coinMat.specularColor = new Color3(0.3, 0.3, 0.3)
    coinDoor.material = coinMat
    coinDoor.parent = this.rootNode!
    this.cabinetMeshes.push(coinDoor)

    // Coin slot detail
    const coinSlot = MeshBuilder.CreateBox('cabCoinSlot',
      { width: 0.8, height: 2, depth: 0.4 }, this.scene)
    coinSlot.position.set(-2, -6, panelZ - halfD - sideThick / 2 - 0.7)
    coinSlot.material = metalMat
    coinSlot.parent = this.rootNode!
    this.cabinetMeshes.push(coinSlot)

    // ================================================================
    // 4. BACK PANEL
    // ================================================================
    const backPanel = MeshBuilder.CreateBox('cabBack',
      { width: 28, height: sideHeight, depth: sideThick }, this.scene)
    backPanel.position.set(0, sideHeight / 2 - 2, panelZ + halfD + sideThick / 2 + 1)
    backPanel.material = woodMat
    backPanel.parent = this.rootNode!
    this.cabinetMeshes.push(backPanel)

    // ================================================================
    // 5. BOTTOM BASE & CLASSIC LEGS
    // ================================================================
    const base = MeshBuilder.CreateBox('cabBase',
      { width: width + 2, height: 2, depth: depth + 2 }, this.scene)
    base.position.set(0, this.config.baseY + 1, panelZ)
    base.material = woodMat
    base.parent = this.rootNode!
    this.cabinetMeshes.push(base)

    // Classic straight cylinder legs with round feet
    const legPositions = [
      new Vector3(-halfW + 2, this.config.baseY - 3, panelZ - halfD + 3),
      new Vector3(halfW - 2, this.config.baseY - 3, panelZ - halfD + 3),
      new Vector3(-halfW + 2, this.config.baseY - 3, panelZ + halfD - 3),
      new Vector3(halfW - 2, this.config.baseY - 3, panelZ + halfD - 3),
    ]
    
    legPositions.forEach((pos, i) => {
      // Main leg cylinder
      const leg = MeshBuilder.CreateCylinder(`cabLeg${i}`,
        { diameter: 1.8, height: 6 }, this.scene)
      leg.position = pos
      leg.material = metalMat
      leg.parent = this.rootNode!
      this.cabinetMeshes.push(leg)

      // Round foot pad
      const foot = MeshBuilder.CreateCylinder(`cabFoot${i}`,
        { diameter: 2.4, height: 0.5 }, this.scene)
      foot.position = pos.clone()
      foot.position.y -= 3
      foot.material = metalMat
      foot.parent = this.rootNode!
      this.cabinetMeshes.push(foot)
    })

    // ================================================================
    // 6. MARQUEE HEADER
    // ================================================================
    const marquee = MeshBuilder.CreateBox('cabMarquee',
      { width: width + 2, height: 2, depth: 8 }, this.scene)
    marquee.position.set(0, sideHeight - 1, this.config.backboxZ - 2)
    marquee.material = woodMat
    marquee.parent = this.rootNode!
    this.cabinetMeshes.push(marquee)

    const marqueeLip = MeshBuilder.CreateBox('cabMarqueeLip',
      { width: width + 2, height: 0.5, depth: 0.5 }, this.scene)
    marqueeLip.position.set(0, sideHeight - 2.25, this.config.backboxZ - 5.75)
    marqueeLip.material = metalMat
    marqueeLip.parent = this.rootNode!
    this.cabinetMeshes.push(marqueeLip)

    // ================================================================
    // 7. NEON TRIM - Classic: front vertical strips only
    // ================================================================
    const neonLeft = MeshBuilder.CreateBox('neonLeft',
      { width: 0.3, height: sideHeight - 4, depth: 0.3 }, this.scene)
    neonLeft.position.set(-halfW, sideHeight / 2 - 2, panelZ - halfD + 0.5)
    neonLeft.material = neonMat
    neonLeft.parent = this.rootNode!
    this.neonMeshes.push(neonLeft)

    const neonRight = MeshBuilder.CreateBox('neonRight',
      { width: 0.3, height: sideHeight - 4, depth: 0.3 }, this.scene)
    neonRight.position.set(halfW, sideHeight / 2 - 2, panelZ - halfD + 0.5)
    neonRight.material = neonMat
    neonRight.parent = this.rootNode!
    this.neonMeshes.push(neonRight)

    // Under marquee horizontal neon
    const neonMarquee = MeshBuilder.CreateBox('neonMarquee',
      { width: width, height: 0.3, depth: 0.3 }, this.scene)
    neonMarquee.position.set(0, sideHeight - 2, this.config.backboxZ - 5.5)
    neonMarquee.material = neonMat
    neonMarquee.parent = this.rootNode!
    this.neonMeshes.push(neonMarquee)

    // ================================================================
    // 8. INTERIOR LIGHTING
    // ================================================================
    this.buildInteriorLights(halfW, panelZ, sideHeight)
  }

  /**
   * NEO PRESET: Sleek black metal, aggressive angles, extra neon
   * - Dark metal with satin finish
   * - Side panels taper inward toward bottom
   * - Angular blade legs
   * - Extra neon: horizontal bars, vertical strips, coin door ring
   */
  private buildNeo(): void {
    const matLib = getMaterialLibrary(this.scene)
    
    // Dark metal material for Neo
    const darkMetalMat = this.createDarkMetalMaterial()
    const accentMat = matLib.getCabinetMetalTrimMaterial()
    const neonMat = matLib.getCabinetNeonMaterial(this.currentNeonColor)

    // Neo proportions: wider, lower, sleeker
    const width = 34
    const depth = 44
    const sideHeight = 18
    const halfW = width / 2
    const halfD = depth / 2
    const panelZ = 5

    // ================================================================
    // 1. TAPERED SIDE PANELS - Aggressive angles
    // ================================================================
    
    // Left side - tapered (wider at top, narrower at bottom)
    const leftSide = MeshBuilder.CreateCylinder('neoLeftSide',
      { diameterTop: sideHeight * 0.6, diameterBottom: sideHeight * 0.35, height: depth, tessellation: 4 }, this.scene)
    leftSide.position.set(-halfW - 1, sideHeight / 2 - 2, panelZ)
    leftSide.rotation.x = Math.PI / 2
    leftSide.rotation.y = Math.PI / 4
    leftSide.material = darkMetalMat
    leftSide.parent = this.rootNode!
    this.cabinetMeshes.push(leftSide)

    // Right side
    const rightSide = MeshBuilder.CreateCylinder('neoRightSide',
      { diameterTop: sideHeight * 0.6, diameterBottom: sideHeight * 0.35, height: depth, tessellation: 4 }, this.scene)
    rightSide.position.set(halfW + 1, sideHeight / 2 - 2, panelZ)
    rightSide.rotation.x = Math.PI / 2
    rightSide.rotation.y = -Math.PI / 4
    rightSide.material = darkMetalMat
    rightSide.parent = this.rootNode!
    this.cabinetMeshes.push(rightSide)

    // ================================================================
    // 2. ANGULAR BLADE LEGS
    // ================================================================
    const legPositions = [
      { pos: new Vector3(-halfW + 2, this.config.baseY - 2, panelZ - halfD + 3), angle: -0.3 },
      { pos: new Vector3(halfW - 2, this.config.baseY - 2, panelZ - halfD + 3), angle: 0.3 },
      { pos: new Vector3(-halfW + 2, this.config.baseY - 2, panelZ + halfD - 3), angle: -0.3 },
      { pos: new Vector3(halfW - 2, this.config.baseY - 2, panelZ + halfD - 3), angle: 0.3 },
    ]

    legPositions.forEach((leg, i) => {
      // Blade leg (flattened box)
      const blade = MeshBuilder.CreateBox(`neoLeg${i}`,
        { width: 0.4, height: 7, depth: 2.5 }, this.scene)
      blade.position = leg.pos
      blade.rotation.z = leg.angle
      blade.material = accentMat
      blade.parent = this.rootNode!
      this.cabinetMeshes.push(blade)

      // Sharp foot
      const foot = MeshBuilder.CreateBox(`neoFoot${i}`,
        { width: 0.6, height: 0.3, depth: 3 }, this.scene)
      foot.position = leg.pos.clone()
      foot.position.y -= 3.5
      foot.material = accentMat
      foot.parent = this.rootNode!
      this.cabinetMeshes.push(foot)
    })

    // ================================================================
    // 3. FRONT PANEL - Sleek with angular coin door
    // ================================================================
    const frontPanel = MeshBuilder.CreateBox('neoFront',
      { width: 30, height: 6, depth: 1.5 }, this.scene)
    frontPanel.position.set(0, -7, panelZ - halfD - 0.5)
    frontPanel.material = darkMetalMat
    frontPanel.parent = this.rootNode!
    this.cabinetMeshes.push(frontPanel)

    // Hexagonal coin door
    const coinDoor = MeshBuilder.CreateCylinder('neoCoinDoor',
      { diameter: 7, height: 0.5, tessellation: 6 }, this.scene)
    coinDoor.position.set(0, -7, panelZ - halfD + 0.3)
    coinDoor.rotation.x = Math.PI / 2
    const coinMat = new StandardMaterial('neoCoinMat', this.scene)
    coinMat.diffuseColor = new Color3(0.02, 0.02, 0.02)
    coinMat.specularColor = new Color3(0.5, 0.5, 0.5)
    coinDoor.material = coinMat
    coinDoor.parent = this.rootNode!
    this.cabinetMeshes.push(coinDoor)

    // ================================================================
    // 4. BACK PANEL - Angular
    // ================================================================
    const backPanel = MeshBuilder.CreateBox('neoBack',
      { width: 30, height: sideHeight, depth: 1.5 }, this.scene)
    backPanel.position.set(0, sideHeight / 2 - 2, panelZ + halfD + 0.5)
    backPanel.material = darkMetalMat
    backPanel.parent = this.rootNode!
    this.cabinetMeshes.push(backPanel)

    // ================================================================
    // 5. TOP MARQUEE - Floating design
    // ================================================================
    const marquee = MeshBuilder.CreateBox('neoMarquee',
      { width: width + 2, height: 1.5, depth: 10 }, this.scene)
    marquee.position.set(0, sideHeight - 0.5, this.config.backboxZ - 2)
    marquee.material = darkMetalMat
    marquee.parent = this.rootNode!
    this.cabinetMeshes.push(marquee)

    // Floating lip
    const marqueeLip = MeshBuilder.CreateBox('neoMarqueeLip',
      { width: width + 4, height: 0.3, depth: 1 }, this.scene)
    marqueeLip.position.set(0, sideHeight - 1.5, this.config.backboxZ - 6.5)
    marqueeLip.material = accentMat
    marqueeLip.parent = this.rootNode!
    this.cabinetMeshes.push(marqueeLip)

    // ================================================================
    // 6. EXTRA NEON - Neo signature look
    // ================================================================
    
    // Vertical light strips on side panel fronts
    for (let i = 0; i < 3; i++) {
      const yPos = 2 + i * 5
      const leftStrip = MeshBuilder.CreateBox(`neoNeonL${i}`,
        { width: 0.2, height: 3, depth: 0.2 }, this.scene)
      leftStrip.position.set(-halfW - 0.5, yPos, panelZ - halfD + 0.5)
      leftStrip.material = neonMat
      leftStrip.parent = this.rootNode!
      this.neonMeshes.push(leftStrip)

      const rightStrip = MeshBuilder.CreateBox(`neoNeonR${i}`,
        { width: 0.2, height: 3, depth: 0.2 }, this.scene)
      rightStrip.position.set(halfW + 0.5, yPos, panelZ - halfD + 0.5)
      rightStrip.material = neonMat
      rightStrip.parent = this.rootNode!
      this.neonMeshes.push(rightStrip)
    }

    // Horizontal light bars on sides
    const leftBar = MeshBuilder.CreateBox('neoNeonBarL',
      { width: 0.3, height: 0.3, depth: depth - 4 }, this.scene)
    leftBar.position.set(-halfW - 0.5, sideHeight / 2, panelZ)
    leftBar.material = neonMat
    leftBar.parent = this.rootNode!
    this.neonMeshes.push(leftBar)

    const rightBar = MeshBuilder.CreateBox('neoNeonBarR',
      { width: 0.3, height: 0.3, depth: depth - 4 }, this.scene)
    rightBar.position.set(halfW + 0.5, sideHeight / 2, panelZ)
    rightBar.material = neonMat
    rightBar.parent = this.rootNode!
    this.neonMeshes.push(rightBar)

    // Coin door neon ring
    const coinRing = MeshBuilder.CreateTorus('neoCoinRing',
      { diameter: 7.5, thickness: 0.15 }, this.scene)
    coinRing.position.set(0, -7, panelZ - halfD + 0.5)
    coinRing.material = neonMat
    coinRing.parent = this.rootNode!
    this.neonMeshes.push(coinRing)

    // Under marquee
    const marqueeNeon = MeshBuilder.CreateBox('neoNeonMarquee',
      { width: width, height: 0.2, depth: 0.3 }, this.scene)
    marqueeNeon.position.set(0, sideHeight - 1.2, this.config.backboxZ - 6)
    marqueeNeon.material = neonMat
    marqueeNeon.parent = this.rootNode!
    this.neonMeshes.push(marqueeNeon)

    // ================================================================
    // 7. INTERIOR LIGHTING
    // ================================================================
    this.buildInteriorLights(halfW, panelZ, sideHeight, true)
  }

  /**
   * VERTICAL PRESET: Taller/narrower modern cabinet with bigger backbox
   * - Narrower width, significantly taller
   * - Slim legs
   * - Extended backbox
   * - Extra vertical neon strips
   */
  private buildVertical(): void {
    const matLib = getMaterialLibrary(this.scene)
    const woodMat = matLib.getCabinetWoodMaterial()
    const metalMat = matLib.getCabinetMetalTrimMaterial()
    const neonMat = matLib.getCabinetNeonMaterial(this.currentNeonColor)

    // Vertical proportions: narrower, taller, deeper backbox
    const width = 28
    const depth = 44
    const sideHeight = 26
    const backboxZ = 34
    const halfW = width / 2
    const halfD = depth / 2
    const panelZ = 5
    const sideThick = 2

    // ================================================================
    // 1. TALL SIDE PANELS
    // ================================================================
    const leftSide = MeshBuilder.CreateBox('vertLeftSide',
      { width: sideThick, height: sideHeight, depth }, this.scene)
    leftSide.position.set(-halfW - sideThick / 2, sideHeight / 2 - 2, panelZ)
    leftSide.material = woodMat
    leftSide.parent = this.rootNode!
    this.cabinetMeshes.push(leftSide)

    const rightSide = MeshBuilder.CreateBox('vertRightSide',
      { width: sideThick, height: sideHeight, depth }, this.scene)
    rightSide.position.set(halfW + sideThick / 2, sideHeight / 2 - 2, panelZ)
    rightSide.material = woodMat
    rightSide.parent = this.rootNode!
    this.cabinetMeshes.push(rightSide)

    // ================================================================
    // 2. TRIM RAILS
    // ================================================================
    const railHeight = sideHeight - 2
    const leftRail = MeshBuilder.CreateBox('vertLeftRail',
      { width: 0.4, height: railHeight, depth: depth + 1 }, this.scene)
    leftRail.position.set(-halfW + 0.2, sideHeight / 2 - 2, panelZ)
    leftRail.material = metalMat
    leftRail.parent = this.rootNode!
    this.cabinetMeshes.push(leftRail)

    const rightRail = MeshBuilder.CreateBox('vertRightRail',
      { width: 0.4, height: railHeight, depth: depth + 1 }, this.scene)
    rightRail.position.set(halfW - 0.2, sideHeight / 2 - 2, panelZ)
    rightRail.material = metalMat
    rightRail.parent = this.rootNode!
    this.cabinetMeshes.push(rightRail)

    // ================================================================
    // 3. FRONT PANEL
    // ================================================================
    const frontPanel = MeshBuilder.CreateBox('vertFront',
      { width: 24, height: 8, depth: sideThick }, this.scene)
    frontPanel.position.set(0, -6, panelZ - halfD - sideThick / 2 - 1)
    frontPanel.material = woodMat
    frontPanel.parent = this.rootNode!
    this.cabinetMeshes.push(frontPanel)

    const coinDoor = MeshBuilder.CreateBox('vertCoinDoor',
      { width: 7, height: 5, depth: 0.3 }, this.scene)
    coinDoor.position.set(0, -6, panelZ - halfD - sideThick / 2 - 0.8)
    const coinMat = new StandardMaterial('vertCoinMat', this.scene)
    coinMat.diffuseColor = new Color3(0.05, 0.05, 0.05)
    coinMat.specularColor = new Color3(0.3, 0.3, 0.3)
    coinDoor.material = coinMat
    coinDoor.parent = this.rootNode!
    this.cabinetMeshes.push(coinDoor)

    // ================================================================
    // 4. BACK PANEL
    // ================================================================
    const backPanel = MeshBuilder.CreateBox('vertBack',
      { width: 24, height: sideHeight, depth: sideThick }, this.scene)
    backPanel.position.set(0, sideHeight / 2 - 2, panelZ + halfD + sideThick / 2 + 1)
    backPanel.material = woodMat
    backPanel.parent = this.rootNode!
    this.cabinetMeshes.push(backPanel)

    // ================================================================
    // 5. BOTTOM BASE & SLIM LEGS
    // ================================================================
    const base = MeshBuilder.CreateBox('vertBase',
      { width: width + 2, height: 2, depth: depth + 2 }, this.scene)
    base.position.set(0, this.config.baseY + 1, panelZ)
    base.material = woodMat
    base.parent = this.rootNode!
    this.cabinetMeshes.push(base)

    // Slim cylinder legs
    const legPositions = [
      new Vector3(-halfW + 2, this.config.baseY - 3, panelZ - halfD + 3),
      new Vector3(halfW - 2, this.config.baseY - 3, panelZ - halfD + 3),
      new Vector3(-halfW + 2, this.config.baseY - 3, panelZ + halfD - 3),
      new Vector3(halfW - 2, this.config.baseY - 3, panelZ + halfD - 3),
    ]
    
    legPositions.forEach((pos, i) => {
      // Slim leg
      const leg = MeshBuilder.CreateCylinder(`vertLeg${i}`,
        { diameter: 1.2, height: 6 }, this.scene)
      leg.position = pos
      leg.material = metalMat
      leg.parent = this.rootNode!
      this.cabinetMeshes.push(leg)

      // Sleek foot
      const foot = MeshBuilder.CreateCylinder(`vertFoot${i}`,
        { diameter: 1.8, height: 0.4 }, this.scene)
      foot.position = pos.clone()
      foot.position.y -= 3
      foot.material = metalMat
      foot.parent = this.rootNode!
      this.cabinetMeshes.push(foot)
    })

    // ================================================================
    // 6. EXTENDED BACKBOX MARQUEE
    // ================================================================
    const marquee = MeshBuilder.CreateBox('vertMarquee',
      { width: width + 2, height: 3, depth: 12 }, this.scene)
    marquee.position.set(0, sideHeight - 1.5, backboxZ - 2)
    marquee.material = woodMat
    marquee.parent = this.rootNode!
    this.cabinetMeshes.push(marquee)

    const marqueeLip = MeshBuilder.CreateBox('vertMarqueeLip',
      { width: width + 2, height: 0.5, depth: 0.5 }, this.scene)
    marqueeLip.position.set(0, sideHeight - 3, backboxZ - 7.75)
    marqueeLip.material = metalMat
    marqueeLip.parent = this.rootNode!
    this.cabinetMeshes.push(marqueeLip)

    // ================================================================
    // 7. VERTICAL NEON - Extra tall strips
    // ================================================================
    
    // Tall front vertical strips
    const neonLeft = MeshBuilder.CreateBox('vertNeonLeft',
      { width: 0.3, height: sideHeight - 6, depth: 0.3 }, this.scene)
    neonLeft.position.set(-halfW, sideHeight / 2 - 1, panelZ - halfD + 0.5)
    neonLeft.material = neonMat
    neonLeft.parent = this.rootNode!
    this.neonMeshes.push(neonLeft)

    const neonRight = MeshBuilder.CreateBox('vertNeonRight',
      { width: 0.3, height: sideHeight - 6, depth: 0.3 }, this.scene)
    neonRight.position.set(halfW, sideHeight / 2 - 1, panelZ - halfD + 0.5)
    neonRight.material = neonMat
    neonRight.parent = this.rootNode!
    this.neonMeshes.push(neonRight)

    // Side panel vertical strips (3 per side)
    for (let i = 0; i < 3; i++) {
      const yPos = 4 + i * 7
      const leftV = MeshBuilder.CreateBox(`vertNeonVL${i}`,
        { width: 0.2, height: 5, depth: 0.2 }, this.scene)
      leftV.position.set(-halfW - sideThick / 2, yPos, panelZ - halfD + 6 + i * 10)
      leftV.material = neonMat
      leftV.parent = this.rootNode!
      this.neonMeshes.push(leftV)

      const rightV = MeshBuilder.CreateBox(`vertNeonVR${i}`,
        { width: 0.2, height: 5, depth: 0.2 }, this.scene)
      rightV.position.set(halfW + sideThick / 2, yPos, panelZ - halfD + 6 + i * 10)
      rightV.material = neonMat
      rightV.parent = this.rootNode!
      this.neonMeshes.push(rightV)
    }

    // Extended marquee neon
    const neonMarquee = MeshBuilder.CreateBox('vertNeonMarquee',
      { width: width, height: 0.3, depth: 0.3 }, this.scene)
    neonMarquee.position.set(0, sideHeight - 2.5, backboxZ - 7.5)
    neonMarquee.material = neonMat
    neonMarquee.parent = this.rootNode!
    this.neonMeshes.push(neonMarquee)

    // Backbox accent neon
    const backboxNeon = MeshBuilder.CreateBox('vertNeonBackbox',
      { width: 0.3, height: 0.3, depth: 10 }, this.scene)
    backboxNeon.position.set(0, sideHeight - 3, backboxZ - 2)
    backboxNeon.material = neonMat
    backboxNeon.parent = this.rootNode!
    this.neonMeshes.push(backboxNeon)

    // ================================================================
    // 8. INTERIOR LIGHTING
    // ================================================================
    this.buildInteriorLights(halfW, panelZ, sideHeight, false, backboxZ)
  }

  /**
   * Build interior lighting that reacts to map color
   */
  private buildInteriorLights(halfW: number, panelZ: number, sideHeight: number, isNeo: boolean = false, backboxZ?: number): void {
    const interiorGlow = new PointLight('cabInteriorGlow', new Vector3(0, 2, panelZ), this.scene)
    interiorGlow.intensity = isNeo ? 0.8 : 0.6
    interiorGlow.diffuse = color(this.currentNeonColor)
    interiorGlow.range = isNeo ? 30 : 25
    this.interiorLights.push(interiorGlow)

    const marqueeSpot = new SpotLight(
      'cabMarqueeSpot',
      new Vector3(0, sideHeight - 1, (backboxZ || this.config.backboxZ) - 4),
      new Vector3(0, -1, 0.3),
      Math.PI / 3,
      2,
      this.scene
    )
    marqueeSpot.intensity = isNeo ? 1.0 : 0.8
    marqueeSpot.diffuse = new Color3(1, 1, 0.95)
    this.interiorLights.push(marqueeSpot)

    // Side accent lights
    const leftAccent = new PointLight('cabLeftAccent', new Vector3(-halfW + 1, 6, panelZ - halfW + 2), this.scene)
    leftAccent.intensity = isNeo ? 0.5 : 0.4
    leftAccent.diffuse = color(this.currentNeonColor)
    leftAccent.range = isNeo ? 15 : 12
    this.interiorLights.push(leftAccent)

    const rightAccent = new PointLight('cabRightAccent', new Vector3(halfW - 1, 6, panelZ - halfW + 2), this.scene)
    rightAccent.intensity = isNeo ? 0.5 : 0.4
    rightAccent.diffuse = color(this.currentNeonColor)
    rightAccent.range = isNeo ? 15 : 12
    this.interiorLights.push(rightAccent)

    // Neo gets extra interior glow
    if (isNeo) {
      const underGlow = new PointLight('cabUnderGlow', new Vector3(0, -2, panelZ), this.scene)
      underGlow.intensity = 0.4
      underGlow.diffuse = color(this.currentNeonColor)
      underGlow.range = 20
      this.interiorLights.push(underGlow)
    }
  }

  /**
   * Create dark metal material for Neo preset
   */
  private createDarkMetalMaterial(): StandardMaterial {
    const mat = new StandardMaterial('darkMetal', this.scene)
    mat.diffuseColor = new Color3(0.05, 0.05, 0.06)
    mat.specularColor = new Color3(0.4, 0.4, 0.45)
    mat.roughness = 0.35
    return mat
  }

  /**
   * Update the neon trim and interior lights to match a new LCD table map
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
      if (light.name === 'cabMarqueeSpot') continue
      light.diffuse = glowColor
    }

    console.log(`[Cabinet] Theme updated for ${this.currentPreset}: ${mapName}`)
  }

  /**
   * Clean up all cabinet meshes and lights
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

    if (this.rootNode) {
      this.rootNode.dispose()
      this.rootNode = null
    }
  }
}
