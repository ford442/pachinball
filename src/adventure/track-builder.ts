/**
 * Track Builder Base Class
 * 
 * Provides the foundation for building adventure mode tracks with physics and visuals.
 */

import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Scene } from '@babylonjs/core/scene'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import type {
  AdventureCallback,
  GravityWell,
  DampingZone,
  KinematicBinding,
  AnimatedObstacle,
  ConveyorZone,
  ChromaGate,
} from './adventure-types'
import {
  GROUP_UNIVERSAL,
  MASK_RED,
  MASK_GREEN,
  MASK_BLUE,
} from './adventure-types'
import type { TrackInfo } from './adventure-track-progression'
import { INTENSITY, emissive, PALETTE } from '../game-elements/visual-language'
import {
  getTrackThemeProfile,
  type TrackMaterialRole,
} from './track-theme-profiles'
import { COLLISION_GROUP_PRESETS } from '../game-elements/physics'
import {
  boxDesc,
  cylinderDesc,
  sphereDesc,
  type AdventureColliderDesc,
  type DescQuat,
} from './track-collider-descriptors'
import { TrackColliderEmitter } from './track-collider-emitter'
import type { TrackDefinition } from './track-schema'
import {
  compileTrackDefinition,
  type TrackBuildApi,
  type TrackCursor,
} from './track-compiler'

const RAPIER_DEFAULT_COLLISION_GROUPS = 0xFFFFFFFF

/** Quaternion for a Babylon YXZ Euler triple, as a plain descriptor quat. */
function eulerQuat(x: number, y: number, z: number): DescQuat {
  const q = Quaternion.FromEulerAngles(x, y, z)
  return { x: q.x, y: q.y, z: q.z, w: q.w }
}

export abstract class TrackBuilder {
  protected scene: Scene
  protected world: RAPIER.World
  protected rapier: typeof RAPIER

  // State Management
  protected adventureTrack: Mesh[] = []
  protected materials: (StandardMaterial | PBRMaterial)[] = []
  protected adventureBodies: RAPIER.RigidBody[] = []
  protected kinematicBindings: KinematicBinding[] = []
  protected animatedObstacles: AnimatedObstacle[] = []
  protected conveyorZones: ConveyorZone[] = []
  protected gravityWells: GravityWell[] = []
  protected dampingZones: DampingZone[] = []
  protected chromaGates: ChromaGate[] = []
  protected adventureSensor: RAPIER.RigidBody | null = null
  protected resetSensors: RAPIER.RigidBody[] = []
  protected adventureActive = false
  protected currentStartPos: Vector3 = Vector3.Zero()
  protected timeAccumulator = 0
  protected currentBallMesh: Mesh | null = null

  /**
   * Records every collider this track emits and realises it on Rapier.
   * The recorded list is the single source the C++ adventure exporter walks
   * (see src/game/physics/wasm-adventure-export.ts).
   */
  protected colliders: TrackColliderEmitter

  /** Baseline world gravity captured before a data-track multiplier is applied. */
  private storedGravity: { x: number; y: number; z: number } | null = null

  /** Campaign catalog info for the currently active track; null for free-roam. */
  protected currentTrackInfo: TrackInfo | null = null

  /**
   * Builder-defined exit portal position, stored by addExitPortal().
   * AdventureMode.activateExitPortal() will use this when set, falling back
   * to a generic formula when null.
   */
  protected portalPosition: Vector3 | null = null

  // Communication
  protected onEvent: AdventureCallback | null = null

