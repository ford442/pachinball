/**
 * Cabinet Preset System - Three distinct cabinet styles
 *
 * Presets:
 * - CLASSIC: Traditional wooden pinball cab with warm lighting
 * - NEO: Sleek black metal, aggressive angles, extra neon
 * - VERTICAL: Taller/narrower modern cab with bigger backbox
 *
 * All presets maintain reactive neon to LCD map colors.
 */

import {
  Scene,
  MeshBuilder,
  Mesh,
  Vector3,
  StandardMaterial,
  Material,
  Color3,
  PointLight,
  SpotLight,
  TransformNode,
} from '@babylonjs/core'
import { getMaterialLibrary } from './material-library'
import { PALETTE, color } from './visual-language'
import type { TableMapType } from '../shaders/lcd-table'
import { TABLE_MAPS } from '../shaders/lcd-table'

export type CabinetPresetType = 'classic' | 'neo' | 'vertical'

export interface CabinetPresetConfig {
  /** Preset type identifier */
  type: CabinetPresetType
  /** Display name for UI */
  name: string
  /** Main body color */
  bodyColor: string
  /** Accent/trim color */
  accentColor: string
  /** Neon glow color (will be overridden by map color) */
  defaultNeonColor: string
  /** Cabinet width */
  width: number
  /** Cabinet depth */
  depth: number
  /** Side panel height */
  sideHeight: number
  /** Backbox Z position */
  backboxZ: number
  /** Base Y position */
  baseY: number
  /** Leg style: 'classic' | 'modern' | 'sleek' */
  legStyle: 'classic' | 'modern' | 'sleek'
  /** Trim style: 'wood' | 'chrome' | 'matte' */
  trimStyle: 'wood' | 'chrome' | 'matte'
  /** Extra neon strips count */
  extraNeonCount: number
  /** Interior warmth: 0-1 (affects light temperature) */
  interiorWarmth: number
}

export const CABINET_PRESETS: Record<CabinetPresetType, CabinetPresetConfig> = {
  classic: {
    type: 'classic',
    name: 'Classic',
    bodyColor: '#8B4513', // Saddle brown wood
    accentColor: '#DAA520', // Goldenrod trim
    defaultNeonColor: '#ffaa00', // Warm amber
    width: 32,
    depth: 44,
    sideHeight: 20,
    backboxZ: 30,
    baseY: -10,
    legStyle: 'classic',
    trimStyle: 'wood',
    extraNeonCount: 2,
    interiorWarmth: 0.8,
  },
  neo: {
    type: 'neo',
    name: 'Neo',
    bodyColor: '#1a1a1a', // Deep black metal
    accentColor: '#00d9ff', // Cyan neon accent
    defaultNeonColor: '#00d9ff', // Cyan
    width: 30,
    depth: 42,
    sideHeight: 19,
    backboxZ: 28,
    baseY: -9,
    legStyle: 'sleek',
    trimStyle: 'chrome',
    extraNeonCount: 5,
    interiorWarmth: 0.2,
  },
  vertical: {
    type: 'vertical',
    name: 'Vertical',
    bodyColor: '#2d2d3a', // Dark slate
    accentColor: '#ff0055', // Magenta accent
    defaultNeonColor: '#ff0055', // Magenta
    width: 28,
    depth: 40,
    sideHeight: 26, // Taller!
    backboxZ: 35, // Bigger backbox!
    baseY: -11,
    legStyle: 'modern',
    trimStyle: 'matte',
    extraNeonCount: 3,
    interiorWarmth: 0.5,
  },
}

export class CabinetPresetBuilder {
  private scene: Scene
  private cabinetMeshes: Mesh[] = []
  private neonMeshes: Mesh[] = []
  private interiorLights: (PointLight | SpotLight)[] = []
  private currentNeonColor: string = PALETTE.CYAN
  private currentPreset: CabinetPresetType = 'classic'
  private config: CabinetPresetConfig
  private rootNode: TransformNode

  constructor(scene: Scene, preset: CabinetPresetType = 'classic') {
    this.scene = scene
    this.currentPreset = preset
    this.config = CABINET_PRESETS[preset]
    this.rootNode = new TransformNode('cabinetRoot', scene)
  }

  /**
   * Get current preset type
   */
  getCurrentPreset(): CabinetPresetType {
    return this.currentPreset
  }

  /**
   * Get current preset config
   */
  getCurrentConfig(): CabinetPresetConfig {
    return this.config
  }

