/**
 * Game Cabinet Builder — Cabinet geometry, decorative elements, room environment.
 */

import {
  Color3,
  Vector3,
  MeshBuilder,
  Mesh,
  Scene,
  StandardMaterial,
  PBRMaterial,
  PointLight,
  HemisphericLight,
  ShadowGenerator,
  MirrorTexture,
  Animation,
  GlowLayer,
  DynamicTexture,
} from '@babylonjs/core'

import {
  PALETTE,
  QualityTier,
  getMaterialLibrary,
} from '../game-elements'
import type { GameObjects } from '../objects'
import type { EffectsSystem } from '../effects'
import type { TableMapManager } from './game-maps'
import { TABLE_MAPS } from '../shaders/lcd-table'
import { GameConfig } from '../config'

export interface CabinetBuilderHost {
  readonly scene: Scene
  readonly qualityTier: QualityTier
  shadowGenerator: ShadowGenerator | null
  mirrorTexture: MirrorTexture | null
  gameObjects: GameObjects | null
  mapManager: TableMapManager | null
  cabinetNeonLights: PointLight[]
  roomMeshes: Mesh[]
  ambientRoomLight: HemisphericLight | null
  effects: EffectsSystem | null
}

export class GameCabinetBuilder {
  private readonly host: CabinetBuilderHost

  constructor(host: CabinetBuilderHost) {
    this.host = host
  }

  // ============================================================================
  // ENHANCED CABINET
  // ============================================================================

  createEnhancedCabinet(): void {
    const { scene } = this.host
    if (!scene) return
    const matLib = getMaterialLibrary(scene)
    const cabinetY = -2.5

    const cabinetMat = matLib.getCabinetMaterial()
    const sidePanelMat = matLib.getSidePanelMaterial()
    const chromeMat = matLib.getChromeMaterial()
    const accentMat = matLib.getNeonBumperMaterial('#00d9ff')

    // Main cabinet body
    const cab = MeshBuilder.CreateBox('cabinet', { width: 27, height: 4, depth: 38 }, scene)
    cab.position.set(0.75, cabinetY - 0.5, 5)
    cab.material = cabinetMat

    // Cabinet feet
    const createFoot = (x: number, z: number) => {
      const foot = MeshBuilder.CreateBox(`foot_${x}_${z}`, { width: 3, height: 1.5, depth: 3 }, scene)
      foot.position.set(x, cabinetY - 3.2, z)
      foot.material = chromeMat
      return foot
    }
    createFoot(-10, -10)
    createFoot(11, -10)
    createFoot(-10, 18)
    createFoot(11, 18)

    // Outer side panels
    const leftPanel = MeshBuilder.CreateBox('leftPanel', { width: 1.5, height: 5, depth: 40 }, scene)
    leftPanel.position.set(-13, cabinetY + 0.5, 5)
    leftPanel.material = sidePanelMat

    const rightPanel = MeshBuilder.CreateBox('rightPanel', { width: 1.5, height: 5, depth: 40 }, scene)
    rightPanel.position.set(14, cabinetY + 0.5, 5)
    rightPanel.material = sidePanelMat

    // Inner trim strips
    const leftTrim = MeshBuilder.CreateBox('leftTrim', { width: 0.3, height: 4.5, depth: 38 }, scene)
    leftTrim.position.set(-12.1, cabinetY + 0.5, 5)
    leftTrim.material = chromeMat

    const rightTrim = MeshBuilder.CreateBox('rightTrim', { width: 0.3, height: 4.5, depth: 38 }, scene)
    rightTrim.position.set(13.1, cabinetY + 0.5, 5)
    rightTrim.material = chromeMat

    // LED accent strips
    const leftLED = MeshBuilder.CreateBox('leftLED', { width: 0.2, height: 0.1, depth: 36 }, scene)
    leftLED.position.set(-13, cabinetY + 3, 5)
    leftLED.material = accentMat

    const rightLED = MeshBuilder.CreateBox('rightLED', { width: 0.2, height: 0.1, depth: 36 }, scene)
    rightLED.position.set(14, cabinetY + 3, 5)
    rightLED.material = accentMat

    // Side panel emissive inlays
    const createSideInlay = (xPos: number, rotY: number, name: string) => {
      const inlay = MeshBuilder.CreatePlane(name, { width: 38, height: 4.5 }, scene)
      inlay.position.set(xPos, cabinetY + 0.5, 5)
      inlay.rotation.y = rotY

      const inlayMat = new StandardMaterial(`${name}Mat`, scene)
      inlayMat.backFaceCulling = false

      if (this.host.qualityTier === QualityTier.HIGH) {
        const tex = new DynamicTexture(`${name}Tex`, { width: 64, height: 256 }, scene, false)
        const ctx = tex.getContext() as CanvasRenderingContext2D
        const grad = ctx.createLinearGradient(0, 256, 0, 0)
        grad.addColorStop(0, '#1a0044')
        grad.addColorStop(1, '#00aaff')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, 64, 256)
        tex.update()
        inlayMat.emissiveTexture = tex
        inlayMat.emissiveColor = Color3.White()
        inlayMat.alpha = 0.6
        inlayMat.disableLighting = true
      } else {
        inlayMat.emissiveColor = new Color3(0.05, 0.1, 0.3)
        inlayMat.alpha = 0.6
        inlayMat.disableLighting = true
      }

      inlay.material = inlayMat
      return inlay
    }
    createSideInlay(-12.24, Math.PI / 2, 'leftInlay')
    createSideInlay(13.24, -Math.PI / 2, 'rightInlay')