  constructor(scene: Scene, world: RAPIER.World, rapier: typeof RAPIER) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.colliders = new TrackColliderEmitter(world, rapier)
  }

  /** Collider descriptors emitted by the currently-built track. */
  getColliderDescriptors(): readonly AdventureColliderDesc[] {
    return this.colliders.list()
  }

  /**
   * Registers a callback listener to handle story events in the main Game class.
   */
  setEventListener(callback: AdventureCallback): void {
    this.onEvent = callback
  }

  protected applyDefaultAdventureCollisionGroups(): void {
    const bodies = new Set<RAPIER.RigidBody>()

    for (const body of this.adventureBodies) {
      bodies.add(body)
    }
    if (this.adventureSensor) {
      bodies.add(this.adventureSensor)
    }
    for (const body of this.resetSensors) {
      bodies.add(body)
    }
    for (const zone of this.conveyorZones) {
      bodies.add(zone.sensor)
    }
    for (const well of this.gravityWells) {
      bodies.add(well.sensor)
    }
    for (const zone of this.dampingZones) {
      bodies.add(zone.sensor)
    }
    for (const gate of this.chromaGates) {
      bodies.add(gate.sensor)
    }

    for (const body of bodies) {
      const colliderCount = body.numColliders()
      for (let i = 0; i < colliderCount; i++) {
        const collider = body.collider(i)
        const groups = collider.collisionGroups()
        if (groups === RAPIER_DEFAULT_COLLISION_GROUPS || groups === -1) {
          collider.setCollisionGroups(COLLISION_GROUP_PRESETS.ADVENTURE)
        }
      }
    }
  }

  /**
   * Get sensor body for goal detection
   */
  getSensor(): RAPIER.RigidBody | null {
    return this.adventureSensor
  }

  /**
   * Get reset sensors for penalty zones
   */
  getResetSensors(): RAPIER.RigidBody[] {
    return this.resetSensors
  }

  /**
   * Check if adventure mode is currently active
   */
  isActive(): boolean {
    return this.adventureActive
  }

  /**
   * Get the current start position
   */
  getStartPos(): Vector3 {
    return this.currentStartPos
  }

  // --- Shared Helper for Materials ---
  protected getTrackMaterial(colorHex: string): StandardMaterial {
    const mat = new StandardMaterial("trackMat", this.scene)
    mat.emissiveColor = Color3.FromHexString(colorHex)
    mat.diffuseColor = Color3.Black()
    mat.alpha = 0.6
    mat.wireframe = true
    this.materials.push(mat)
    return mat
  }

  /**
   * Get a PBR track material with emissive glow and clear coat.
   * Use this for tracks that should look more physically realistic.
   */
  protected getTrackPBRMaterial(colorHex: string): PBRMaterial {
    const mat = new PBRMaterial("trackPBRMat", this.scene)
    mat.albedoColor = Color3.Black()
    mat.emissiveColor = Color3.FromHexString(colorHex)
    mat.emissiveIntensity = 1.2
    mat.metallic = 0.8
    mat.roughness = 0.2
    mat.alpha = 0.85
    mat.wireframe = true
    mat.clearCoat.isEnabled = true
    mat.clearCoat.intensity = 0.4
    mat.clearCoat.roughness = 0.2
    this.materials.push(mat)
    return mat
  }

  /**
   * Resolve adventure track geometry material from the active track's premium profile.
   */
  protected getThemedTrackMaterial(role: TrackMaterialRole): StandardMaterial | PBRMaterial {
    const trackId = this.currentTrackInfo?.id ?? ''
    const profile = getTrackThemeProfile(trackId)
    const hex = profile?.materials[role] ?? PALETTE.CYAN
    const usePbr = profile?.usePBRStructure && (role === 'structure' || role === 'glow')
    const mat = usePbr ? this.getTrackPBRMaterial(hex) : this.getTrackMaterial(hex)
    mat.metadata = { ...(mat.metadata ?? {}), trackMaterialRole: role, trackId }
    return mat
  }

  /** Materials created for the active adventure track (for live theme retinting). */
  getTrackMaterials(): (StandardMaterial | PBRMaterial)[] {
    return this.materials
  }

  /**
   * Build track geometry from a validated declarative definition (#296).
   */
  buildFromDefinition(def: TrackDefinition): TrackCursor {
    const multiplier = def.gravityMultiplier ?? 1
    if (multiplier !== 1) {
      this.applyGravityMultiplier(multiplier)
    }

    const api: TrackBuildApi = {
      currentStartPos: this.currentStartPos,
      getTrackMaterial: (hex) => this.getTrackMaterial(hex),
      getThemedTrackMaterial: (role) => this.getThemedTrackMaterial(role),
      addStraightRamp: (
        startPos,
        heading,
        width,
        length,
        inclineRad,
        material,
        wallHeight,
        friction,
      ) =>
        this.addStraightRamp(
          startPos,
          heading,
          width,
          length,
          inclineRad,
          material,
          wallHeight,
          friction,
        ),
      addCurvedRamp: (
        startPos,
        startHeading,
        radius,
        totalAngle,
        inclineRad,
        width,
        wallHeight,
        material,
        segments,
        bankingAngle,
        friction,
      ) =>
        this.addCurvedRamp(
          startPos,
          startHeading,
          radius,
          totalAngle,
          inclineRad,
          width,
          wallHeight,
          material,
          segments,
          bankingAngle,
          friction,
        ),
      createBasin: (pos, material) => this.createBasin(pos, material),
      addExitPortal: (position) => this.addExitPortal(position),
      createRotatingPlatform: (center, radius, angVelY, material, hasTeeth) =>
        this.createRotatingPlatform(center, radius, angVelY, material, hasTeeth),
      createChromaGate: (pos, color) => this.createChromaGate(pos, color),
      createStaticCylinder: (pos, diameter, height, material) =>
        this.createStaticCylinder(pos, diameter, height, material),
      createPinField: (
        rampStart,
        heading,
        inclineRad,
        rampLength,
        pinSpacing,
        evenOffsets,
        oddOffsets,
        pinDiameter,
        pinHeight,
        material,
      ) =>
        this.createPinField(
          rampStart,
          heading,
          inclineRad,
          rampLength,
          pinSpacing,
          evenOffsets,
          oddOffsets,
          pinDiameter,
          pinHeight,
          material,
        ),
      createInclinedMill: (center, radius, inclineRad, angVelAlongNormal, material) =>
        this.createInclinedMill(center, radius, inclineRad, angVelAlongNormal, material),
      createResetBasin: (pos, material) => this.createResetBasin(pos, material),
    }

    return compileTrackDefinition(def, api)
  }

  protected applyGravityMultiplier(multiplier: number): void {
    if (!this.world) return
    if (!this.storedGravity) {
      const g = this.world.gravity
      this.storedGravity = { x: g.x, y: g.y, z: g.z }
    }
    const base = this.storedGravity
    this.world.gravity = {
      x: base.x * multiplier,
      y: base.y * multiplier,
      z: base.z * multiplier,
    }
  }

  /** Restore world gravity after a data-track multiplier (called from clearTrack). */
  protected restoreTrackGravity(): void {
    if (!this.world || !this.storedGravity) return
    this.world.gravity = {
      x: this.storedGravity.x,
      y: this.storedGravity.y,
      z: this.storedGravity.z,
    }
    this.storedGravity = null
  }

  // --- Primitive Builders ---

  /**
   * Creates a straight ramp segment.
   * @param startPos Start position (top center of the start edge)
   * @param heading Y Rotation (direction)
   * @param width Width of the ramp
   * @param length Length of the mesh (Hypotenuse)
   * @param inclineRad Angle of slope in radians (Positive = Downward slope)
   * @param material Material
   * @param wallHeight Height of walls (0 for no walls)
   * @param friction Surface friction
   * @returns End position of the segment
   */
  protected addStraightRamp(
    startPos: Vector3,
    heading: number,
    width: number,
    length: number,
    inclineRad: number,
    material: StandardMaterial | PBRMaterial,
    wallHeight: number = 0,
    friction: number = 0.5
  ): Vector3 {
    if (!this.world) return startPos

    const box = MeshBuilder.CreateBox("straightRamp", { width, height: 0.5, depth: length }, this.scene)

    // Calculate Horizontal and Vertical components
    const hLen = length * Math.cos(inclineRad)
    const vDrop = length * Math.sin(inclineRad)

    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))

    // Center of the box
    const center = startPos.add(forward.scale(hLen / 2))
    center.y -= vDrop / 2

    box.position.copyFrom(center)
    box.rotation.y = heading
    box.rotation.x = inclineRad

    box.material = material
    this.adventureTrack.push(box)

    // Physics
    const { body } = this.colliders.emit(
      boxDesc(
        { x: center.x, y: center.y, z: center.z },
        { x: width / 2, y: 0.25, z: length / 2 },
        { rotation: eulerQuat(box.rotation.x, box.rotation.y, 0), friction, label: 'straightRamp' }
      )
    )
    this.adventureBodies.push(body)

    if (wallHeight > 0) {
      this.createWall(center, heading, length, width, wallHeight, inclineRad, material, friction)
    }

    // Return End Position
    const endPos = startPos.add(forward.scale(hLen))
    endPos.y -= vDrop
    return endPos
  }

  /**
   * Creates a curved ramp segment.
   */
  protected addCurvedRamp(
    startPos: Vector3,
    startHeading: number,
    radius: number,
    totalAngle: number,
    inclineRad: number,
    width: number,
    wallHeight: number,
    material: StandardMaterial | PBRMaterial,
    segments: number = 48,
    bankingAngle: number = 0,
    friction: number = 0.5
  ): Vector3 {
    if (!this.world) return startPos

    const segmentAngle = totalAngle / segments
    const arcLength = radius * Math.abs(segmentAngle)
    const chordLen = 2 * radius * Math.sin(Math.abs(segmentAngle) / 2)
    const segmentDrop = arcLength * Math.sin(inclineRad)

    let currentHeading = startHeading
    let currentP = startPos.clone()

    for (let i = 0; i < Math.abs(segments); i++) {
      currentHeading += (segmentAngle / 2)

      const forward = new Vector3(Math.sin(currentHeading), 0, Math.cos(currentHeading))
      const center = currentP.add(forward.scale(chordLen / 2))
      center.y -= segmentDrop / 2

      const box = MeshBuilder.CreateBox("curveSeg", { width, height: 0.5, depth: chordLen }, this.scene)
      box.position.copyFrom(center)

      box.rotation.x = inclineRad
      box.rotation.y = currentHeading
      box.rotation.z = bankingAngle

      box.material = material
      this.adventureTrack.push(box)

      const { body } = this.colliders.emit(
        boxDesc(
          { x: center.x, y: center.y, z: center.z },
          { x: width / 2, y: 0.25, z: chordLen / 2 },
          {
            rotation: eulerQuat(box.rotation.x, box.rotation.y, box.rotation.z),
            friction,
            label: 'curveSeg',
          }
        )
      )
      this.adventureBodies.push(body)

      if (wallHeight > 0) {
        this.createWall(center, currentHeading, chordLen, width, wallHeight, inclineRad, material, friction)
      }

      currentP = currentP.add(forward.scale(chordLen))
      currentP.y -= segmentDrop

      currentHeading += (segmentAngle / 2)
    }

    return currentP
  }

  /**
   * Creates walls alongside a track segment.
   */
  protected createWall(
    center: Vector3,
    heading: number,
    length: number,
    trackWidth: number,
    height: number,
    inclineRad: number,
    mat: StandardMaterial | PBRMaterial,
    friction: number = 0.5
  ) {
    if (!this.world) return

    const offsets = [trackWidth / 2 + 0.25, -trackWidth / 2 - 0.25]

    offsets.forEach(offset => {
      const wall = MeshBuilder.CreateBox("wall", { width: 0.5, height: height, depth: length }, this.scene)

      const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
      const wallPos = center.add(right.scale(offset))
      wallPos.y += height / 2

      wall.position.copyFrom(wallPos)
      wall.rotation.y = heading
      wall.rotation.x = inclineRad
      wall.material = mat
      this.adventureTrack.push(wall)

      const { body } = this.colliders.emit(
        boxDesc(
          { x: wallPos.x, y: wallPos.y, z: wallPos.z },
          { x: 0.25, y: height / 2, z: length / 2 },
          { rotation: eulerQuat(wall.rotation.x, wall.rotation.y, 0), friction, label: 'wall' }
        )
      )
      this.adventureBodies.push(body)
    })
  }

  /**
   * Creates a rotating platform.
   */
  protected createRotatingPlatform(
    center: Vector3,
    radius: number,
    angVelY: number,
    material: StandardMaterial | PBRMaterial,
    hasTeeth: boolean = false
  ): void {
    if (!this.world) return

    const thickness = 0.5
    const cylinder = MeshBuilder.CreateCylinder("gear", { diameter: radius * 2, height: thickness, tessellation: 32 }, this.scene)
    cylinder.position.copyFrom(center)
    cylinder.material = material
    this.adventureTrack.push(cylinder)

    const platter = this.colliders.emit(
      cylinderDesc(
        { x: center.x, y: center.y, z: center.z },
        thickness / 2,
        radius,
        {
          friction: 1.0,
          motion: 'kinematic-velocity',
          angularVelocity: { x: 0, y: angVelY, z: 0 },
          label: 'rotatingPlatform',
        }
      )
    )
    const body = platter.body
    this.adventureBodies.push(body)

    this.kinematicBindings.push({ body, mesh: cylinder })

    if (hasTeeth) {
      const toothCount = 12
      const angleStep = (2 * Math.PI) / toothCount

      for (let i = 0; i < toothCount; i++) {
        if (i % 2 !== 0) continue

        const angle = i * angleStep
        const tx = Math.sin(angle) * (radius - 0.25)
        const tz = Math.cos(angle) * (radius - 0.25)

        this.colliders.attach(
          platter,
          boxDesc(
            { x: tx, y: 0.5 + 0.25, z: tz },
            { x: 0.5, y: 0.5, z: 1.0 },
            {
              rotation: { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) },
              label: 'rotatingPlatformTooth',
            }
          )
        )

        const tooth = MeshBuilder.CreateBox("tooth", { width: 1, height: 1, depth: 2 }, this.scene)
        tooth.parent = cylinder
        tooth.position.set(tx, 0.5 + 0.25, tz)
        tooth.rotation.y = angle
        tooth.material = material
      }
    }
  }

  /**
   * Creates a goal basin at the specified position.
   */
  protected createBasin(pos: Vector3, material: StandardMaterial | PBRMaterial): void {
    if (!this.world) return

    const basin = MeshBuilder.CreateBox("basin", { width: 8, height: 1, depth: 8 }, this.scene)
    basin.position.set(pos.x, pos.y - 1, pos.z)
    basin.material = material
    this.adventureTrack.push(basin)

    const { body: bBody } = this.colliders.emit(
      boxDesc({ x: pos.x, y: pos.y - 1, z: pos.z }, { x: 4, y: 0.5, z: 4 }, { label: 'basin' })
    )
    this.adventureBodies.push(bBody)

    // Exit Sensor
    const sensorY = pos.y - 0.5
    const { body: sensor } = this.colliders.emit(
      boxDesc({ x: pos.x, y: sensorY, z: pos.z }, { x: 2, y: 1, z: 1 }, {
        sensor: true,
        collisionEvents: true,
        label: 'basinGoalSensor',
      })
    )
    this.adventureSensor = sensor
  }

  /**
   * Creates a static cylinder obstacle.
   */
  protected createStaticCylinder(
    pos: Vector3,
    diameter: number,
    height: number,
    material: StandardMaterial | PBRMaterial,
  ): void {
    if (!this.world) return

    const mesh = MeshBuilder.CreateCylinder("staticPillar", { diameter, height }, this.scene)
    mesh.position.copyFrom(pos)
    mesh.position.y += height / 2
    mesh.material = material
    this.adventureTrack.push(mesh)

    const { body } = this.colliders.emit(
      cylinderDesc(
        { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
        height / 2,
        diameter / 2,
        { label: 'staticPillar' }
      )
    )
    this.adventureBodies.push(body)
  }

  /**
   * Lattice of static pins on the most recent straight ramp surface.
   */
  protected createPinField(
    rampStart: Vector3,
    heading: number,
    inclineRad: number,
    rampLength: number,
    pinSpacing: number,
    evenOffsets: readonly number[],
    oddOffsets: readonly number[],
    pinDiameter: number,
    pinHeight: number,
    material: StandardMaterial | PBRMaterial,
  ): void {
    if (!this.world) return

    const horiz = new Vector3(Math.sin(heading), 0, Math.cos(heading))
    const forwardVec = new Vector3(
      horiz.x * Math.cos(inclineRad),
      -Math.sin(inclineRad),
      horiz.z * Math.cos(inclineRad),
    )
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
    const normalVec = new Vector3(
      horiz.x * Math.sin(inclineRad),
      Math.cos(inclineRad),
      horiz.z * Math.sin(inclineRad),
    )

    const rows = Math.floor(rampLength / pinSpacing) - 1
    for (let r = 1; r <= rows; r++) {
      const dist = r * pinSpacing
      const xOffsets = r % 2 === 0 ? evenOffsets : oddOffsets
      for (const xOff of xOffsets) {
        const pinPos = rampStart.add(forwardVec.scale(dist)).add(right.scale(xOff))
        const surfaceOffset = normalVec.scale(0.25 + pinHeight / 2)
        const finalPos = pinPos.add(surfaceOffset)

        const pin = MeshBuilder.CreateCylinder('pin', { diameter: pinDiameter, height: pinHeight }, this.scene)
        pin.position.copyFrom(finalPos)
        pin.rotation.x = inclineRad
        pin.material = material
        this.adventureTrack.push(pin)

        const { body } = this.colliders.emit(
          cylinderDesc(
            { x: finalPos.x, y: finalPos.y, z: finalPos.z },
            pinHeight / 2,
            pinDiameter / 2,
            {
              rotation: eulerQuat(pin.rotation.x, pin.rotation.y, pin.rotation.z),
              restitution: 0.6,
              label: 'pin',
            }
          )
        )
        this.adventureBodies.push(body)
      }
    }
  }

  /**
   * Kinematic mill whose angular velocity is along the ramp normal (not world Y).
   */
  protected createInclinedMill(
    center: Vector3,
    radius: number,
    inclineRad: number,
    angVelAlongNormal: number,
    material: StandardMaterial | PBRMaterial,
  ): void {
    if (!this.world) return

    const mill = MeshBuilder.CreateCylinder('mill', { diameter: radius * 2, height: 0.2 }, this.scene)
    mill.position.copyFrom(center)
    mill.rotation.x = inclineRad
    mill.material = material
    this.adventureTrack.push(mill)

    const normalVec = new Vector3(0, Math.cos(inclineRad), Math.sin(inclineRad))
    const angVel = normalVec.scale(angVelAlongNormal)

    const { body } = this.colliders.emit(
      cylinderDesc({ x: center.x, y: center.y, z: center.z }, 0.1, radius, {
        rotation: eulerQuat(inclineRad, 0, 0),
        friction: 1.0,
        motion: 'kinematic-velocity',
        angularVelocity: { x: angVel.x, y: angVel.y, z: angVel.z },
        label: 'inclinedMill',
      })
    )
    this.adventureBodies.push(body)
    this.kinematicBindings.push({ body, mesh: mill })
  }

  /**
   * Side catch basin with a reset sensor (penalty zone).
   */
  protected createResetBasin(pos: Vector3, material: StandardMaterial | PBRMaterial): void {
    if (!this.world) return

    const basin = MeshBuilder.CreateBox('resetBasin', { width: 4, height: 1, depth: 4 }, this.scene)
    basin.position.copyFrom(pos)
    basin.material = material
    this.adventureTrack.push(basin)

    const { body } = this.colliders.emit(
      boxDesc({ x: pos.x, y: pos.y, z: pos.z }, { x: 2, y: 0.5, z: 2 }, { label: 'resetBasin' })
    )
    this.adventureBodies.push(body)

    const sensorPos = pos.clone()
    sensorPos.y += 0.75
    const { body: sensorBody } = this.colliders.emit(
      boxDesc(
        { x: sensorPos.x, y: sensorPos.y, z: sensorPos.z },
        { x: 1.8, y: 0.25, z: 1.8 },
        { sensor: true, label: 'resetBasinSensor' }
      )
    )
    this.resetSensors.push(sensorBody)
  }

  /**
   * Creates a dynamic physics block.
   */
  protected createDynamicBlock(pos: Vector3, size: number, mass: number, material: StandardMaterial): void {
    if (!this.world) return

    const box = MeshBuilder.CreateBox("dynBlock", { size }, this.scene)
    box.position.copyFrom(pos)
    box.material = material
    this.adventureTrack.push(box)

    const volume = size * size * size
    const density = mass / volume

    const { body } = this.colliders.emit(
      boxDesc({ x: pos.x, y: pos.y, z: pos.z }, { x: size / 2, y: size / 2, z: size / 2 }, {
        density,
        friction: 0.5,
        restitution: 0.2,
        motion: 'dynamic',
        label: 'dynamicBlock',
      })
    )
    this.adventureBodies.push(body)
    this.kinematicBindings.push({ body, mesh: box })
  }

  /**
   * Creates a chroma gate that changes ball color state.
   */
  protected createChromaGate(pos: Vector3, color: 'RED' | 'GREEN' | 'BLUE'): void {
    if (!this.world) return

    const gateMat = this.getTrackMaterial(color === 'RED' ? "#FF0000" : color === 'GREEN' ? "#00FF00" : "#0000FF")
    const gate = MeshBuilder.CreateTorus("gate", { diameter: 4, thickness: 0.2 }, this.scene)
    gate.position.copyFrom(pos)
    gate.rotation.x = Math.PI / 2
    gate.material = gateMat
    this.adventureTrack.push(gate)

    const { body: sensor } = this.colliders.emit(
      cylinderDesc({ x: pos.x, y: pos.y, z: pos.z }, 0.5, 2.0, {
        sensor: true,
        label: 'chromaGate',
      })
    )

    this.chromaGates.push({ sensor, colorType: color })
  }

  /**
   * Creates an arc pylon with repulsive gravity well.
   */
  protected createArcPylon(pos: Vector3, mat: StandardMaterial): void {
    if (!this.world) return

    const pylon = MeshBuilder.CreateCylinder("pylon", { diameter: 1.0, height: 3.0 }, this.scene)
    pylon.position.copyFrom(pos)
    pylon.position.y += 1.5
    pylon.material = mat
    this.adventureTrack.push(pylon)

    const { body } = this.colliders.emit(
      cylinderDesc({ x: pos.x, y: pos.y + 1.5, z: pos.z }, 1.5, 0.5, { label: 'arcPylon' })
    )
    this.adventureBodies.push(body)

    // Repulsive Gravity Well
    const { body: sensor } = this.colliders.emit(
      sphereDesc({ x: pos.x, y: pos.y + 1.5, z: pos.z }, 3.0, {
        sensor: true,
        label: 'arcPylonWell',
      })
    )

    this.gravityWells.push({
      sensor,
      center: pos,
      strength: -50.0 // Repel
    })
  }

  /**
   * Declare the canonical exit portal position for this track.
   *
   * Call this from within a track builder function to record where the exit
   * portal should appear when the campaign supervisor activates it (on goal
   * completion or timer expiry). The position is consumed by
   * AdventureMode.activateExitPortal(), which falls back to a generic formula
   * when no position has been registered.
   *
   * @param position        World-space position of the portal centre.
   * @param _rotation       Optional orientation (reserved, not yet used).
   * @param _isActiveInitially  Reserved for future dormant portal visuals.
   */
  protected addExitPortal(
    position: Vector3,
    _rotation?: Quaternion,
    _isActiveInitially = false
  ): void {
    this.portalPosition = position.clone()
  }

  /**
   * Sets ball color state for collision filtering.
   */
  protected setBallColorState(ball: RAPIER.RigidBody, color: 'RED' | 'GREEN' | 'BLUE'): void {
    const collider = ball.collider(0)
    if (!collider) return

    let groups = 0

    switch (color) {
      case 'RED':
        groups = (GROUP_UNIVERSAL << 16) | MASK_RED
        break
      case 'GREEN':
        groups = (GROUP_UNIVERSAL << 16) | MASK_GREEN
        break
      case 'BLUE':
        groups = (GROUP_UNIVERSAL << 16) | MASK_BLUE
        break
    }

    collider.setCollisionGroups(groups)

    if (this.currentBallMesh) {
      const mat = this.currentBallMesh.material as StandardMaterial | PBRMaterial
      if (mat) {
        const matColor = color === 'RED' ? Color3.Red() : color === 'GREEN' ? Color3.Green() : Color3.Blue()
        mat.emissiveColor = matColor
        if ('diffuseColor' in mat) {
          mat.diffuseColor = matColor
        } else if ('albedoColor' in mat) {
          mat.albedoColor = matColor
        }
      }
    }
  }

  protected createExitPortal(
    position: Vector3,
    ringColorHex: string,
    coreColorHex: string,
    radius: number = 2.1,
    depth: number = 0.8
  ): {
    root: Mesh
    core: Mesh
    ringMaterial: StandardMaterial
    coreMaterial: StandardMaterial
    sensor: RAPIER.RigidBody
  } {
    const ring = MeshBuilder.CreateTorus(
      'exitPortalRing',
      { diameter: radius * 2, thickness: 0.45, tessellation: 48 },
      this.scene
    )
    ring.position.copyFrom(position)
    ring.rotation.x = Math.PI / 2

    const core = MeshBuilder.CreateDisc(
      'exitPortalCore',
      { radius: radius * 0.82, tessellation: 48 },
      this.scene
    )
    core.parent = ring
    core.position.z = -0.08

    const ringMaterial = new StandardMaterial('exitPortalRingMat', this.scene)
    ringMaterial.diffuseColor = Color3.Black()
    ringMaterial.emissiveColor = emissive(ringColorHex, INTENSITY.HIGH)
    ring.material = ringMaterial

    const coreMaterial = new StandardMaterial('exitPortalCoreMat', this.scene)
    coreMaterial.diffuseColor = Color3.Black()
    coreMaterial.emissiveColor = emissive(coreColorHex, INTENSITY.ACTIVE)
    coreMaterial.alpha = 0.72
    core.material = coreMaterial

    this.adventureTrack.push(ring, core)
    this.materials.push(ringMaterial, coreMaterial)

    const { body: sensor } = this.colliders.emit(
      cylinderDesc({ x: position.x, y: position.y, z: position.z }, depth, radius * 0.9, {
        sensor: true,
        collisionEvents: true,
        label: 'exitPortalSensor',
      })
    )
    this.adventureBodies.push(sensor)

    return {
      root: ring,
      core,
      ringMaterial,
      coreMaterial,
      sensor,
    }
  }
}
