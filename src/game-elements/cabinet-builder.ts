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
  DynamicTexture,
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
  private decorationMeshes: Mesh[] = []
  private interiorLights: (PointLight | SpotLight)[] = []
  private marqueeAccentLights: PointLight[] = []
  private currentNeonColor: string = PALETTE.CYAN
  private currentPreset: CabinetPreset = CABINET_PRESETS.classic

  // Neo-specific decorative elements
  private neoDetailMeshes: Mesh[] = []
  private neoNeonMeshes: Mesh[] = []

  // Classic-specific decorative elements
  private classicDetailMeshes: Mesh[] = []
  private warmLightBars: PointLight[] = []

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

    // Add preset-specific decorative details
    if (type === 'classic') {
      const matLib = getMaterialLibrary(this.scene)
      const bodyMat = this.getBodyMaterial(preset.bodyMaterial, matLib)
      const trimMat = this.getTrimMaterial(preset.trimMaterial, matLib)
      this.buildClassicDetails(preset, bodyMat, trimMat)
    }

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
    // 5b. VERTICAL CABINET DETAILS (if applicable)
    // ========================================================================
    if (preset.type === 'vertical') {
      this.buildVerticalDetails(preset, bodyMat, trimMat, neonMat)
    }

    // ========================================================================
    // 6. INTERIOR WALLS
    // ========================================================================
    this.buildInteriorWalls(preset, interiorMat, pfHalfW, pfHalfD, panelZ)

    // ========================================================================
    // 7. NEON TRIM (based on preset layout)
    // ========================================================================
    this.buildNeonTrim(preset, neonMat, halfW, halfD, panelZ, pfHalfD, sideThick)

    // ========================================================================
    // 8. NEO-SPECIFIC DETAILS (only for neo preset)
    // ========================================================================
    if (preset.type === 'neo') {
      this.buildNeoDetails(preset, bodyMat, trimMat, neonMat, halfW, halfD, panelZ)
    }

    // ========================================================================
    // 9. INTERIOR LIGHTING
    // ========================================================================
    this.buildInteriorLighting(preset)

    console.log(`[Cabinet] Built ${preset.name} cabinet`)
  }

  /**
   * Build Classic cabinet decorative details.
   * Includes: engraved side art plates, brass speaker grilles,
   * decorative coin-door trim, and warm light bars.
   */
  private buildClassicDetails(
    preset: CabinetPreset,
    _bodyMat: StandardMaterial | PBRMaterial,
    _trimMat: StandardMaterial | PBRMaterial
  ): void {
    const matLib = getMaterialLibrary(this.scene)
    const halfW = preset.width / 2
    const halfD = preset.depth / 2
    const panelZ = 5
    const sideThick = 2

    // ====================================================================
    // 1. ENGRAVED SIDE ART PLATES (left/right upper side panels)
    // ====================================================================
    const plateWidth = 1.5
    const plateHeight = 8
    const plateDepth = 0.2
    const plateY = preset.sideHeight - 8

    // Create engraved pattern texture
    const createEngravedTexture = (): DynamicTexture => {
      const size = 256
      const tex = new DynamicTexture('engravedPattern', size, this.scene, true)
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

    // Create plate material with engraved texture
    const createPlateMaterial = (): PBRMaterial => {
      const mat = new PBRMaterial('sidePlateMat', this.scene)
      mat.albedoColor = new Color3(0.1, 0.08, 0.06)
      mat.metallic = 0.6
      mat.roughness = 0.4
      mat.environmentIntensity = 0.5

      // Add engraved texture
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
      this.scene
    )
    leftPlate.position.set(-halfW - sideThick / 2 - plateDepth / 2, plateY, panelZ - 8)
    leftPlate.material = plateMat
    this.classicDetailMeshes.push(leftPlate)

    // Right side plate
    const rightPlate = MeshBuilder.CreateBox(
      'classicSidePlateRight',
      { width: plateDepth, height: plateHeight, depth: plateWidth },
      this.scene
    )
    rightPlate.position.set(halfW + sideThick / 2 + plateDepth / 2, plateY, panelZ - 8)
    rightPlate.material = plateMat
    this.classicDetailMeshes.push(rightPlate)

    // ====================================================================
    // 2. BRASS SPEAKER GRILLES (bottom front, centered)
    // ====================================================================
    const brassMat = matLib.getBrushedMetalMaterial()
    // Tint the brass material gold
    brassMat.albedoColor = new Color3(0.8, 0.6, 0.2)

    // Main speaker housing (torus for circular grille pattern)
    const speakerRadius = 2.5
    const speakerTorus = MeshBuilder.CreateTorus(
      'classicSpeakerGrille',
      { diameter: speakerRadius * 2, thickness: 0.4 },
      this.scene
    )
    speakerTorus.position.set(0, -8, panelZ - halfD + 1)
    speakerTorus.rotation.x = Math.PI / 2
    speakerTorus.material = brassMat
    this.classicDetailMeshes.push(speakerTorus)

    // Inner mesh pattern (cylinder with small diameter for mesh look)
    const speakerMesh = MeshBuilder.CreateCylinder(
      'classicSpeakerMesh',
      { diameter: speakerRadius * 1.6, height: 0.2 },
      this.scene
    )
    speakerMesh.position.set(0, -8, panelZ - halfD + 0.9)
    speakerMesh.rotation.x = Math.PI / 2
    speakerMesh.material = brassMat
    this.classicDetailMeshes.push(speakerMesh)

    // ====================================================================
    // 3. DECORATIVE COIN-DOOR TRIM (chrome frame around coin door)
    // ====================================================================
    if (preset.hasCoinDoor) {
      const chromeMat = matLib.getChromeMaterial()
      const coinDoorW = 8.4
      const coinDoorH = 5.4
      const trimThick = 0.3

      // Top trim
      const topTrim = MeshBuilder.CreateBox(
        'classicCoinTrimTop',
        { width: coinDoorW + trimThick * 2, height: trimThick, depth: 0.4 },
        this.scene
      )
      topTrim.position.set(0, -6 + coinDoorH / 2 + trimThick / 2, panelZ - halfD - 0.5)
      topTrim.material = chromeMat
      this.classicDetailMeshes.push(topTrim)

      // Bottom trim
      const bottomTrim = MeshBuilder.CreateBox(
        'classicCoinTrimBottom',
        { width: coinDoorW + trimThick * 2, height: trimThick, depth: 0.4 },
        this.scene
      )
      bottomTrim.position.set(0, -6 - coinDoorH / 2 - trimThick / 2, panelZ - halfD - 0.5)
      bottomTrim.material = chromeMat
      this.classicDetailMeshes.push(bottomTrim)

      // Left trim
      const leftTrim = MeshBuilder.CreateBox(
        'classicCoinTrimLeft',
        { width: trimThick, height: coinDoorH, depth: 0.4 },
        this.scene
      )
      leftTrim.position.set(-coinDoorW / 2 - trimThick / 2, -6, panelZ - halfD - 0.5)
      leftTrim.material = chromeMat
      this.classicDetailMeshes.push(leftTrim)

      // Right trim
      const rightTrim = MeshBuilder.CreateBox(
        'classicCoinTrimRight',
        { width: trimThick, height: coinDoorH, depth: 0.4 },
        this.scene
      )
      rightTrim.position.set(coinDoorW / 2 + trimThick / 2, -6, panelZ - halfD - 0.5)
      rightTrim.material = chromeMat
      this.classicDetailMeshes.push(rightTrim)
    }

    // ====================================================================
    // 4. EXTRA WARM LIGHT BARS (horizontal warm light strips inside)
    // ====================================================================
    // Left warm light bar
    const leftWarmLight = new PointLight('classicWarmLightLeft', new Vector3(-8, 12, panelZ), this.scene)
    leftWarmLight.intensity = 0.5
    leftWarmLight.diffuse = new Color3(1.0, 0.6, 0.2) // Warm orange
    leftWarmLight.range = 15
    this.warmLightBars.push(leftWarmLight)
    this.interiorLights.push(leftWarmLight)

    // Right warm light bar
    const rightWarmLight = new PointLight('classicWarmLightRight', new Vector3(8, 12, panelZ), this.scene)
    rightWarmLight.intensity = 0.5
    rightWarmLight.diffuse = new Color3(1.0, 0.6, 0.2) // Warm orange
    rightWarmLight.range = 15
    this.warmLightBars.push(rightWarmLight)
    this.interiorLights.push(rightWarmLight)

    console.log('[Cabinet] Added Classic cabinet decorative details')
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

  /**
   * Build vertical cabinet specific details.
   * - Tall vertical light bars on sides
   * - Speaker grilles on side panels
   * - Circuit-board style engravings on backbox
   * - Extended marquee accent lighting
   */
  private buildVerticalDetails(
    preset: CabinetPreset,
    _bodyMat: StandardMaterial | PBRMaterial,
    _trimMat: StandardMaterial | PBRMaterial,
    neonMat: PBRMaterial
  ): void {
    const halfW = preset.width / 2
    const panelZ = 5

    // 1. TALL VERTICAL LIGHT BARS - full height neon strips on both sides
    const lightBarHeight = preset.sideHeight + preset.backboxHeight - 2
    const lightBarWidth = 0.4
    const lightBarDepth = 0.4

    // Left vertical light bar
    const leftLightBar = MeshBuilder.CreateBox(
      'cabinetVLightBarLeft',
      { width: lightBarWidth, height: lightBarHeight, depth: lightBarDepth },
      this.scene
    )
    leftLightBar.position.set(-halfW - 0.5, lightBarHeight / 2 - 2, panelZ)
    leftLightBar.material = neonMat
    this.decorationMeshes.push(leftLightBar)

    // Right vertical light bar
    const rightLightBar = MeshBuilder.CreateBox(
      'cabinetVLightBarRight',
      { width: lightBarWidth, height: lightBarHeight, depth: lightBarDepth },
      this.scene
    )
    rightLightBar.position.set(halfW + 0.5, lightBarHeight / 2 - 2, panelZ)
    rightLightBar.material = neonMat
    this.decorationMeshes.push(rightLightBar)

    // 2. SPEAKER GRILLES - oval meshes on left/right panels at mid-height
    const speakerY = preset.sideHeight / 2
    const speakerMat = new StandardMaterial('speakerGrilleMat', this.scene)
    speakerMat.diffuseColor = new Color3(0.08, 0.08, 0.08)
    speakerMat.specularColor = new Color3(0.15, 0.15, 0.15)
    speakerMat.alpha = 0.95

    // Left speaker grille (oval using scaled cylinder)
    const leftSpeaker = MeshBuilder.CreateCylinder(
      'cabinetSpeakerLeft',
      { diameter: 6, height: 0.2, tessellation: 16 },
      this.scene
    )
    leftSpeaker.position.set(-halfW - 0.8, speakerY, panelZ + 5)
    leftSpeaker.rotation.z = Math.PI / 2
    leftSpeaker.scaling.y = 1.5 // Make it oval
    leftSpeaker.material = speakerMat
    this.decorationMeshes.push(leftSpeaker)

    // Right speaker grille
    const rightSpeaker = MeshBuilder.CreateCylinder(
      'cabinetSpeakerRight',
      { diameter: 6, height: 0.2, tessellation: 16 },
      this.scene
    )
    rightSpeaker.position.set(halfW + 0.8, speakerY, panelZ + 5)
    rightSpeaker.rotation.z = Math.PI / 2
    rightSpeaker.scaling.y = 1.5 // Make it oval
    rightSpeaker.material = speakerMat
    this.decorationMeshes.push(rightSpeaker)

    // Speaker mesh detail - small holes pattern (low-poly representation)
    const speakerDetailMat = new StandardMaterial('speakerDetailMat', this.scene)
    speakerDetailMat.diffuseColor = new Color3(0.04, 0.04, 0.04)

    // Left speaker detail dots (reduced for low-poly)
    for (let i = 0; i < 2; i++) {
      const dot = MeshBuilder.CreateSphere(
        `cabinetSpeakerLeftDetail${i}`,
        { diameter: 0.8 },
        this.scene
      )
      dot.position.set(-halfW - 0.9, speakerY + (i - 0.5) * 2, panelZ + 5)
      dot.material = speakerDetailMat
      this.decorationMeshes.push(dot)
    }

    // Right speaker detail dots (reduced for low-poly)
    for (let i = 0; i < 2; i++) {
      const dot = MeshBuilder.CreateSphere(
        `cabinetSpeakerRightDetail${i}`,
        { diameter: 0.8 },
        this.scene
      )
      dot.position.set(halfW + 0.9, speakerY + (i - 0.5) * 2, panelZ + 5)
      dot.material = speakerDetailMat
      this.decorationMeshes.push(dot)
    }

    // 3. CIRCUIT-BOARD STYLE ENGRAVINGS on backbox front face
    const bbWidth = preset.width + 2
    const bbHeight = preset.backboxHeight
    const bbFrontZ = preset.backboxZ - preset.backboxDepth - 0.5
    const bbY = preset.sideHeight + bbHeight / 2 - 1

    // Create circuit trace material with subtle glow
    const circuitMat = new StandardMaterial('circuitTraceMat', this.scene)
    circuitMat.diffuseColor = new Color3(0.1, 0.15, 0.2)
    circuitMat.emissiveColor = color(this.currentNeonColor).scale(0.15)
    circuitMat.alpha = 0.9

    // Horizontal main trace lines (reduced for low-poly)
    for (let i = 0; i < 3; i++) {
      const traceY = bbY - bbHeight / 2 + 4 + i * (bbHeight - 8) / 2
      const trace = MeshBuilder.CreateBox(
        `cabinetCircuitTraceH${i}`,
        { width: bbWidth - 4, height: 0.15, depth: 0.1 },
        this.scene
      )
      trace.position.set(0, traceY, bbFrontZ)
      trace.material = circuitMat
      this.decorationMeshes.push(trace)
    }

    // Vertical connecting traces (reduced for low-poly)
    const vTracePositions = [-5, 5]
    for (let i = 0; i < vTracePositions.length; i++) {
      const traceX = vTracePositions[i]
      const trace = MeshBuilder.CreateBox(
        `cabinetCircuitTraceV${i}`,
        { width: 0.15, height: bbHeight - 4, depth: 0.1 },
        this.scene
      )
      trace.position.set(traceX, bbY, bbFrontZ)
      trace.material = circuitMat
      this.decorationMeshes.push(trace)

      // Small circuit nodes at intersections
      const node = MeshBuilder.CreateBox(
        `cabinetCircuitNode${i}`,
        { width: 0.8, height: 0.8, depth: 0.15 },
        this.scene
      )
      node.position.set(traceX, bbY, bbFrontZ)
      node.material = circuitMat
      this.decorationMeshes.push(node)
    }

    // Diagonal accent traces (tech aesthetic)
    for (let i = 0; i < 2; i++) {
      const angle = i === 0 ? Math.PI / 6 : -Math.PI / 6
      const trace = MeshBuilder.CreateBox(
        `cabinetCircuitTraceD${i}`,
        { width: 10, height: 0.1, depth: 0.1 },
        this.scene
      )
      trace.position.set(i === 0 ? -6 : 6, bbY + (i === 0 ? 3 : -3), bbFrontZ)
      trace.rotation.z = angle
      trace.material = circuitMat
      this.decorationMeshes.push(trace)
    }

    // 4. EXTENDED MARQUEE LIGHTING - point lights at corners
    const marqueeY = preset.sideHeight + bbHeight - 2
    const marqueeZ = preset.backboxZ - preset.backboxDepth - 2
    const marqueeHalfW = bbWidth / 2

    // Warm white corner accent lights
    const cornerPositions = [
      new Vector3(-marqueeHalfW + 1, marqueeY, marqueeZ),
      new Vector3(marqueeHalfW - 1, marqueeY, marqueeZ),
      new Vector3(-marqueeHalfW + 1, marqueeY - 2, marqueeZ + 1),
      new Vector3(marqueeHalfW - 1, marqueeY - 2, marqueeZ + 1),
    ]

    for (let i = 0; i < cornerPositions.length; i++) {
      const cornerLight = new PointLight(
        `cabinetMarqueeAccent${i}`,
        cornerPositions[i],
        this.scene
      )
      cornerLight.intensity = 0.5
      cornerLight.diffuse = new Color3(1, 0.95, 0.85) // Warm white
      cornerLight.range = 8
      this.marqueeAccentLights.push(cornerLight)
    }

    // Small glowing bulbs at corners
    const bulbMat = new StandardMaterial('marqueeBulbMat', this.scene)
    bulbMat.diffuseColor = new Color3(1, 0.9, 0.7)
    bulbMat.emissiveColor = new Color3(0.8, 0.7, 0.5)

    for (let i = 0; i < cornerPositions.length; i++) {
      const bulb = MeshBuilder.CreateSphere(
        `cabinetMarqueeBulb${i}`,
        { diameter: 0.6 },
        this.scene
      )
      bulb.position = cornerPositions[i]
      bulb.material = bulbMat
      this.decorationMeshes.push(bulb)
    }
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

  /**
   * Build Neo-specific decorative details.
   * Sharp angular engravings, glowing accents, speaker grilles, and light bars.
   * Total mesh budget: < 25 meshes
   */
  private buildNeoDetails(
    preset: CabinetPreset,
    bodyMat: StandardMaterial | PBRMaterial,
    _trimMat: StandardMaterial | PBRMaterial,
    neonMat: PBRMaterial,
    halfW: number,
    halfD: number,
    panelZ: number
  ): void {
    const sideHeight = preset.sideHeight
    const angle = Math.PI / 24 // 7.5 degree inward angle

    // ===================================================================
    // 1. SHARP ANGULAR ENGRAVINGS (gouged cuts on upper sides)
    // ===================================================================
    // Left side - 3 diagonal "gouges" pointing downward
    for (let i = 0; i < 3; i++) {
      const yPos = sideHeight - 6 - i * 3.5
      const zOffset = -8 + i * 4

      const leftGouge = MeshBuilder.CreateBox(
        `neoLeftGouge${i}`,
        { width: 0.8, height: 0.15, depth: 6 },
        this.scene
      )
      leftGouge.position.set(-halfW - 0.2, yPos, panelZ + zOffset)
      leftGouge.rotation.z = angle
      leftGouge.rotation.y = -Math.PI / 12
      leftGouge.rotation.x = -Math.PI / 8
      leftGouge.material = bodyMat
      this.neoDetailMeshes.push(leftGouge)

      // Emissive edge strip for each gouge
      const leftGougeGlow = MeshBuilder.CreateBox(
        `neoLeftGougeGlow${i}`,
        { width: 0.85, height: 0.05, depth: 6 },
        this.scene
      )
      leftGougeGlow.position.set(-halfW - 0.25, yPos + 0.05, panelZ + zOffset)
      leftGougeGlow.rotation.z = angle
      leftGougeGlow.rotation.y = -Math.PI / 12
      leftGougeGlow.rotation.x = -Math.PI / 8
      leftGougeGlow.material = neonMat
      this.neoNeonMeshes.push(leftGougeGlow)

      // Right side - mirrored
      const rightGouge = MeshBuilder.CreateBox(
        `neoRightGouge${i}`,
        { width: 0.8, height: 0.15, depth: 6 },
        this.scene
      )
      rightGouge.position.set(halfW + 0.2, yPos, panelZ + zOffset)
      rightGouge.rotation.z = -angle
      rightGouge.rotation.y = Math.PI / 12
      rightGouge.rotation.x = -Math.PI / 8
      rightGouge.material = bodyMat
      this.neoDetailMeshes.push(rightGouge)

      const rightGougeGlow = MeshBuilder.CreateBox(
        `neoRightGougeGlow${i}`,
        { width: 0.85, height: 0.05, depth: 6 },
        this.scene
      )
      rightGougeGlow.position.set(halfW + 0.25, yPos + 0.05, panelZ + zOffset)
      rightGougeGlow.rotation.z = -angle
      rightGougeGlow.rotation.y = Math.PI / 12
      rightGougeGlow.rotation.x = -Math.PI / 8
      rightGougeGlow.material = neonMat
      this.neoNeonMeshes.push(rightGougeGlow)
    }

    // ===================================================================
    // 2. GLOWING EDGE ACCENTS
    // ===================================================================
    // Front bottom neon strip (extended length)
    const frontBottomStrip = MeshBuilder.CreateBox(
      'neoFrontBottomStrip',
      { width: preset.width, height: 0.4, depth: 0.4 },
      this.scene
    )
    frontBottomStrip.position.set(0, -8, panelZ - halfD - 0.3)
    frontBottomStrip.material = neonMat
    this.neoNeonMeshes.push(frontBottomStrip)

    // Corner accent lights - key corners get glowing boxes
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
        this.scene
      )
      cornerGlow.position = pos
      cornerGlow.material = neonMat
      this.neoNeonMeshes.push(cornerGlow)
    })

    // ===================================================================
    // 3. BLACKED-OUT SPEAKER GRILLES WITH NEON OUTLINES
    // ===================================================================
    const speakerZ = panelZ - halfD - 0.8
    const speakerY = -7
    const speakerX = 8 // symmetrical offset from center

    // Left speaker
    const leftGrille = MeshBuilder.CreateCylinder(
      'neoSpeakerLeft',
      { diameter: 4.5, height: 0.3, tessellation: 16 },
      this.scene
    )
    leftGrille.position.set(-speakerX, speakerY, speakerZ)
    leftGrille.rotation.x = Math.PI / 2
    const grilleMat = new StandardMaterial('neoGrilleMat', this.scene)
    grilleMat.diffuseColor = new Color3(0.02, 0.02, 0.02)
    grilleMat.specularColor = new Color3(0.1, 0.1, 0.1)
    leftGrille.material = grilleMat
    this.neoDetailMeshes.push(leftGrille)

    // Left speaker neon ring
    const leftNeonRing = MeshBuilder.CreateTorus(
      'neoSpeakerLeftRing',
      { diameter: 5, thickness: 0.15, tessellation: 16 },
      this.scene
    )
    leftNeonRing.position.set(-speakerX, speakerY, speakerZ + 0.15)
    leftNeonRing.rotation.x = Math.PI / 2
    leftNeonRing.material = neonMat
    this.neoNeonMeshes.push(leftNeonRing)

    // Right speaker
    const rightGrille = MeshBuilder.CreateCylinder(
      'neoSpeakerRight',
      { diameter: 4.5, height: 0.3, tessellation: 16 },
      this.scene
    )
    rightGrille.position.set(speakerX, speakerY, speakerZ)
    rightGrille.rotation.x = Math.PI / 2
    rightGrille.material = grilleMat
    this.neoDetailMeshes.push(rightGrille)

    // Right speaker neon ring
    const rightNeonRing = MeshBuilder.CreateTorus(
      'neoSpeakerRightRing',
      { diameter: 5, thickness: 0.15, tessellation: 16 },
      this.scene
    )
    rightNeonRing.position.set(speakerX, speakerY, speakerZ + 0.15)
    rightNeonRing.rotation.x = Math.PI / 2
    rightNeonRing.material = neonMat
    this.neoNeonMeshes.push(rightNeonRing)

    // ===================================================================
    // 4. ANGULAR LIGHT BARS (inside cabinet)
    // ===================================================================
    // Diagonal light strips with aggressive angles
    const innerLightZ = panelZ - 5
    const innerLightY = 2

    // Left diagonal bar
    const leftLightBar = MeshBuilder.CreateBox(
      'neoLeftLightBar',
      { width: 0.3, height: 0.3, depth: 12 },
      this.scene
    )
    leftLightBar.position.set(-12, innerLightY, innerLightZ)
    leftLightBar.rotation.x = -Math.PI / 6 // 30 degree angle
    leftLightBar.rotation.y = -Math.PI / 12
    leftLightBar.material = neonMat
    this.neoNeonMeshes.push(leftLightBar)

    // Right diagonal bar
    const rightLightBar = MeshBuilder.CreateBox(
      'neoRightLightBar',
      { width: 0.3, height: 0.3, depth: 12 },
      this.scene
    )
    rightLightBar.position.set(12, innerLightY, innerLightZ)
    rightLightBar.rotation.x = -Math.PI / 6
    rightLightBar.rotation.y = Math.PI / 12
    rightLightBar.material = neonMat
    this.neoNeonMeshes.push(rightLightBar)

    // Horizontal accent bar at back
    const backLightBar = MeshBuilder.CreateBox(
      'neoBackLightBar',
      { width: 20, height: 0.25, depth: 0.25 },
      this.scene
    )
    backLightBar.position.set(0, innerLightY + 2, panelZ + halfD - 2)
    backLightBar.rotation.y = Math.PI / 16
    backLightBar.material = neonMat
    this.neoNeonMeshes.push(backLightBar)

    console.log(`[Cabinet] Neo details built: ${this.neoDetailMeshes.length + this.neoNeonMeshes.length} meshes`)
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

    // Update decoration meshes with neon material
    for (const mesh of this.decorationMeshes) {
      if (mesh.name.includes('LightBar')) {
        mesh.material = newNeonMat
      } else if (mesh.name.includes('Circuit')) {
        // Update circuit trace emissive color to match theme
        const circuitMat = mesh.material as StandardMaterial
        if (circuitMat && circuitMat.emissiveColor) {
          circuitMat.emissiveColor = color(this.currentNeonColor).scale(0.15)
        }
      }
    }

    // Update interior light colors
    const glowColor = color(this.currentNeonColor)

    // Update Neo cabinet neon meshes
    for (const mesh of this.neoNeonMeshes) {
      mesh.material = newNeonMat
    }

    // Update Classic cabinet side plate emissive colors (subtle glow)
    for (const mesh of this.classicDetailMeshes) {
      if (mesh.name.includes('SidePlate')) {
        const plateMat = mesh.material as PBRMaterial
        if (plateMat && plateMat.emissiveColor) {
          // Subtle emissive glow reacting to map color
          plateMat.emissiveColor = glowColor.scale(0.15)
        }
      }
    }

    for (const light of this.interiorLights) {
      if (light.name === 'cabinetMarqueeSpot') continue
      // Skip warm light bars - they stay warm orange
      if (light.name.includes('WarmLight')) continue
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

    for (const mesh of this.decorationMeshes) {
      mesh.dispose(false, true)
    }
    this.decorationMeshes = []

    // Clean up Neo cabinet details
    for (const mesh of this.neoDetailMeshes) {
      mesh.dispose(false, true)
    }
    this.neoDetailMeshes = []

    for (const mesh of this.neoNeonMeshes) {
      mesh.dispose(false, true)
    }
    this.neoNeonMeshes = []

    // Clean up Classic cabinet details
    for (const mesh of this.classicDetailMeshes) {
      mesh.dispose(false, true)
    }
    this.classicDetailMeshes = []

    for (const light of this.interiorLights) {
      light.dispose()
    }
    this.interiorLights = []

    for (const light of this.marqueeAccentLights) {
      light.dispose()
    }
    this.marqueeAccentLights = []

    // Clear warm light bars reference (already disposed via interiorLights)
    this.warmLightBars = []
  }
}
