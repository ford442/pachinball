/**
 * Cabinet Builder - Modular Arcade Cabinet System with Multiple Presets
 *
 * Supports multiple cabinet presets that can be swapped at runtime:
 * - classic: Traditional wooden pinball cabinet
 * - neo: Sleek black metal with aggressive angles and more neon
 * - vertical: Taller, narrower cabinet (modern vertical shooter style)
 * - wide: Wider cabinet for deluxe feel (future)
 *
 * Architecture:
 * - Preset-based configuration system
 * - Each preset defines: dimensions, materials, neon layout, lights
 * - Playfield position stays constant across all presets
 * - PBR materials with preset-specific textures/colors
 * - Reactive to LCD table map colors
 * - Ready for .glb loading via storage_manager
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
  PBRMaterial,
} from '@babylonjs/core'
import { getMaterialLibrary } from './material-library'
import { PALETTE, color } from './visual-language'
import type { TableMapType } from '../shaders/lcd-table'
import { TABLE_MAPS } from '../shaders/lcd-table'

export type CabinetType = 'classic' | 'neo' | 'vertical' | 'wide'

export interface CabinetPreset {
  /** Preset identifier */
  type: CabinetType
  /** Display name */
  name: string
  /** Description for UI */
  description: string

  // Dimensions
  width: number
  depth: number
  sideHeight: number
  baseY: number
  backboxZ: number
  backboxHeight: number
  backboxDepth: number

  // Materials
  bodyMaterial: 'wood' | 'metal' | 'matte_black' | 'carbon_fiber'
  trimMaterial: 'chrome' | 'black_metal' | 'gold' | 'copper'
  interiorMaterial: 'dark_felt' | 'matte_black' | 'gloss_black'

  // Neon layout
  neonLayout: {
    frontVertical: boolean
    sideHorizontal: boolean
    marquee: boolean
    coinDoor: boolean
    underCabinet: boolean
    backboxEdge: boolean
  }

  // Lighting positions (relative to cabinet center)
  lightPoints: {
    interior: Vector3
    leftAccent: Vector3
    rightAccent: Vector3
    marqueeSpot: { pos: Vector3; target: Vector3 }
    underGlow?: Vector3
  }

  // Special features
  hasAngledSides: boolean
  hasExtendedMarquee: boolean
  hasCoinDoor: boolean
}

// Preset definitions
export const CABINET_PRESETS: Record<CabinetType, CabinetPreset> = {
  classic: {
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
  },

  neo: {
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
  },

  vertical: {
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
  },

  wide: {
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
  },
}

// Singleton instance
let cabinetBuilderInstance: CabinetBuilder | null = null

export function getCabinetBuilder(scene?: Scene): CabinetBuilder {
  if (!cabinetBuilderInstance && scene) {
    cabinetBuilderInstance = new CabinetBuilder(scene)
  }
  return cabinetBuilderInstance!
}

export function resetCabinetBuilder(): void {
  cabinetBuilderInstance?.dispose()
  cabinetBuilderInstance = null
}

export class CabinetBuilder {
  private scene: Scene
  private cabinetMeshes: Mesh[] = []
  private neonMeshes: Mesh[] = []
  private interiorLights: (PointLight | SpotLight)[] = []
  private currentNeonColor: string = PALETTE.CYAN
  private currentPreset: CabinetPreset = CABINET_PRESETS.classic

  constructor(scene: Scene) {
    this.scene = scene
  }

  /**
   * Load a cabinet preset and rebuild the entire cabinet.
   * Playfield position remains constant.
   */
  loadCabinetPreset(type: CabinetType): void {
    const preset = CABINET_PRESETS[type]
    if (!preset) {
      console.warn(`[Cabinet] Unknown preset: ${type}`)
      return
    }

    this.currentPreset = preset
    this.dispose()
    this.buildCabinet()

    console.log(`[Cabinet] Loaded preset: ${preset.name}`)
  }

  /**
   * Cycle to the next cabinet preset.
   * Returns the new preset type.
   */
  cycleCabinetPreset(): CabinetType {
    const types: CabinetType[] = ['classic', 'neo', 'vertical', 'wide']
    const currentIndex = types.indexOf(this.currentPreset.type)
    const nextIndex = (currentIndex + 1) % types.length
    const nextType = types[nextIndex]

    this.loadCabinetPreset(nextType)
    return nextType
  }