  /**
   * Build the complete cabinet for current preset
   */
  buildCabinet(): void {
    this.dispose()

    const matLib = getMaterialLibrary(this.scene)

    // Create materials based on preset
    const bodyMat = this.createBodyMaterial(matLib)
    const trimMat = this.createTrimMaterial(matLib)
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
    const panelZ = 5

    // Build based on preset type
    switch (this.config.type) {
      case 'classic':
        this.buildClassicCabinet(bodyMat, trimMat, interiorMat, neonMat, halfW, halfD, pfHalfW, pfHalfD, sideThick, panelZ)
        break
      case 'neo':
        this.buildNeoCabinet(bodyMat, trimMat, interiorMat, neonMat, halfW, halfD, pfHalfW, pfHalfD, sideThick, panelZ)
        break
      case 'vertical':
        this.buildVerticalCabinet(bodyMat, trimMat, interiorMat, neonMat, halfW, halfD, pfHalfW, pfHalfD, sideThick, panelZ)
        break
    }

    console.log(`[Cabinet] Built ${this.config.name} preset`)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private createBodyMaterial(_matLib: ReturnType<typeof getMaterialLibrary>): StandardMaterial {
    const mat = new StandardMaterial(`cabinetBody_${this.config.type}`, this.scene)
    mat.diffuseColor = Color3.FromHexString(this.config.bodyColor)
    
    if (this.config.type === 'classic') {
      // Wood specular for classic
      mat.specularColor = new Color3(0.2, 0.15, 0.1)
      // Would use wood texture here
    } else if (this.config.type === 'neo') {
      // Metallic for neo
      mat.specularColor = new Color3(0.8, 0.8, 0.9)
      mat.roughness = 0.3
    } else {
      // Matte for vertical
      mat.specularColor = new Color3(0.3, 0.3, 0.35)
      mat.roughness = 0.7
    }
    
    return mat
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private createTrimMaterial(_matLib: ReturnType<typeof getMaterialLibrary>): StandardMaterial {
    const mat = new StandardMaterial(`cabinetTrim_${this.config.type}`, this.scene)
    mat.diffuseColor = Color3.FromHexString(this.config.accentColor)
    
    if (this.config.trimStyle === 'chrome') {
      mat.specularColor = new Color3(1, 1, 1)
      mat.roughness = 0.1
    } else if (this.config.trimStyle === 'wood') {
      mat.specularColor = new Color3(0.3, 0.25, 0.15)
    } else {
      mat.specularColor = new Color3(0.4, 0.4, 0.45)
    }
    
    return mat
  }

  /**
   * CLASSIC: Traditional wooden pinball cabinet
   */
  private buildClassicCabinet(
    bodyMat: Material,
    trimMat: Material,
    interiorMat: Material,
    neonMat: Material,
    halfW: number,
    halfD: number,
    pfHalfW: number,
    pfHalfD: number,
    sideThick: number,
    panelZ: number
  ): void {
    // Side panels with beveled edges
    this.createSidePanels(bodyMat, trimMat, halfW, halfD, sideThick, panelZ, true)
    
    // Front panel with coin door
    this.createFrontPanel(bodyMat, trimMat, neonMat, pfHalfW, pfHalfD, sideThick, panelZ)
    
    // Back panel
    this.createBackPanel(bodyMat, halfW, halfD, sideThick, panelZ)
    
    // Classic rounded legs with foot pads
    this.createLegs(trimMat, halfW, halfD, panelZ, 'classic')
    
    // Marquee with wood grain
    this.createMarquee(bodyMat, trimMat, halfW)
    
    // Interior walls
    this.createInteriorWalls(interiorMat, pfHalfW, pfHalfD, panelZ)
    
    // Neon trim (warm amber)
    this.createNeonTrim(neonMat, halfW, halfD, sideThick, panelZ, pfHalfD)
    
    // Interior lighting (warm)
    this.createInteriorLighting(halfW, halfD, panelZ, 0.8)
    
    // Classic details: engraved logo plate
    this.createLogoPlate(trimMat, panelZ, pfHalfD, sideThick)
    
    // NEW: Richer Classic details
    this.createClassicDetails(bodyMat, trimMat, neonMat, halfW, halfD, panelZ, pfHalfD, sideThick)
  }

  /**
   * NEW: Classic-specific sculpted decorations
   * - Engraved side art plates
   * - Brass speaker grilles
   * - Decorative coin-door trim
   * - Extra warm light bars
   */
  private createClassicDetails(
    bodyMat: Material,
    trimMat: Material,
    neonMat: Material,
    halfW: number,
    halfD: number,
    panelZ: number,
    pfHalfD: number,
    sideThick: number
  ): void {
    // Engraved side art plates (simulated with thin boxes slightly offset from side panels)
    const plateWidth = 4
    const plateHeight = 10
    const plateDepth = 0.1
    
    for (const side of [-1, 1]) {
      // Main art plate
      const plate = MeshBuilder.CreateBox(
        `cabinetArtPlate${side > 0 ? 'Right' : 'Left'}`,
        { width: plateWidth, height: plateHeight, depth: plateDepth },
        this.scene
      )
      plate.position.set(
        side * (halfW + sideThick / 2 + 0.1),
        this.config.sideHeight / 2,
        panelZ
      )
      plate.material = trimMat as StandardMaterial
      plate.parent = this.rootNode
      this.cabinetMeshes.push(plate)
      
      // Decorative border frame around plate
      const frameThickness = 0.3
      const frameDepth = 0.15
      
      // Top frame
      const topFrame = MeshBuilder.CreateBox(
        `cabinetPlateFrameTop${side > 0 ? 'Right' : 'Left'}`,
        { width: plateWidth + frameThickness * 2, height: frameThickness, depth: frameDepth },
        this.scene
      )
      topFrame.position.set(
        side * (halfW + sideThick / 2 + 0.12),
        this.config.sideHeight / 2 + plateHeight / 2 + frameThickness / 2,
        panelZ
      )
      topFrame.material = bodyMat as StandardMaterial
      topFrame.parent = this.rootNode
      this.cabinetMeshes.push(topFrame)
      
      // Bottom frame
      const bottomFrame = MeshBuilder.CreateBox(
        `cabinetPlateFrameBottom${side > 0 ? 'Right' : 'Left'}`,
        { width: plateWidth + frameThickness * 2, height: frameThickness, depth: frameDepth },
        this.scene
      )
      bottomFrame.position.set(
        side * (halfW + sideThick / 2 + 0.12),
        this.config.sideHeight / 2 - plateHeight / 2 - frameThickness / 2,
        panelZ
      )
      bottomFrame.material = bodyMat as StandardMaterial
      bottomFrame.parent = this.rootNode
      this.cabinetMeshes.push(bottomFrame)
    }
    
    // Brass speaker grilles on backbox sides
    const grilleSize = 5
    const grilleDepth = 0.3
    
    for (const side of [-1, 1]) {
      const grille = MeshBuilder.CreateBox(
        `cabinetBrassGrille${side > 0 ? 'Right' : 'Left'}`,
        { width: grilleDepth, height: grilleSize, depth: grilleSize },
        this.scene
      )
      grille.position.set(
        side * (halfW + sideThick / 2 + grilleDepth / 2),
        this.config.sideHeight - 4,
        this.config.backboxZ - 2
      )
      grille.material = trimMat as StandardMaterial
      grille.parent = this.rootNode
      this.cabinetMeshes.push(grille)
      
      // Grille mesh pattern (small horizontal slits)
      for (let i = 0; i < 12; i++) {
        const slit = MeshBuilder.CreateBox(
          `cabinetGrilleSlit${side}_${i}`,
          { width: grilleDepth + 0.1, height: 0.15, depth: grilleSize * 0.7 },
          this.scene
        )
        slit.position.set(
          side * (halfW + sideThick / 2 + grilleDepth / 2),
          this.config.sideHeight - 6 + i * 0.7,
          this.config.backboxZ - 2
        )
        slit.material = bodyMat as StandardMaterial
        slit.parent = this.rootNode
        this.cabinetMeshes.push(slit)
      }
    }
    
    // Decorative coin door trim (ornate border around coin door)
    const coinDoorZ = panelZ - pfHalfD - sideThick / 2 - 0.8
    const trimPositions = [
      { x: 0, y: -3.5, w: 10, h: 0.3 },    // Top
      { x: 0, y: -8.5, w: 10, h: 0.3 },    // Bottom
      { x: -4, y: -6, w: 0.3, h: 6 },      // Left
      { x: 4, y: -6, w: 0.3, h: 6 },       // Right
    ]
    
    for (const pos of trimPositions) {
      const trim = MeshBuilder.CreateBox(
        `cabinetCoinTrim${pos.x}_${pos.y}`,
        { width: pos.w, height: pos.h, depth: 0.4 },
        this.scene
      )
      trim.position.set(pos.x, pos.y, coinDoorZ)
      trim.material = trimMat as StandardMaterial
      trim.parent = this.rootNode
      this.cabinetMeshes.push(trim)
    }
    
    // Extra warm light bars under the cabinet (glows with neon color)
    const barLength = this.config.width * 0.6
    const barWidth = 0.4
    
    for (let i = 0; i < 3; i++) {
      const lightBar = MeshBuilder.CreateBox(
        `cabinetWarmLightBar${i}`,
        { width: barLength, height: 0.2, depth: barWidth },
        this.scene
      )
      lightBar.position.set(
        0,
        -4,
        panelZ - halfD / 2 + i * (halfD / 2)
      )
      lightBar.material = neonMat as StandardMaterial
      lightBar.parent = this.rootNode
      this.neonMeshes.push(lightBar)
    }
  }

  /**
   * NEO: Sleek black metal with aggressive angles
   */
  private buildNeoCabinet(
    bodyMat: Material,
    trimMat: Material,
    interiorMat: Material,
    neonMat: Material,
    halfW: number,
    halfD: number,
    pfHalfW: number,
    pfHalfD: number,
    sideThick: number,
    panelZ: number
  ): void {
    // Angled side panels (trapezoid shape)
    this.createAngledSidePanels(bodyMat, trimMat, halfW, halfD, sideThick, panelZ)
    
    // Front panel with aggressive slope
    this.createAngledFrontPanel(bodyMat, trimMat, neonMat, pfHalfW, pfHalfD, sideThick, panelZ)
    
    // Back panel with vent details
    this.createBackPanelWithVents(bodyMat, trimMat, halfW, halfD, sideThick, panelZ)
    
    // Sleek tapered legs
    this.createLegs(trimMat, halfW, halfD, panelZ, 'sleek')
    
    // Sharp angular marquee
    this.createAngularMarquee(bodyMat, trimMat, halfW)
    
    // Interior walls
    this.createInteriorWalls(interiorMat, pfHalfW, pfHalfD, panelZ)
    
    // Extra neon strips (5 total)
    this.createExtraNeonTrim(neonMat, halfW, halfD, sideThick, panelZ, pfHalfD)
    
    // Cool interior lighting
    this.createInteriorLighting(halfW, halfD, panelZ, 0.2)
    
    // Angled light bars
    this.createLightBars(neonMat, halfW, panelZ)
    
    // NEW: Neo-specific aggressive details
    this.createNeoDetails(bodyMat, trimMat, neonMat, halfW, halfD, panelZ, pfHalfD, sideThick)
  }

  /**
   * NEW: Neo-specific sculpted decorations
   * - Sharp angular engravings
   * - Glowing edge accents
   * - Blacked-out speaker grilles with neon outlines
   */
  private createNeoDetails(
    _bodyMat: Material,
    trimMat: Material,
    neonMat: Material,
    halfW: number,
    halfD: number,
    panelZ: number,
    pfHalfD: number,
    sideThick: number
  ): void {
    // Sharp angular engravings on side panels (triangular prisms)
    const engravingCount = 4
    
    for (const side of [-1, 1]) {
      for (let i = 0; i < engravingCount; i++) {
        // Triangular engraving pointing upward (aggressive)
        const triangle = MeshBuilder.CreateCylinder(
          `cabinetNeoEngrave${side}_${i}`,
          { diameterTop: 0, diameterBottom: 3, height: 0.15, tessellation: 3 },
          this.scene
        )
        triangle.position.set(
          side * (halfW + sideThick / 2 + 0.15),
          this.config.sideHeight / 2 - 5 + i * 5,
          panelZ - halfD / 2 + i * (halfD / engravingCount)
        )
        triangle.rotation.x = -Math.PI / 2
        triangle.rotation.z = side * Math.PI / 2
        triangle.material = trimMat as StandardMaterial
        triangle.parent = this.rootNode
        this.cabinetMeshes.push(triangle)
      }
    }
    
    // Glowing edge accents on all cabinet corners
    const edgeLength = this.config.sideHeight * 0.8
    const edgeGlowSize = 0.15
    
    for (const side of [-1, 1]) {
      // Front vertical edges
      const frontEdge = MeshBuilder.CreateBox(
        `cabinetNeoEdgeFront${side > 0 ? 'Right' : 'Left'}`,
        { width: edgeGlowSize, height: edgeLength, depth: edgeGlowSize },
        this.scene
      )
      frontEdge.position.set(
        side * halfW,
        this.config.sideHeight / 2 - 2,
        panelZ - halfD + 1
      )
      frontEdge.material = neonMat as StandardMaterial
      frontEdge.parent = this.rootNode
      this.neonMeshes.push(frontEdge)
      
      // Back vertical edges
      const backEdge = MeshBuilder.CreateBox(
        `cabinetNeoEdgeBack${side > 0 ? 'Right' : 'Left'}`,
        { width: edgeGlowSize, height: edgeLength, depth: edgeGlowSize },
        this.scene
      )
      backEdge.position.set(
        side * halfW,
        this.config.sideHeight / 2 - 2,
        panelZ + halfD - 1
      )
      backEdge.material = neonMat as StandardMaterial
      backEdge.parent = this.rootNode
      this.neonMeshes.push(backEdge)
    }
    
    // Horizontal top edge glow
    const topEdgeFront = MeshBuilder.CreateBox(
      'cabinetNeoTopEdgeFront',
      { width: this.config.width, height: edgeGlowSize, depth: edgeGlowSize },
      this.scene
    )
    topEdgeFront.position.set(0, this.config.sideHeight - 1, panelZ - halfD + 1)
    topEdgeFront.material = neonMat as StandardMaterial
    topEdgeFront.parent = this.rootNode
    this.neonMeshes.push(topEdgeFront)
    
    const topEdgeBack = MeshBuilder.CreateBox(
      'cabinetNeoTopEdgeBack',
      { width: this.config.width, height: edgeGlowSize, depth: edgeGlowSize },
      this.scene
    )
    topEdgeBack.position.set(0, this.config.sideHeight - 1, panelZ + halfD - 1)
    topEdgeBack.material = neonMat as StandardMaterial
    topEdgeBack.parent = this.rootNode
    this.neonMeshes.push(topEdgeBack)
    
    // Blacked-out speaker grilles with neon outlines
    const grilleWidth = 6
    const grilleHeight = 8
    const grilleDepth = 0.4
    
    for (const side of [-1, 1]) {
      // Main black grille backing
      const grille = MeshBuilder.CreateBox(
        `cabinetNeoGrille${side > 0 ? 'Right' : 'Left'}`,
        { width: grilleDepth, height: grilleHeight, depth: grilleWidth },
        this.scene
      )
      grille.position.set(
        side * (halfW + sideThick / 2 + grilleDepth / 2),
        this.config.sideHeight - 5,
        this.config.backboxZ - 2
      )
      // Black material - create a new one
      const blackMat = new StandardMaterial(`neoGrilleBlack${side}`, this.scene)
      blackMat.diffuseColor = new Color3(0.02, 0.02, 0.02)
      blackMat.specularColor = new Color3(0.1, 0.1, 0.1)
      grille.material = blackMat
      grille.parent = this.rootNode
      this.cabinetMeshes.push(grille)
      
      // Neon outline border
      const outlineThickness = 0.2
      const outlineDepth = 0.1
      
      // Top neon border
      const topBorder = MeshBuilder.CreateBox(
        `cabinetNeoGrilleTop${side}`,
        { width: outlineDepth, height: outlineThickness, depth: grilleWidth + outlineThickness * 2 },
        this.scene
      )
      topBorder.position.set(
        side * (halfW + sideThick / 2 + grilleDepth + 0.05),
        this.config.sideHeight - 5 + grilleHeight / 2 + outlineThickness / 2,
        this.config.backboxZ - 2
      )
      topBorder.material = neonMat as StandardMaterial
      topBorder.parent = this.rootNode
      this.neonMeshes.push(topBorder)
      
      // Bottom neon border
      const bottomBorder = MeshBuilder.CreateBox(
        `cabinetNeoGrilleBottom${side}`,
        { width: outlineDepth, height: outlineThickness, depth: grilleWidth + outlineThickness * 2 },
        this.scene
      )
      bottomBorder.position.set(
        side * (halfW + sideThick / 2 + grilleDepth + 0.05),
        this.config.sideHeight - 5 - grilleHeight / 2 - outlineThickness / 2,
        this.config.backboxZ - 2
      )
      bottomBorder.material = neonMat as StandardMaterial
      bottomBorder.parent = this.rootNode
      this.neonMeshes.push(bottomBorder)
      
      // Left neon border
      const leftBorder = MeshBuilder.CreateBox(
        `cabinetNeoGrilleLeft${side}`,
        { width: outlineDepth, height: grilleHeight, depth: outlineThickness },
        this.scene
      )
      leftBorder.position.set(
        side * (halfW + sideThick / 2 + grilleDepth + 0.05),
        this.config.sideHeight - 5,
        this.config.backboxZ - 2 - grilleWidth / 2 - outlineThickness / 2
      )
      leftBorder.material = neonMat as StandardMaterial
      leftBorder.parent = this.rootNode
      this.neonMeshes.push(leftBorder)
      
      // Right neon border
      const rightBorder = MeshBuilder.CreateBox(
        `cabinetNeoGrilleRight${side}`,
        { width: outlineDepth, height: grilleHeight, depth: outlineThickness },
        this.scene
      )
      rightBorder.position.set(
        side * (halfW + sideThick / 2 + grilleDepth + 0.05),
        this.config.sideHeight - 5,
        this.config.backboxZ - 2 + grilleWidth / 2 + outlineThickness / 2
      )
      rightBorder.material = neonMat as StandardMaterial
      rightBorder.parent = this.rootNode
      this.neonMeshes.push(rightBorder)
    }
    
    // Aggressive front vent accents with neon glow
    const ventCount = 5
    for (let i = 0; i < ventCount; i++) {
      const ventGlow = MeshBuilder.CreateBox(
        `cabinetNeoVentGlow${i}`,
        { width: 2, height: 0.15, depth: 0.3 },
        this.scene
      )
      ventGlow.position.set(
        -4 + i * 2,
        -5,
        panelZ - pfHalfD - sideThick / 2 - 0.5
      )
      ventGlow.material = neonMat as StandardMaterial
      ventGlow.parent = this.rootNode
      this.neonMeshes.push(ventGlow)
    }
  }

  /**
   * VERTICAL: Taller modern cabinet with bigger backbox
   */
  private buildVerticalCabinet(
    bodyMat: Material,
    trimMat: Material,
    interiorMat: Material,
    neonMat: Material,
    halfW: number,
    halfD: number,
    pfHalfW: number,
    pfHalfD: number,
    sideThick: number,
    panelZ: number
  ): void {
    // Tall side panels
    this.createSidePanels(bodyMat, trimMat, halfW, halfD, sideThick, panelZ, false)
    
    // Front panel
    this.createFrontPanel(bodyMat, trimMat, neonMat, pfHalfW, pfHalfD, sideThick, panelZ)
    
    // Back panel
    this.createBackPanel(bodyMat, halfW, halfD, sideThick, panelZ)
    
    // Modern straight legs
    this.createLegs(trimMat, halfW, halfD, panelZ, 'modern')
    
    // Extended marquee for taller backbox
    this.createExtendedMarquee(bodyMat, trimMat, halfW)
    
    // Interior walls
    this.createInteriorWalls(interiorMat, pfHalfW, pfHalfD, panelZ)
    
    // Neon trim
    this.createNeonTrim(neonMat, halfW, halfD, sideThick, panelZ, pfHalfD)
    
    // Balanced interior lighting
    this.createInteriorLighting(halfW, halfD, panelZ, 0.5)
    
    // Extra: Speaker grilles
    this.createSpeakerGrilles(trimMat, halfW, panelZ)
    
    // NEW: Vertical-specific sculpted decorations
    this.createVerticalDetails(bodyMat, trimMat, neonMat, halfW, halfD, panelZ, pfHalfD, sideThick)
  }

  /**
   * NEW: Vertical-specific sculpted decorations
   * - Tall vertical light bars
   * - Speaker grilles on the sides
   * - Circuit-board style engravings on backbox
   */
  private createVerticalDetails(
    bodyMat: Material,
    trimMat: Material,
    neonMat: Material,
    halfW: number,
    halfD: number,
    panelZ: number,
    _pfHalfD: number,
    sideThick: number
  ): void {
    // Tall vertical light bars on each side (signature Vertical feature)
    const barHeight = this.config.sideHeight * 0.7
    const barWidth = 0.6
    const barDepth = 0.3
    
    for (const side of [-1, 1]) {
      // Main light bar
      const lightBar = MeshBuilder.CreateBox(
        `cabinetVerticalLightBar${side > 0 ? 'Right' : 'Left'}`,
        { width: barWidth, height: barHeight, depth: barDepth },
        this.scene
      )
      lightBar.position.set(
        side * (halfW + sideThick / 2 + barDepth / 2 + 0.1),
        this.config.sideHeight / 2 - 2,
        panelZ - halfD / 3
      )
      lightBar.material = neonMat as StandardMaterial
      lightBar.parent = this.rootNode
      this.neonMeshes.push(lightBar)
      
      // Segmented dividers for light bar
      for (let i = 0; i < 8; i++) {
        const segment = MeshBuilder.CreateBox(
          `cabinetVerticalSegment${side}_${i}`,
          { width: barWidth + 0.1, height: barHeight / 10, depth: barDepth + 0.05 },
          this.scene
        )
        segment.position.set(
          side * (halfW + sideThick / 2 + barDepth / 2 + 0.1),
          this.config.sideHeight / 2 - 2 - barHeight / 2 + i * (barHeight / 7.5) + 1,
          panelZ - halfD / 3
        )
        segment.material = trimMat as StandardMaterial
        segment.parent = this.rootNode
        this.cabinetMeshes.push(segment)
      }
    }
    
    // Side-mounted speaker grilles (tall and narrow)
    const sideGrilleHeight = 12
    const sideGrilleWidth = 3
    const grilleDepth = 0.3
    
    for (const side of [-1, 1]) {
      // Main grille backing
      const grille = MeshBuilder.CreateBox(
        `cabinetVerticalSideGrille${side > 0 ? 'Right' : 'Left'}`,
        { width: grilleDepth, height: sideGrilleHeight, depth: sideGrilleWidth },
        this.scene
      )
      grille.position.set(
        side * (halfW + sideThick / 2 + grilleDepth / 2),
        this.config.sideHeight / 2,
        panelZ + halfD / 3
      )
      grille.material = bodyMat as StandardMaterial
      grille.parent = this.rootNode
      this.cabinetMeshes.push(grille)
      
      // Vertical grille lines
      for (let i = 0; i < 15; i++) {
        const line = MeshBuilder.CreateBox(
          `cabinetVerticalGrilleLine${side}_${i}`,
          { width: grilleDepth + 0.05, height: sideGrilleHeight * 0.8, depth: 0.08 },
          this.scene
        )
        line.position.set(
          side * (halfW + sideThick / 2 + grilleDepth / 2),
          this.config.sideHeight / 2,
          panelZ + halfD / 3 - sideGrilleWidth / 2 + 0.4 + i * 0.4
        )
        line.material = trimMat as StandardMaterial
        line.parent = this.rootNode
        this.cabinetMeshes.push(line)
      }
    }
    
    // Circuit-board style engravings on backbox
    const cbWidth = 20
    const lineThickness = 0.15
    const lineDepth = 0.1
    
    // Circuit pattern lines
    const circuitLines = [
      // Horizontal trunk lines
      { x: 0, y: 2, w: cbWidth, h: lineThickness },
      { x: 0, y: -2, w: cbWidth, h: lineThickness },
      { x: 0, y: 0, w: cbWidth * 0.6, h: lineThickness },
      // Vertical branch lines
      { x: -6, y: 0, w: lineThickness, h: 6 },
      { x: 6, y: 0, w: lineThickness, h: 6 },
      { x: -3, y: 1, w: lineThickness, h: 4 },
      { x: 3, y: -1, w: lineThickness, h: 4 },
    ]
    
    for (let i = 0; i < circuitLines.length; i++) {
      const line = circuitLines[i]
      const trace = MeshBuilder.CreateBox(
        `cabinetCircuitTrace${i}`,
        { width: line.w, height: line.h, depth: lineDepth },
        this.scene
      )
      trace.position.set(
        line.x,
        this.config.sideHeight - 3 + line.y,
        panelZ + halfD + sideThick / 2 + 0.1
      )
      trace.material = trimMat as StandardMaterial
      trace.parent = this.rootNode
      this.cabinetMeshes.push(trace)
    }
    
    // Circuit nodes (glowing dots at intersections)
    const nodePositions = [
      { x: -6, y: 2 },
      { x: -6, y: -2 },
      { x: 6, y: 2 },
      { x: 6, y: -2 },
      { x: -3, y: 0 },
      { x: 3, y: 0 },
      { x: 0, y: 2 },
      { x: 0, y: -2 },
    ]
    
    for (let i = 0; i < nodePositions.length; i++) {
      const node = MeshBuilder.CreateSphere(
        `cabinetCircuitNode${i}`,
        { diameter: 0.4 },
        this.scene
      )
      node.position.set(
        nodePositions[i].x,
        this.config.sideHeight - 3 + nodePositions[i].y,
        panelZ + halfD + sideThick / 2 + 0.15
      )
      node.material = neonMat as StandardMaterial
      node.parent = this.rootNode
      this.neonMeshes.push(node)
    }
    
    // Extended backbox accent strips
    for (const side of [-1, 1]) {
      const accent = MeshBuilder.CreateBox(
        `cabinetVerticalAccent${side > 0 ? 'Right' : 'Left'}`,
        { width: 1, height: this.config.sideHeight - 4, depth: 0.3 },
        this.scene
      )
      accent.position.set(
        side * (halfW - 2),
        this.config.sideHeight / 2 - 2,
        panelZ + halfD + sideThick / 2 + 0.2
      )
      accent.material = trimMat as StandardMaterial
      accent.parent = this.rootNode
      this.cabinetMeshes.push(accent)
    }
  }

  // ====================================================================
  // COMPONENT BUILDERS
  // ====================================================================

  private createSidePanels(
    bodyMat: Material,
    trimMat: Material,
    halfW: number,
    _halfD: number,
    sideThick: number,
    panelZ: number,
    beveled: boolean
  ): void {
    // Left side
    const leftSide = MeshBuilder.CreateBox(
      'cabinetLeftSide',
      { width: sideThick, height: this.config.sideHeight, depth: this.config.depth },
      this.scene
    )
    leftSide.position.set(-halfW - sideThick / 2, this.config.sideHeight / 2 - 2, panelZ)
    leftSide.material = bodyMat as StandardMaterial
    leftSide.parent = this.rootNode
    this.cabinetMeshes.push(leftSide)

    // Right side
    const rightSide = MeshBuilder.CreateBox(
      'cabinetRightSide',
      { width: sideThick, height: this.config.sideHeight, depth: this.config.depth },
      this.scene
    )
    rightSide.position.set(halfW + sideThick / 2, this.config.sideHeight / 2 - 2, panelZ)
    rightSide.material = bodyMat as StandardMaterial
    rightSide.parent = this.rootNode
    this.cabinetMeshes.push(rightSide)

    // Trim rails
    const railHeight = this.config.sideHeight - 2
    const railThick = 0.4
    
    const leftRail = MeshBuilder.CreateBox(
      'cabinetLeftRail',
      { width: railThick, height: railHeight, depth: this.config.depth + 1 },
      this.scene
    )
    leftRail.position.set(-halfW + railThick / 2, this.config.sideHeight / 2 - 2, panelZ)
    leftRail.material = trimMat as StandardMaterial
    leftRail.parent = this.rootNode
    this.cabinetMeshes.push(leftRail)

    const rightRail = MeshBuilder.CreateBox(
      'cabinetRightRail',
      { width: railThick, height: railHeight, depth: this.config.depth + 1 },
      this.scene
    )
    rightRail.position.set(halfW - railThick / 2, this.config.sideHeight / 2 - 2, panelZ)
    rightRail.material = trimMat as StandardMaterial
    rightRail.parent = this.rootNode
    this.cabinetMeshes.push(rightRail)

    // Beveled edges if classic
    if (beveled) {
      const bevelSize = 0.3
      const leftBevel = MeshBuilder.CreateBox(
        'cabinetLeftBevel',
        { width: bevelSize, height: railHeight, depth: this.config.depth + 0.5 },
        this.scene
      )
      leftBevel.position.set(-halfW - sideThick + bevelSize / 2, this.config.sideHeight / 2 - 2, panelZ)
      leftBevel.material = trimMat as StandardMaterial
      leftBevel.parent = this.rootNode
      this.cabinetMeshes.push(leftBevel)

      const rightBevel = MeshBuilder.CreateBox(
        'cabinetRightBevel',
        { width: bevelSize, height: railHeight, depth: this.config.depth + 0.5 },
        this.scene
      )
      rightBevel.position.set(halfW + sideThick - bevelSize / 2, this.config.sideHeight / 2 - 2, panelZ)
      rightBevel.material = trimMat as StandardMaterial
      rightBevel.parent = this.rootNode
      this.cabinetMeshes.push(rightBevel)
    }
  }

  private createAngledSidePanels(
    bodyMat: Material,
    trimMat: Material,
    halfW: number,
    _halfD: number,
    sideThick: number,
    panelZ: number
  ): void {
    // For NEO: angled/trapezoid side panels
    // Create using custom mesh or rotated boxes
    
    const sideHeight = this.config.sideHeight
    // Note: topWidth = this.config.width * 0.85 would make it narrower at top

    // Left side (angled inward)
    const leftSide = MeshBuilder.CreateBox(
      'cabinetLeftSide',
      { width: sideThick, height: sideHeight, depth: this.config.depth },
      this.scene
    )
    leftSide.position.set(-halfW - sideThick / 2, sideHeight / 2 - 2, panelZ)
    // Rotate to angle inward
    leftSide.rotation.z = -0.08
    leftSide.material = bodyMat as StandardMaterial
    leftSide.parent = this.rootNode
    this.cabinetMeshes.push(leftSide)

    // Right side (angled inward)
    const rightSide = MeshBuilder.CreateBox(
      'cabinetRightSide',
      { width: sideThick, height: sideHeight, depth: this.config.depth },
      this.scene
    )
    rightSide.position.set(halfW + sideThick / 2, sideHeight / 2 - 2, panelZ)
    rightSide.rotation.z = 0.08
    rightSide.material = bodyMat as StandardMaterial
    rightSide.parent = this.rootNode
    this.cabinetMeshes.push(rightSide)

    // Chrome trim on edges
    const railThick = 0.5
    const leftRail = MeshBuilder.CreateBox(
      'cabinetLeftRail',
      { width: railThick, height: sideHeight, depth: this.config.depth + 1 },
      this.scene
    )
    leftRail.position.set(-halfW + 0.5, sideHeight / 2 - 2, panelZ)
    leftRail.rotation.z = -0.08
    leftRail.material = trimMat as StandardMaterial
    leftRail.parent = this.rootNode
    this.cabinetMeshes.push(leftRail)

    const rightRail = MeshBuilder.CreateBox(
      'cabinetRightRail',
      { width: railThick, height: sideHeight, depth: this.config.depth + 1 },
      this.scene
    )
    rightRail.position.set(halfW - 0.5, sideHeight / 2 - 2, panelZ)
    rightRail.rotation.z = 0.08
    rightRail.material = trimMat as StandardMaterial
    rightRail.parent = this.rootNode
    this.cabinetMeshes.push(rightRail)
  }

  private createFrontPanel(
    bodyMat: Material,
    trimMat: Material,
    _neonMat: Material,
    pfHalfW: number,
    pfHalfD: number,
    sideThick: number,
    panelZ: number
  ): void {
    const playfieldW = pfHalfW * 2
    
    // Front panel
    const frontPanel = MeshBuilder.CreateBox(
      'cabinetFrontPanel',
      { width: playfieldW + 2, height: 8, depth: sideThick },
      this.scene
    )
    frontPanel.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 1)
    frontPanel.material = bodyMat as StandardMaterial
    frontPanel.parent = this.rootNode
    this.cabinetMeshes.push(frontPanel)

    // Coin door
    const coinDoor = MeshBuilder.CreateBox('cabinetCoinDoor', { width: 8, height: 5, depth: 0.3 }, this.scene)
    coinDoor.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 0.8)
    const coinMat = new StandardMaterial('coinDoorMat', this.scene)
    coinMat.diffuseColor = new Color3(0.05, 0.05, 0.05)
    coinMat.specularColor = new Color3(0.3, 0.3, 0.3)
    coinDoor.material = coinMat as StandardMaterial
    coinDoor.parent = this.rootNode
    this.cabinetMeshes.push(coinDoor)

    // Coin slot
    const coinSlot = MeshBuilder.CreateBox('cabinetCoinSlot', { width: 0.8, height: 2, depth: 0.4 }, this.scene)
    coinSlot.position.set(-2, -6, panelZ - pfHalfD - sideThick / 2 - 0.7)
    coinSlot.material = trimMat as StandardMaterial
    coinSlot.parent = this.rootNode
    this.cabinetMeshes.push(coinSlot)
  }