    // Front apron
    const apron = MeshBuilder.CreateBox('apron', { width: 24, height: 2, depth: 3 }, scene)
    apron.position.set(0.75, cabinetY + 0.5, -14)
    apron.material = sidePanelMat

    const apronTrim = MeshBuilder.CreateBox('apronTrim', { width: 23, height: 0.2, depth: 0.3 }, scene)
    apronTrim.position.set(0.75, cabinetY + 1.6, -12.6)
    apronTrim.material = accentMat

    // Front bezel
    const bezelMat = new StandardMaterial('bezelMat', scene)
    bezelMat.diffuseColor = Color3.Black()
    bezelMat.emissiveColor = new Color3(0.6, 0, 0.4) // magenta ambient

    const bezel = MeshBuilder.CreateBox('bezel', { width: 26, height: 0.8, depth: 1.2 }, scene)
    bezel.position.set(0.75, cabinetY + 2.2, -12.8)
    bezel.material = bezelMat

    const glassEdge = MeshBuilder.CreateBox('glassEdge', { width: 25, height: 0.05, depth: 0.8 }, scene)
    glassEdge.position.set(0.75, cabinetY + 2.6, -12.8)
    glassEdge.material = chromeMat

    // Back wall
    const backWall = MeshBuilder.CreateBox('backWall', { width: 27, height: 6, depth: 2 }, scene)
    backWall.position.set(0.75, cabinetY + 1, 22)
    backWall.material = cabinetMat

    // Hinges
    const leftHinge = MeshBuilder.CreateBox('leftHinge', { width: 1, height: 3, depth: 1 }, scene)
    leftHinge.position.set(-11, cabinetY + 2, 21.5)
    leftHinge.material = chromeMat

    const rightHinge = MeshBuilder.CreateBox('rightHinge', { width: 1, height: 3, depth: 1 }, scene)
    rightHinge.position.set(12.5, cabinetY + 2, 21.5)
    rightHinge.material = chromeMat

    // Plunger lane siding
    const plungerWall = MeshBuilder.CreateBox('plungerWall', { width: 2, height: 3, depth: 25 }, scene)
    plungerWall.position.set(12, cabinetY + 0.5, -2)
    plungerWall.material = sidePanelMat

    const plungerTrim = MeshBuilder.CreateBox('plungerTrim', { width: 1.5, height: 0.2, depth: 24 }, scene)
    plungerTrim.position.set(12, cabinetY + 2, -2)
    plungerTrim.material = chromeMat

    // Mirror render list
    if (this.host.mirrorTexture?.renderList) {
      this.host.mirrorTexture.renderList.push(
        cab, leftPanel, rightPanel, leftTrim, rightTrim,
        apron, bezel, glassEdge, backWall, leftHinge, rightHinge,
        plungerWall, plungerTrim, leftLED, rightLED, apronTrim
      )
    }