  /**
   * Get the current preset type.
   */
  getCurrentPreset(): CabinetType {
    return this.currentPreset.type
  }

  /**
   * Get all available presets.
   */
  getAvailablePresets(): { type: CabinetType; name: string; description: string }[] {
    return Object.values(CABINET_PRESETS).map(p => ({
      type: p.type,
      name: p.name,
      description: p.description,
    }))
  }

  /**
   * Build the complete cabinet using the current preset.
   */
  buildCabinet(): void {
    const preset = this.currentPreset
    const matLib = getMaterialLibrary(this.scene)

    // Get materials based on preset
    const bodyMat = this.getBodyMaterial(preset.bodyMaterial, matLib)
    const trimMat = this.getTrimMaterial(preset.trimMaterial, matLib)
    const interiorMat = this.getInteriorMaterial(preset.interiorMaterial, matLib)
    const neonMat = matLib.getCabinetNeonMaterial(this.currentNeonColor)

    const halfW = preset.width / 2
    const halfD = preset.depth / 2
    const playfieldW = 28
    const playfieldD = 36
    const pfHalfW = playfieldW / 2
    const pfHalfD = playfieldD / 2
    const sideThick = 2
    const panelZ = 5

    // ========================================================================
    // 1. SIDE PANELS
    // ========================================================================
    if (preset.hasAngledSides) {
      // Neo-style angled sides
      this.buildAngledSides(preset, bodyMat, trimMat, halfW, halfD, panelZ, sideThick)
    } else {
      // Classic straight sides
      this.buildStraightSides(preset, bodyMat, trimMat, halfW, halfD, panelZ, sideThick)
    }

    // ========================================================================
    // 2. FRONT PANEL
    // ========================================================================
    if (preset.hasCoinDoor) {
      this.buildFrontWithCoinDoor(preset, bodyMat, trimMat, panelZ, pfHalfW, pfHalfD, sideThick)
    } else {
      this.buildSolidFront(preset, bodyMat, panelZ, pfHalfW, pfHalfD, sideThick)
    }

    // ========================================================================
    // 3. BACK PANEL
    // ========================================================================
    const backPanel = MeshBuilder.CreateBox(
      'cabinetBackPanel',
      { width: playfieldW + 2, height: preset.sideHeight, depth: sideThick },
      this.scene
    )
    backPanel.position.set(0, preset.sideHeight / 2 - 2, panelZ + pfHalfD + sideThick / 2 + 1)
    backPanel.material = bodyMat
    this.cabinetMeshes.push(backPanel)

    // ========================================================================
    // 4. BOTTOM BASE & LEGS
    // ========================================================================
    this.buildBaseAndLegs(preset, bodyMat, trimMat, halfW, halfD, panelZ)

    // ========================================================================
    // 5. BACKBOX (marquee area)
    // ========================================================================
    this.buildBackbox(preset, bodyMat, trimMat, neonMat)

    // ========================================================================
    // 6. INTERIOR WALLS
    // ========================================================================
    this.buildInteriorWalls(preset, interiorMat, pfHalfW, pfHalfD, panelZ)

    // ========================================================================
    // 7. NEON TRIM (based on preset layout)
    // ========================================================================
    this.buildNeonTrim(preset, neonMat, halfW, halfD, panelZ, pfHalfD, sideThick)

    // ========================================================================
    // 8. INTERIOR LIGHTING
    // ========================================================================
    this.buildInteriorLighting(preset)

    console.log(`[Cabinet] Built ${preset.name} cabinet`)
  }