  private createAngledFrontPanel(
    bodyMat: Material,
    _trimMat: Material,
    neonMat: Material,
    pfHalfW: number,
    pfHalfD: number,
    sideThick: number,
    panelZ: number
  ): void {
    const playfieldW = pfHalfW * 2
    
    // For NEO: angled front panel
    const frontPanel = MeshBuilder.CreateBox(
      'cabinetFrontPanel',
      { width: playfieldW + 2, height: 9, depth: sideThick },
      this.scene
    )
    frontPanel.position.set(0, -6.5, panelZ - pfHalfD - sideThick / 2 - 0.5)
    frontPanel.rotation.x = 0.15 // Angled back
    frontPanel.material = bodyMat as StandardMaterial
    frontPanel.parent = this.rootNode
    this.cabinetMeshes.push(frontPanel)

    // Coin door with neon border
    const coinDoor = MeshBuilder.CreateBox('cabinetCoinDoor', { width: 8, height: 5, depth: 0.3 }, this.scene)
    coinDoor.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 0.3)
    coinDoor.rotation.x = 0.15
    const coinMat = new StandardMaterial('coinDoorMat', this.scene)
    coinMat.diffuseColor = new Color3(0.02, 0.02, 0.02)
    coinDoor.material = coinMat as StandardMaterial
    coinDoor.parent = this.rootNode
    this.cabinetMeshes.push(coinDoor)