    // Shadow casters
    if (this.host.shadowGenerator) {
      [cab, leftPanel, rightPanel, leftTrim, rightTrim,
       apron, bezel, backWall, plungerWall].forEach(mesh => {
        this.host.shadowGenerator?.addShadowCaster(mesh)
      })
    }
  }

  // ============================================================================
  // DECORATIVE GEOMETRY
  // ============================================================================

  createBumperNeonRings(): void {
    const { scene, gameObjects, qualityTier } = this.host
    if (!scene || !gameObjects) return

    const bumperVisuals = gameObjects.getBumperVisuals()
    if (!bumperVisuals.length) return

    let glowLayer = scene.getGlowLayerByName('glow')
    if (!glowLayer && qualityTier === QualityTier.HIGH) {
      glowLayer = new GlowLayer('glow', scene)
      glowLayer.intensity = 0.4
    }

    bumperVisuals.forEach((vis, i) => {
      const bbox = vis.mesh.getBoundingInfo().boundingBox
      const radiusXZ = bbox.extendSize.x
      const radiusY = bbox.extendSize.y

      const ring = MeshBuilder.CreateTorus(
        `bumperNeon_${i}`,
        { diameter: radiusXZ * 2 + 0.08, thickness: 0.02, tessellation: 32 },
        scene
      )
      ring.position.set(vis.mesh.position.x, vis.mesh.position.y + radiusY, vis.mesh.position.z)
      ring.rotation.x = Math.PI / 2

      const mat = new StandardMaterial(`bumperNeonMat_${i}`, scene)
      const baseColor = Color3.FromHexString(vis.color || '#00d9ff')
      mat.emissiveColor = baseColor
      mat.disableLighting = true
      mat.backFaceCulling = false
      ring.material = mat

      if (qualityTier === QualityTier.HIGH) {
        const anim = new Animation(
          `bumperNeonPulse_${i}`,
          'material.emissiveColor',
          60,
          Animation.ANIMATIONTYPE_COLOR3,
          Animation.ANIMATIONLOOPMODE_CYCLE
        )
        const keys = [
          { frame: 0, value: baseColor.scale(0.6) },
          { frame: 36, value: baseColor.scale(1.0) },
          { frame: 72, value: baseColor.scale(0.6) },
        ]
        anim.setKeys(keys)
        ring.animations = [anim]
        scene.beginAnimation(ring, 0, 72, true)
        glowLayer?.addIncludedOnlyMesh(ring)
      } else {
        mat.emissiveColor = baseColor.scale(0.7)
      }
    })
  }

  createDecorativeGuidePins(): void {
    const { scene } = this.host
    if (!scene) return

    const pinPositions: [number, number, number][] = [
      [-2, 0.04, -2], [2, 0.04, -2], [-5, 0.04, 0], [5, 0.04, 0],
      [-1, 0.04, 2], [1, 0.04, 2], [-3, 0.04, -5], [3, 0.04, -5],
      [0, 0.04, -4], [-4, 0.04, 3], [4, 0.04, 3], [0, 0.04, 0],
    ]

    const pinMeshes: Mesh[] = []
    for (const [x, y, z] of pinPositions) {
      const pin = MeshBuilder.CreateSphere(`guidePin_${pinMeshes.length}`, { diameter: 0.08, segments: 8 }, scene)
      pin.position.set(x, y, z)
      pinMeshes.push(pin)
    }

    if (pinMeshes.length === 0) return
    const mergedPin = Mesh.MergeMeshes(pinMeshes, true, true, undefined, false, true)
    if (!mergedPin) return
    mergedPin.name = 'guidePinsMerged'

    const mat = new PBRMaterial('guidePinMat', scene)
    mat.albedoColor = Color3.FromHexString('#222222')
    mat.metallic = 1.0
    mat.roughness = 0.15
    mat.environmentIntensity = 1.0

    if (this.host.qualityTier === QualityTier.HIGH) {
      mat.clearCoat.isEnabled = true
      mat.clearCoat.intensity = 1.0
      mat.clearCoat.roughness = 0.05
    }

    mergedPin.material = mat
  }

  // ============================================================================
  // ROOM ENVIRONMENT
  // ============================================================================

  createDarkRoomEnvironment(): void {
    const { scene, roomMeshes } = this.host
    if (!scene) return

    const floor = MeshBuilder.CreateGround('roomFloor', { width: 100, height: 100 }, scene)
    floor.position.y = -8
    const floorMat = new StandardMaterial('floorMat', scene)
    floorMat.diffuseColor = Color3.FromHexString('#0a0a0a')
    floorMat.specularColor = Color3.FromHexString('#111111')
    floorMat.roughness = 0.8
    floor.material = floorMat
    roomMeshes.push(floor)

    const backWall = MeshBuilder.CreatePlane('roomBackWall', { width: 80, height: 40 }, scene)
    backWall.position.set(0, 10, 30)
    backWall.rotation.x = Math.PI
    const wallMat = new StandardMaterial('wallMat', scene)
    wallMat.diffuseColor = Color3.FromHexString('#050505')
    wallMat.roughness = 1.0
    backWall.material = wallMat
    roomMeshes.push(backWall)

    const leftWall = MeshBuilder.CreatePlane('roomLeftWall', { width: 60, height: 30 }, scene)
    leftWall.position.set(-50, 5, 0)
    leftWall.rotation.y = Math.PI / 2
    leftWall.material = wallMat
    roomMeshes.push(leftWall)

    const rightWall = MeshBuilder.CreatePlane('roomRightWall', { width: 60, height: 30 }, scene)
    rightWall.position.set(50, 5, 0)
    rightWall.rotation.y = -Math.PI / 2
    rightWall.material = wallMat
    roomMeshes.push(rightWall)

    this.host.ambientRoomLight = new HemisphericLight('roomAmbient', new Vector3(0, 1, 0), scene)
    this.host.ambientRoomLight.intensity = 0.1
    this.host.ambientRoomLight.diffuse = Color3.FromHexString('#1a1a2e')
    this.host.ambientRoomLight.groundColor = Color3.FromHexString('#050505')

    this.createCabinetNeonLights()
    console.log('[GameCabinetBuilder] Dark room environment created')
  }

  private createCabinetNeonLights(): void {
    const { scene, cabinetNeonLights } = this.host
    if (!scene) return

    const leftNeon = new PointLight('leftNeon', new Vector3(-15, 2, 5), scene)
    leftNeon.intensity = 0.8
    leftNeon.diffuse = Color3.FromHexString(PALETTE.CYAN)
    leftNeon.range = 15
    cabinetNeonLights.push(leftNeon)

    const rightNeon = new PointLight('rightNeon', new Vector3(16, 2, 5), scene)
    rightNeon.intensity = 0.8
    rightNeon.diffuse = Color3.FromHexString(PALETTE.MAGENTA)
    rightNeon.range = 15
    cabinetNeonLights.push(rightNeon)

    const backNeon = new PointLight('backNeon', new Vector3(0, 5, -15), scene)
    backNeon.intensity = 0.5
    backNeon.diffuse = Color3.FromHexString(PALETTE.PURPLE)
    backNeon.range = 20
    cabinetNeonLights.push(backNeon)

    const underNeon = new PointLight('underNeon', new Vector3(0, -4, 5), scene)
    underNeon.intensity = 0.6
    underNeon.diffuse = Color3.FromHexString(PALETTE.CYAN)
    underNeon.range = 12
    cabinetNeonLights.push(underNeon)
  }

  updateCabinetLightingForMap(): void {
    const { mapManager, cabinetNeonLights, effects } = this.host
    const config = TABLE_MAPS[mapManager?.getCurrentMap() || 'neon-helix']
    if (!config || cabinetNeonLights.length === 0) return

    const baseColor = Color3.FromHexString(config.baseColor)
    const accentColor = Color3.FromHexString(config.accentColor)

    if (cabinetNeonLights[0]) cabinetNeonLights[0].diffuse = baseColor
    if (cabinetNeonLights[1]) cabinetNeonLights[1].diffuse = accentColor
    if (cabinetNeonLights[2]) cabinetNeonLights[2].diffuse = Color3.Lerp(baseColor, accentColor, 0.5)
    if (cabinetNeonLights[3]) cabinetNeonLights[3].diffuse = baseColor

    effects?.setCabinetColor(config.baseColor)
  }

  // ============================================================================
  // SHADOW CASTERS
  // ============================================================================

  registerShadowCasters(): void {
    const { shadowGenerator, gameObjects } = this.host
    if (!shadowGenerator || !gameObjects) return

    if (!GameConfig.camera.reducedMotion) {
      shadowGenerator.useContactHardeningShadow = true
      shadowGenerator.contactHardeningLightSizeUVRatio = 0.05
    }
    shadowGenerator.frustumEdgeFalloff = 1.0

    const MAX_SHADOW_CASTERS = 20
    const pinballMeshes = gameObjects.getPinballMeshes()

    const shadowCasters = pinballMeshes
      .filter(mesh => {
        if (mesh.name.includes('holo') || mesh.name.includes('glass')) return false
        if (mesh.name.includes('pin')) {
          mesh.receiveShadows = true
          return false
        }
        return true
      })
      .sort((a, b) => {
        const aPriority = a.name.includes('ball') ? 2 : a.name.includes('flipper') ? 1 : 0
        const bPriority = b.name.includes('ball') ? 2 : b.name.includes('flipper') ? 1 : 0
        return bPriority - aPriority
      })
      .slice(0, MAX_SHADOW_CASTERS)

    for (const mesh of shadowCasters) {
      shadowGenerator.addShadowCaster(mesh, true)
    }

    console.log(`[Performance] Shadow casters limited: ${shadowCasters.length}/${pinballMeshes.length}`)

    const ground = this.host.scene.getMeshByName('ground')
    if (ground) {
      ground.receiveShadows = true
    }
  }
}