  private buildAngledSides(
    preset: CabinetPreset,
    bodyMat: StandardMaterial | PBRMaterial,
    trimMat: StandardMaterial | PBRMaterial,
    halfW: number,
    _halfD: number,
    panelZ: number,
    sideThick: number
  ): void {
    // Main side panels (slightly angled inward at top)
    const sideHeight = preset.sideHeight
    const angle = Math.PI / 24 // 7.5 degree inward angle

    // Left side
    const leftSide = MeshBuilder.CreateBox(
      'cabinetLeftSide',
      { width: sideThick, height: sideHeight, depth: preset.depth },
      this.scene
    )
    leftSide.position.set(-halfW - sideThick / 2, sideHeight / 2 - 2, panelZ)
    leftSide.rotation.z = angle
    leftSide.material = bodyMat
    this.cabinetMeshes.push(leftSide)

    // Right side
    const rightSide = MeshBuilder.CreateBox(
      'cabinetRightSide',
      { width: sideThick, height: sideHeight, depth: preset.depth },
      this.scene
    )
    rightSide.position.set(halfW + sideThick / 2, sideHeight / 2 - 2, panelZ)
    rightSide.rotation.z = -angle
    rightSide.material = bodyMat
    this.cabinetMeshes.push(rightSide)

    // Metal trim rails
    const railHeight = sideHeight - 2
    const railThick = 0.4

    const leftRail = MeshBuilder.CreateBox(
      'cabinetLeftRail',
      { width: railThick, height: railHeight, depth: preset.depth + 1 },
      this.scene
    )
    leftRail.position.set(-halfW + railThick / 2, sideHeight / 2 - 2, panelZ)
    leftRail.rotation.z = angle
    leftRail.material = trimMat
    this.cabinetMeshes.push(leftRail)

    const rightRail = MeshBuilder.CreateBox(
      'cabinetRightRail',
      { width: railThick, height: railHeight, depth: preset.depth + 1 },
      this.scene
    )
    rightRail.position.set(halfW - railThick / 2, sideHeight / 2 - 2, panelZ)
    rightRail.rotation.z = -angle
    rightRail.material = trimMat
    this.cabinetMeshes.push(rightRail)
  }

  private buildStraightSides(
    preset: CabinetPreset,
    bodyMat: StandardMaterial | PBRMaterial,
    trimMat: StandardMaterial | PBRMaterial,
    halfW: number,
    _halfD: number,
    panelZ: number,
    sideThick: number
  ): void {
    // Left side
    const leftSide = MeshBuilder.CreateBox(
      'cabinetLeftSide',
      { width: sideThick, height: preset.sideHeight, depth: preset.depth },
      this.scene
    )
    leftSide.position.set(-halfW - sideThick / 2, preset.sideHeight / 2 - 2, panelZ)
    leftSide.material = bodyMat
    this.cabinetMeshes.push(leftSide)

    // Right side
    const rightSide = MeshBuilder.CreateBox(
      'cabinetRightSide',
      { width: sideThick, height: preset.sideHeight, depth: preset.depth },
      this.scene
    )
    rightSide.position.set(halfW + sideThick / 2, preset.sideHeight / 2 - 2, panelZ)
    rightSide.material = bodyMat
    this.cabinetMeshes.push(rightSide)

    // Metal trim rails
    const railHeight = preset.sideHeight - 2
    const railThick = 0.4

    const leftRail = MeshBuilder.CreateBox(
      'cabinetLeftRail',
      { width: railThick, height: railHeight, depth: preset.depth + 1 },
      this.scene
    )
    leftRail.position.set(-halfW + railThick / 2, preset.sideHeight / 2 - 2, panelZ)
    leftRail.material = trimMat
    this.cabinetMeshes.push(leftRail)

    const rightRail = MeshBuilder.CreateBox(
      'cabinetRightRail',
      { width: railThick, height: railHeight, depth: preset.depth + 1 },
      this.scene
    )
    rightRail.position.set(halfW - railThick / 2, preset.sideHeight / 2 - 2, panelZ)
    rightRail.material = trimMat
    this.cabinetMeshes.push(rightRail)
  }

  private buildFrontWithCoinDoor(
    _preset: CabinetPreset,
    bodyMat: StandardMaterial | PBRMaterial,
    trimMat: StandardMaterial | PBRMaterial,
    panelZ: number,
    _pfHalfW: number,
    pfHalfD: number,
    sideThick: number
  ): void {
    const playfieldW = 28

    const frontPanel = MeshBuilder.CreateBox(
      'cabinetFrontPanel',
      { width: playfieldW + 2, height: 8, depth: sideThick },
      this.scene
    )
    frontPanel.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 1)
    frontPanel.material = bodyMat
    this.cabinetMeshes.push(frontPanel)