    // Neon coin door ring
    const coinNeon = MeshBuilder.CreateBox('cabinetCoinNeon', { width: 8.5, height: 5.5, depth: 0.1 }, this.scene)
    coinNeon.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 0.2)
    coinNeon.rotation.x = 0.15
    coinNeon.material = neonMat as StandardMaterial
    coinNeon.parent = this.rootNode
    this.neonMeshes.push(coinNeon)
  }

  private createBackPanel(
    bodyMat: Material,
    _halfW: number,
    halfD: number,
    sideThick: number,
    panelZ: number
  ): void {
    const playfieldW = 28
    
    const backPanel = MeshBuilder.CreateBox(
      'cabinetBackPanel',
      { width: playfieldW + 2, height: this.config.sideHeight, depth: sideThick },
      this.scene
    )
    backPanel.position.set(0, this.config.sideHeight / 2 - 2, panelZ + halfD + sideThick / 2 + 1)
    backPanel.material = bodyMat as StandardMaterial
    backPanel.parent = this.rootNode
    this.cabinetMeshes.push(backPanel)
  }

  private createBackPanelWithVents(
    bodyMat: Material,
    trimMat: Material,
    _halfW: number,
    halfD: number,
    sideThick: number,
    panelZ: number
  ): void {
    const playfieldW = 28
    
    // Main back panel
    const backPanel = MeshBuilder.CreateBox(
      'cabinetBackPanel',
      { width: playfieldW + 2, height: this.config.sideHeight, depth: sideThick },
      this.scene
    )
    backPanel.position.set(0, this.config.sideHeight / 2 - 2, panelZ + halfD + sideThick / 2 + 1)
    backPanel.material = bodyMat as StandardMaterial
    backPanel.parent = this.rootNode
    this.cabinetMeshes.push(backPanel)

    // Vent details (horizontal slats)
    for (let i = 0; i < 5; i++) {
      const vent = MeshBuilder.CreateBox(
        `cabinetVent${i}`,
        { width: playfieldW * 0.6, height: 0.3, depth: 0.2 },
        this.scene
      )
      vent.position.set(0, this.config.sideHeight / 2 - 4 - i * 2, panelZ + halfD + sideThick / 2 + 1.3)
      vent.material = trimMat as StandardMaterial
      vent.parent = this.rootNode
      this.cabinetMeshes.push(vent)
    }
  }

  private createLegs(
    trimMat: Material,
    halfW: number,
    halfD: number,
    panelZ: number,
    style: 'classic' | 'modern' | 'sleek'
  ): void {
    const legPositions = [
      new Vector3(-halfW + 1.5, this.config.baseY - 3, panelZ - halfD + 3),
      new Vector3(halfW - 1.5, this.config.baseY - 3, panelZ - halfD + 3),
      new Vector3(-halfW + 1.5, this.config.baseY - 3, panelZ + halfD - 3),
      new Vector3(halfW - 1.5, this.config.baseY - 3, panelZ + halfD - 3),
    ]

    for (let i = 0; i < legPositions.length; i++) {
      let leg: Mesh
      
      if (style === 'classic') {
        // Classic: cylindrical with foot pad
        leg = MeshBuilder.CreateCylinder(`cabinetLeg${i}`, { diameter: 1.8, height: 6 }, this.scene)
        
        // Foot pad
        const foot = MeshBuilder.CreateCylinder(`cabinetFoot${i}`, { diameter: 2.4, height: 0.5 }, this.scene)
        foot.position = legPositions[i].clone()
        foot.position.y -= 3
        foot.material = trimMat as StandardMaterial
        foot.parent = this.rootNode
        this.cabinetMeshes.push(foot)
      } else if (style === 'modern') {
        // Modern: straight box legs
        leg = MeshBuilder.CreateBox(`cabinetLeg${i}`, { width: 1.5, height: 6, depth: 1.5 }, this.scene)
      } else {
        // Sleek: tapered cylinders
        leg = MeshBuilder.CreateCylinder(`cabinetLeg${i}`, { 
          diameterTop: 1.2, 
          diameterBottom: 1.8, 
          height: 6 
        }, this.scene)
      }
      
      leg.position = legPositions[i]
      leg.material = trimMat as StandardMaterial
      leg.parent = this.rootNode
      this.cabinetMeshes.push(leg)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private createMarquee(bodyMat: Material, trimMat: Material, _halfW: number): void {
    const marquee = MeshBuilder.CreateBox(
      'cabinetMarquee',
      { width: this.config.width + 2, height: 2, depth: 8 },
      this.scene
    )
    marquee.position.set(0, this.config.sideHeight - 1, this.config.backboxZ - 2)
    marquee.material = bodyMat as StandardMaterial
    marquee.parent = this.rootNode
    this.cabinetMeshes.push(marquee)

    // Marquee lip
    const marqueeLip = MeshBuilder.CreateBox(
      'cabinetMarqueeLip', 
      { width: this.config.width + 2, height: 0.5, depth: 0.5 }, 
      this.scene
    )
    marqueeLip.position.set(0, this.config.sideHeight - 2.25, this.config.backboxZ - 5.75)
    marqueeLip.material = trimMat as StandardMaterial
    marqueeLip.parent = this.rootNode
    this.cabinetMeshes.push(marqueeLip)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private createAngularMarquee(bodyMat: Material, trimMat: Material, _halfW: number): void {
    // NEO: sharp angular marquee
    const marquee = MeshBuilder.CreateBox(
      'cabinetMarquee',
      { width: this.config.width + 2, height: 1.5, depth: 9 },
      this.scene
    )
    marquee.position.set(0, this.config.sideHeight - 0.75, this.config.backboxZ - 2)
    marquee.material = bodyMat as StandardMaterial
    marquee.parent = this.rootNode
    this.cabinetMeshes.push(marquee)

    // Sharp lip
    const marqueeLip = MeshBuilder.CreateBox(
      'cabinetMarqueeLip', 
      { width: this.config.width + 2.5, height: 0.3, depth: 0.8 }, 
      this.scene
    )
    marqueeLip.position.set(0, this.config.sideHeight - 1.5, this.config.backboxZ - 6)
    marqueeLip.material = trimMat as StandardMaterial
    marqueeLip.parent = this.rootNode
    this.cabinetMeshes.push(marqueeLip)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private createExtendedMarquee(bodyMat: Material, trimMat: Material, _halfW: number): void {
    // VERTICAL: taller extended marquee
    const marquee = MeshBuilder.CreateBox(
      'cabinetMarquee',
      { width: this.config.width + 2, height: 3, depth: 10 },
      this.scene
    )
    marquee.position.set(0, this.config.sideHeight - 1.5, this.config.backboxZ - 2)
    marquee.material = bodyMat as StandardMaterial
    marquee.parent = this.rootNode
    this.cabinetMeshes.push(marquee)

    // Double lip for extended look
    const marqueeLip = MeshBuilder.CreateBox(
      'cabinetMarqueeLip', 
      { width: this.config.width + 2, height: 0.6, depth: 0.8 }, 
      this.scene
    )
    marqueeLip.position.set(0, this.config.sideHeight - 2.7, this.config.backboxZ - 6.5)
    marqueeLip.material = trimMat as StandardMaterial
    marqueeLip.parent = this.rootNode
    this.cabinetMeshes.push(marqueeLip)
  }

  private createInteriorWalls(
    interiorMat: Material,
    pfHalfW: number,
    pfHalfD: number,
    panelZ: number
  ): void {
    const leftInner = MeshBuilder.CreateBox(
      'cabinetLeftInner',
      { width: 0.5, height: this.config.sideHeight - 4, depth: pfHalfD * 2 },
      this.scene
    )
    leftInner.position.set(-pfHalfW - 0.25, this.config.sideHeight / 2 - 4, panelZ)
    leftInner.material = interiorMat as StandardMaterial
    leftInner.parent = this.rootNode
    this.cabinetMeshes.push(leftInner)

    const rightInner = MeshBuilder.CreateBox(
      'cabinetRightInner',
      { width: 0.5, height: this.config.sideHeight - 4, depth: pfHalfD * 2 },
      this.scene
    )
    rightInner.position.set(pfHalfW + 0.25, this.config.sideHeight / 2 - 4, panelZ)
    rightInner.material = interiorMat as StandardMaterial
    rightInner.parent = this.rootNode
    this.cabinetMeshes.push(rightInner)
  }

  private createNeonTrim(
    neonMat: Material,
    halfW: number,
    halfD: number,
    sideThick: number,
    panelZ: number,
    pfHalfD: number
  ): void {
    // Vertical neon strips
    const neonLeft = MeshBuilder.CreateBox(
      'cabinetNeonLeft', 
      { width: 0.3, height: this.config.sideHeight - 4, depth: 0.3 }, 
      this.scene
    )
    neonLeft.position.set(-halfW, this.config.sideHeight / 2 - 2, panelZ - halfD + 0.5)
    neonLeft.material = neonMat as StandardMaterial
    neonLeft.parent = this.rootNode
    this.neonMeshes.push(neonLeft)

    const neonRight = MeshBuilder.CreateBox(
      'cabinetNeonRight', 
      { width: 0.3, height: this.config.sideHeight - 4, depth: 0.3 }, 
      this.scene
    )
    neonRight.position.set(halfW, this.config.sideHeight / 2 - 2, panelZ - halfD + 0.5)
    neonRight.material = neonMat as StandardMaterial
    neonRight.parent = this.rootNode
    this.neonMeshes.push(neonRight)

    // Horizontal neon under marquee
    const neonMarquee = MeshBuilder.CreateBox(
      'cabinetNeonMarquee', 
      { width: this.config.width, height: 0.3, depth: 0.3 }, 
      this.scene
    )
    neonMarquee.position.set(0, this.config.sideHeight - 2, this.config.backboxZ - 5.5)
    neonMarquee.material = neonMat as StandardMaterial
    neonMarquee.parent = this.rootNode
    this.neonMeshes.push(neonMarquee)

    // Coin door neon
    const neonCoin = MeshBuilder.CreateBox(
      'cabinetNeonCoin', 
      { width: 8.4, height: 5.4, depth: 0.2 }, 
      this.scene
    )
    neonCoin.position.set(0, -6, panelZ - pfHalfD - sideThick / 2 - 0.6)
    neonCoin.scaling = new Vector3(1, 1, 0.1)
    neonCoin.material = neonMat as StandardMaterial
    neonCoin.parent = this.rootNode
    this.neonMeshes.push(neonCoin)
  }

  private createExtraNeonTrim(
    neonMat: Material,
    halfW: number,
    halfD: number,
    sideThick: number,
    panelZ: number,
    pfHalfD: number
  ): void {
    // Standard neon
    this.createNeonTrim(neonMat, halfW, halfD, sideThick, panelZ, pfHalfD)

    // Extra neon strips for NEO
    // Top edge neon
    const topNeon = MeshBuilder.CreateBox(
      'cabinetTopNeon', 
      { width: this.config.width + 1, height: 0.2, depth: 0.2 }, 
      this.scene
    )
    topNeon.position.set(0, this.config.sideHeight - 0.5, panelZ)
    topNeon.material = neonMat as StandardMaterial
    topNeon.parent = this.rootNode
    this.neonMeshes.push(topNeon)

    // Side edge neon (full length)
    const leftEdgeNeon = MeshBuilder.CreateBox(
      'cabinetLeftEdgeNeon', 
      { width: 0.2, height: 0.2, depth: this.config.depth }, 
      this.scene
    )
    leftEdgeNeon.position.set(-halfW - 0.3, this.config.sideHeight / 2, panelZ)
    leftEdgeNeon.material = neonMat as StandardMaterial
    leftEdgeNeon.parent = this.rootNode
    this.neonMeshes.push(leftEdgeNeon)

    const rightEdgeNeon = MeshBuilder.CreateBox(
      'cabinetRightEdgeNeon', 
      { width: 0.2, height: 0.2, depth: this.config.depth }, 
      this.scene
    )
    rightEdgeNeon.position.set(halfW + 0.3, this.config.sideHeight / 2, panelZ)
    rightEdgeNeon.material = neonMat as StandardMaterial
    rightEdgeNeon.parent = this.rootNode
    this.neonMeshes.push(rightEdgeNeon)

    // Floor neon glow
    const floorNeon = MeshBuilder.CreateBox(
      'cabinetFloorNeon', 
      { width: this.config.width - 4, height: 0.1, depth: this.config.depth - 4 }, 
      this.scene
    )
    floorNeon.position.set(0, this.config.baseY + 0.5, panelZ)
    floorNeon.material = neonMat as StandardMaterial
    floorNeon.parent = this.rootNode
    this.neonMeshes.push(floorNeon)
  }

  private createInteriorLighting(
    halfW: number,
    halfD: number,
    panelZ: number,
    warmth: number
  ): void {
    // Interior point light
    const interiorGlow = new PointLight('cabinetInteriorGlow', new Vector3(0, 2, panelZ), this.scene)
    interiorGlow.intensity = 0.6
    
    // Warmth affects color temperature
    if (warmth > 0.5) {
      interiorGlow.diffuse = new Color3(1, 0.9, 0.7).scale(warmth).add(color(this.currentNeonColor).scale(1 - warmth))
    } else {
      interiorGlow.diffuse = color(this.currentNeonColor)
    }
    
    interiorGlow.range = 25
    this.interiorLights.push(interiorGlow)

    // Spot light from marquee
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

    // Side accent lights
    const leftAccent = new PointLight(
      'cabinetLeftAccent', 
      new Vector3(-halfW + 1, 6, panelZ - halfD + 2), 
      this.scene
    )
    leftAccent.intensity = 0.4
    leftAccent.diffuse = warmth > 0.5 
      ? new Color3(1, 0.8, 0.6) 
      : color(this.currentNeonColor)
    leftAccent.range = 12
    this.interiorLights.push(leftAccent)

    const rightAccent = new PointLight(
      'cabinetRightAccent', 
      new Vector3(halfW - 1, 6, panelZ - halfD + 2), 
      this.scene
    )
    rightAccent.intensity = 0.4
    rightAccent.diffuse = warmth > 0.5 
      ? new Color3(1, 0.8, 0.6) 
      : color(this.currentNeonColor)
    rightAccent.range = 12
    this.interiorLights.push(rightAccent)
  }

  private createLogoPlate(trimMat: Material, panelZ: number, pfHalfD: number, sideThick: number): void {
    // Classic: engraved logo plate on front
    const plate = MeshBuilder.CreateBox(
      'cabinetLogoPlate',
      { width: 6, height: 2, depth: 0.2 },
      this.scene
    )
    plate.position.set(0, -2, panelZ - pfHalfD - sideThick / 2 - 1.2)
    plate.material = trimMat as StandardMaterial
    plate.parent = this.rootNode
    this.cabinetMeshes.push(plate)
  }

  private createLightBars(neonMat: Material, halfW: number, panelZ: number): void {
    // NEO: angled light bars on sides
    const barLeft = MeshBuilder.CreateBox(
      'cabinetLightBarLeft',
      { width: 0.4, height: 0.4, depth: 8 },
      this.scene
    )
    barLeft.position.set(-halfW - 0.5, this.config.sideHeight / 2, panelZ - 5)
    barLeft.rotation.z = 0.3
    barLeft.material = neonMat as StandardMaterial
    barLeft.parent = this.rootNode
    this.neonMeshes.push(barLeft)

    const barRight = MeshBuilder.CreateBox(
      'cabinetLightBarRight',
      { width: 0.4, height: 0.4, depth: 8 },
      this.scene
    )
    barRight.position.set(halfW + 0.5, this.config.sideHeight / 2, panelZ - 5)
    barRight.rotation.z = -0.3
    barRight.material = neonMat as StandardMaterial
    barRight.parent = this.rootNode
    this.neonMeshes.push(barRight)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private createSpeakerGrilles(trimMat: Material, halfW: number, _panelZ: number): void {
    // VERTICAL: speaker grilles on marquee
    for (const side of [-1, 1]) {
      const grille = MeshBuilder.CreateBox(
        `cabinetSpeaker${side > 0 ? 'Right' : 'Left'}`,
        { width: 4, height: 5, depth: 0.3 },
        this.scene
      )
      grille.position.set(side * (halfW - 4), this.config.sideHeight - 2, this.config.backboxZ - 6)
      grille.material = trimMat as StandardMaterial
      grille.parent = this.rootNode
      this.cabinetMeshes.push(grille)

      // Grille pattern (horizontal lines)
      for (let i = 0; i < 8; i++) {
        const line = MeshBuilder.CreateBox(
          `cabinetGrilleLine${side}_${i}`,
          { width: 3.5, height: 0.1, depth: 0.05 },
          this.scene
        )
        line.position.set(
          side * (halfW - 4), 
          this.config.sideHeight - 4 + i * 0.6, 
          this.config.backboxZ - 5.85
        )
        line.material = trimMat as StandardMaterial
        line.parent = this.rootNode
        this.cabinetMeshes.push(line)
      }
    }
  }


  // ====================================================================
  // PUBLIC API
  // ====================================================================

  /**
   * Switch to a different cabinet preset (instant)
   */
  switchPreset(preset: CabinetPresetType): void {
    if (this.currentPreset === preset) return
    
    this.currentPreset = preset
    this.config = CABINET_PRESETS[preset]
    this.buildCabinet()
    
    console.log(`[Cabinet] Switched to ${this.config.name} preset`)
  }

  /**
   * Cycle to next preset
   */
  cyclePreset(): CabinetPresetType {
    const presets: CabinetPresetType[] = ['classic', 'neo', 'vertical']
    const currentIndex = presets.indexOf(this.currentPreset)
    const nextIndex = (currentIndex + 1) % presets.length
    const nextPreset = presets[nextIndex]
    
    this.switchPreset(nextPreset)
    return nextPreset
  }

  /**
   * Update neon color based on LCD map
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

    // Update interior lights (except marquee spot)
    const glowColor = color(this.currentNeonColor)
    for (const light of this.interiorLights) {
      if (light.name === 'cabinetMarqueeSpot') continue
      
      // Blend with warmth setting
      if (this.config.interiorWarmth > 0.5) {
        const warmColor = new Color3(1, 0.9, 0.7)
        light.diffuse = warmColor.scale(this.config.interiorWarmth)
          .add(glowColor.scale(1 - this.config.interiorWarmth))
      } else {
        light.diffuse = glowColor
      }
    }

    console.log(`[Cabinet] Theme updated for ${this.config.name} to match: ${mapName}`)
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
  }
}