    // Coin door
    const coinDoor = MeshBuilder.CreateBox('cabinetCoinDoor', { width: 8, height: 5, depth: 0.3 }, this.scene)
    coinDoor.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 0.8)
    const coinMat = new StandardMaterial('coinDoorMat', this.scene)
    coinMat.diffuseColor = new Color3(0.05, 0.05, 0.05)
    coinMat.specularColor = new Color3(0.3, 0.3, 0.3)
    coinDoor.material = coinMat
    this.cabinetMeshes.push(coinDoor)

    // Coin slot
    const coinSlot = MeshBuilder.CreateBox('cabinetCoinSlot', { width: 0.8, height: 2, depth: 0.4 }, this.scene)
    coinSlot.position.set(-2, -6, panelZ - pfHalfD - sideThick / 2 - 0.7)
    coinSlot.material = trimMat
    this.cabinetMeshes.push(coinSlot)
  }

  private buildSolidFront(
    _preset: CabinetPreset,
    bodyMat: StandardMaterial | PBRMaterial,
    panelZ: number,
    _pfHalfW: number,
    pfHalfD: number,
    sideThick: number
  ): void {
    const playfieldW = 28

    const frontPanel = MeshBuilder.CreateBox(
      'cabinetFrontPanel',
      { width: playfieldW + 2, height: 8, depth: sideThick },
      this.scene
    )
    frontPanel.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 1)
    frontPanel.material = bodyMat
    this.cabinetMeshes.push(frontPanel)
  }

  private buildBaseAndLegs(
    preset: CabinetPreset,
    bodyMat: StandardMaterial | PBRMaterial,
    trimMat: StandardMaterial | PBRMaterial,
    halfW: number,
    halfD: number,
    panelZ: number
  ): void {
    // Base
    const base = MeshBuilder.CreateBox(
      'cabinetBase',
      { width: preset.width + 2, height: 2, depth: preset.depth + 2 },
      this.scene
    )
    base.position.set(0, preset.baseY + 1, panelZ)
    base.material = bodyMat
    this.cabinetMeshes.push(base)

    // Legs
    const legPositions = [
      new Vector3(-halfW + 1, preset.baseY - 3, panelZ - halfD + 2),
      new Vector3(halfW - 1, preset.baseY - 3, panelZ - halfD + 2),
      new Vector3(-halfW + 1, preset.baseY - 3, panelZ + halfD - 2),
      new Vector3(halfW - 1, preset.baseY - 3, panelZ + halfD - 2),
    ]

    for (let i = 0; i < legPositions.length; i++) {
      const leg = MeshBuilder.CreateCylinder(`cabinetLeg${i}`, { diameter: 1.8, height: 6 }, this.scene)
      leg.position = legPositions[i]
      leg.material = trimMat
      this.cabinetMeshes.push(leg)

      // Foot pad
      const foot = MeshBuilder.CreateCylinder(`cabinetFoot${i}`, { diameter: 2.4, height: 0.5 }, this.scene)
      foot.position = legPositions[i].clone()
      foot.position.y -= 3
      foot.material = trimMat
      this.cabinetMeshes.push(foot)
    }
  }

  private buildBackbox(
    preset: CabinetPreset,
    bodyMat: StandardMaterial | PBRMaterial,
    trimMat: StandardMaterial | PBRMaterial,
    _neonMat: PBRMaterial
  ): void {
    const bbWidth = preset.width + 2
    const bbHeight = preset.backboxHeight
    const bbDepth = preset.backboxDepth

    // Main backbox
    const backbox = MeshBuilder.CreateBox(
      'cabinetBackbox',
      { width: bbWidth, height: bbHeight, depth: bbDepth },
      this.scene
    )
    backbox.position.set(0, preset.sideHeight + bbHeight / 2 - 1, preset.backboxZ - bbDepth / 2)
    backbox.material = bodyMat
    this.cabinetMeshes.push(backbox)

    // Marquee panel
    const marqueeHeight = preset.hasExtendedMarquee ? 4 : 2
    const marquee = MeshBuilder.CreateBox(
      'cabinetMarquee',
      { width: bbWidth, height: marqueeHeight, depth: 2 },
      this.scene
    )
    marquee.position.set(
      0,
      preset.sideHeight + bbHeight - marqueeHeight / 2,
      preset.backboxZ - bbDepth - 1
    )
    marquee.material = bodyMat
    this.cabinetMeshes.push(marquee)

    // Marquee trim
    const marqueeLip = MeshBuilder.CreateBox(
      'cabinetMarqueeLip',
      { width: bbWidth, height: 0.5, depth: 0.5 },
      this.scene
    )
    marqueeLip.position.set(0, preset.sideHeight + bbHeight - 2, preset.backboxZ - bbDepth - 2.25)
    marqueeLip.material = trimMat
    this.cabinetMeshes.push(marqueeLip)
  }

  private buildInteriorWalls(
    preset: CabinetPreset,
    interiorMat: StandardMaterial | PBRMaterial,
    pfHalfW: number,
    _pfHalfD: number,
    panelZ: number
  ): void {
    const leftInner = MeshBuilder.CreateBox(
      'cabinetLeftInner',
      { width: 0.5, height: preset.sideHeight - 4, depth: 36 },
      this.scene
    )
    leftInner.position.set(-pfHalfW - 0.25, preset.sideHeight / 2 - 4, panelZ)
    leftInner.material = interiorMat
    this.cabinetMeshes.push(leftInner)

    const rightInner = MeshBuilder.CreateBox(
      'cabinetRightInner',
      { width: 0.5, height: preset.sideHeight - 4, depth: 36 },
      this.scene
    )
    rightInner.position.set(pfHalfW + 0.25, preset.sideHeight / 2 - 4, panelZ)
    rightInner.material = interiorMat
    this.cabinetMeshes.push(rightInner)
  }

  private buildNeonTrim(
    preset: CabinetPreset,
    neonMat: PBRMaterial,
    halfW: number,
    halfD: number,
    panelZ: number,
    pfHalfD: number,
    sideThick: number
  ): void {
    const layout = preset.neonLayout

    // Front vertical strips
    if (layout.frontVertical) {
      const neonLeft = MeshBuilder.CreateBox(
        'cabinetNeonLeft',
        { width: 0.3, height: preset.sideHeight - 4, depth: 0.3 },
        this.scene
      )
      neonLeft.position.set(-halfW, preset.sideHeight / 2 - 2, panelZ - halfD + 0.5)
      neonLeft.material = neonMat
      this.neonMeshes.push(neonLeft)

      const neonRight = MeshBuilder.CreateBox(
        'cabinetNeonRight',
        { width: 0.3, height: preset.sideHeight - 4, depth: 0.3 },
        this.scene
      )
      neonRight.position.set(halfW, preset.sideHeight / 2 - 2, panelZ - halfD + 0.5)
      neonRight.material = neonMat
      this.neonMeshes.push(neonRight)
    }

    // Side horizontal strips (neo only)
    if (layout.sideHorizontal) {
      const neonSideTop = MeshBuilder.CreateBox(
        'cabinetNeonSideTop',
        { width: 0.3, height: 0.3, depth: preset.depth },
        this.scene
      )
      neonSideTop.position.set(-halfW, preset.sideHeight - 4, panelZ)
      neonSideTop.material = neonMat
      this.neonMeshes.push(neonSideTop)

      const neonSideTopRight = MeshBuilder.CreateBox(
        'cabinetNeonSideTopRight',
        { width: 0.3, height: 0.3, depth: preset.depth },
        this.scene
      )
      neonSideTopRight.position.set(halfW, preset.sideHeight - 4, panelZ)
      neonSideTopRight.material = neonMat
      this.neonMeshes.push(neonSideTopRight)
    }

    // Marquee neon
    if (layout.marquee) {
      const neonMarquee = MeshBuilder.CreateBox(
        'cabinetNeonMarquee',
        { width: preset.width, height: 0.3, depth: 0.3 },
        this.scene
      )
      neonMarquee.position.set(0, preset.sideHeight - 2, preset.backboxZ - 5.5)
      neonMarquee.material = neonMat
      this.neonMeshes.push(neonMarquee)
    }

    // Coin door neon
    if (layout.coinDoor) {
      const neonCoin = MeshBuilder.CreateBox(
        'cabinetNeonCoin',
        { width: 8.4, height: 5.4, depth: 0.2 },
        this.scene
      )
      neonCoin.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 0.6)
      neonCoin.scaling = new Vector3(1, 1, 0.1)
      neonCoin.material = neonMat
      this.neonMeshes.push(neonCoin)
    }

    // Under cabinet glow (neo/vertical)
    if (layout.underCabinet) {
      const neonUnder = MeshBuilder.CreateBox(
        'cabinetNeonUnder',
        { width: preset.width - 4, height: 0.3, depth: preset.depth - 4 },
        this.scene
      )
      neonUnder.position.set(0, preset.baseY, panelZ)
      neonUnder.material = neonMat
      this.neonMeshes.push(neonUnder)
    }

    // Backbox edge (vertical/neo)
    if (layout.backboxEdge) {
      const bbWidth = preset.width + 2
      const bbHeight = preset.backboxHeight

      const neonBackbox = MeshBuilder.CreateBox(
        'cabinetNeonBackbox',
        { width: bbWidth + 0.6, height: bbHeight, depth: 0.3 },
        this.scene
      )
      neonBackbox.position.set(
        0,
        preset.sideHeight + bbHeight / 2 - 1,
        preset.backboxZ + 0.5
      )
      neonBackbox.material = neonMat
      this.neonMeshes.push(neonBackbox)
    }
  }

  private buildInteriorLighting(preset: CabinetPreset): void {
    const points = preset.lightPoints

    // Interior point light
    const interiorGlow = new PointLight('cabinetInteriorGlow', points.interior, this.scene)
    interiorGlow.intensity = 0.6
    interiorGlow.diffuse = color(this.currentNeonColor)
    interiorGlow.range = 25
    this.interiorLights.push(interiorGlow)

    // Marquee spot
    const marqueeSpot = new SpotLight(
      'cabinetMarqueeSpot',
      points.marqueeSpot.pos,
      points.marqueeSpot.target,
      Math.PI / 3,
      2,
      this.scene
    )
    marqueeSpot.intensity = 0.8
    marqueeSpot.diffuse = new Color3(1, 1, 0.95)
    this.interiorLights.push(marqueeSpot)

    // Side accents
    const leftAccent = new PointLight('cabinetLeftAccent', points.leftAccent, this.scene)
    leftAccent.intensity = 0.4
    leftAccent.diffuse = color(this.currentNeonColor)
    leftAccent.range = 12
    this.interiorLights.push(leftAccent)

    const rightAccent = new PointLight('cabinetRightAccent', points.rightAccent, this.scene)
    rightAccent.intensity = 0.4
    rightAccent.diffuse = color(this.currentNeonColor)
    rightAccent.range = 12
    this.interiorLights.push(rightAccent)

    // Under glow (if applicable)
    if (points.underGlow) {
      const underGlow = new PointLight('cabinetUnderGlow', points.underGlow, this.scene)
      underGlow.intensity = 0.5
      underGlow.diffuse = color(this.currentNeonColor)
      underGlow.range = 15
      this.interiorLights.push(underGlow)
    }
  }

  private getBodyMaterial(
    type: CabinetPreset['bodyMaterial'],
    matLib: ReturnType<typeof getMaterialLibrary>
  ): StandardMaterial | PBRMaterial {
    switch (type) {
      case 'wood':
        return matLib.getCabinetWoodMaterial()
      case 'metal':
        return matLib.getCabinetMetalTrimMaterial()
      case 'matte_black':
        return matLib.getMatteBlackMaterial()
      case 'carbon_fiber':
        return matLib.getCarbonFiberMaterial()
      default:
        return matLib.getCabinetWoodMaterial()
    }
  }

  private getTrimMaterial(
    type: CabinetPreset['trimMaterial'],
    matLib: ReturnType<typeof getMaterialLibrary>
  ): StandardMaterial | PBRMaterial {
    switch (type) {
      case 'chrome':
        return matLib.getChromeMaterial()
      case 'black_metal':
        return matLib.getBlackMetalMaterial()
      case 'gold':
        return matLib.getGoldMaterial()
      case 'copper':
        return matLib.getCopperMaterial()
      default:
        return matLib.getCabinetMetalTrimMaterial()
    }
  }

  private getInteriorMaterial(
    type: CabinetPreset['interiorMaterial'],
    matLib: ReturnType<typeof getMaterialLibrary>
  ): StandardMaterial | PBRMaterial {
    switch (type) {
      case 'dark_felt':
        return matLib.getCabinetInteriorMaterial()
      case 'matte_black':
        return matLib.getMatteBlackMaterial()
      case 'gloss_black':
        return matLib.getGlossBlackMaterial()
      default:
        return matLib.getCabinetInteriorMaterial()
    }
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
      if (light.name === 'cabinetMarqueeSpot') continue
      light.diffuse = glowColor
    }

    console.log(`[Cabinet] Theme updated for ${this.currentPreset.name}: ${mapName}`)
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
