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
import { Scene } from '@babylonjs/core/scene'
import type { PhysicsApi, PhysicsBody, PhysicsWorldSink } from '../core/physics-api'
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
import type { TrackMaterialRole } from './track-theme-profiles'
import {
  createThemedTrackMaterial,
  createTrackMaterial,
  createTrackPBRMaterial,
} from './track-materials'
import {
  applyBallImpulse,
  testSensorOverlap,
  type AdventurePhysicsBridge,
} from './track-physics-bridge'
import * as primitives from './track-primitives'
import type { TrackPrimitiveContext } from './track-primitives'
import { COLLISION_GROUP_PRESETS } from '../game-elements/physics'
import type { AdventureColliderDesc } from './track-collider-descriptors'
import { TrackColliderEmitter, type EmittedCollider } from './track-collider-emitter'
import type { TrackDefinition } from './track-schema'
import {
  compileTrackDefinition,
  type TrackBuildApi,
  type TrackCursor,
} from './track-compiler'

const RAPIER_DEFAULT_COLLISION_GROUPS = 0xFFFFFFFF

export abstract class TrackBuilder {
  protected scene: Scene
  protected world: PhysicsWorldSink
  protected rapier: PhysicsApi

  // State Management
  protected adventureTrack: Mesh[] = []
  protected materials: (StandardMaterial | PBRMaterial)[] = []
  protected adventureBodies: PhysicsBody[] = []
  protected kinematicBindings: KinematicBinding[] = []
  protected animatedObstacles: AnimatedObstacle[] = []
  protected conveyorZones: ConveyorZone[] = []
  protected gravityWells: GravityWell[] = []
  protected dampingZones: DampingZone[] = []
  protected chromaGates: ChromaGate[] = []
  protected adventureSensor: PhysicsBody | null = null
  protected resetSensors: PhysicsBody[] = []
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

  /**
   * Rapier geometry this track built outside the descriptor path (today only
   * prism-pathway's convex hull). A track with any of these can never be
   * fully exported to C++, whatever its descriptors say.
   */
  protected unexportedColliders: string[] = []

  /**
   * Bumped every time the track's collider set changes (a build or a
   * teardown). The C++ adventure exporter watches this to know when to
   * rewrite its static scene.
   */
  private colliderEpoch = 0

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

  /** See `AdventurePhysicsBridge`. Unset, zone effects fall back to Rapier. */
  private physicsBridge: AdventurePhysicsBridge | null = null

  /** Install (or clear, with null) the WASM-backed overlap/impulse bridge. */
  setPhysicsBridge(bridge: AdventurePhysicsBridge | null): void {
    this.physicsBridge = bridge
  }

  /** True when `ball` currently overlaps `sensorBody`'s trigger volume. */
  protected testSensorOverlap(sensorBody: PhysicsBody, ball: PhysicsBody): boolean {
    return testSensorOverlap(this.physicsBridge, this.world, sensorBody, ball)
  }

  /** Apply a world-space impulse to a ball, on whichever engine owns it. */
  protected applyBallImpulse(ball: PhysicsBody, x: number, y: number, z: number): void {
    applyBallImpulse(this.physicsBridge, ball, x, y, z)
  }

  constructor(scene: Scene, world: PhysicsWorldSink, rapier: PhysicsApi) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.colliders = new TrackColliderEmitter(world, rapier)
  }

  /** Collider descriptors emitted by the currently-built track. */
  getColliderDescriptors(): readonly AdventureColliderDesc[] {
    return this.colliders.list()
  }

  /** Monotonic id of the current collider set; changes on build and teardown. */
  getColliderEpoch(): number {
    return this.colliderEpoch
  }

  /** The Rapier body a descriptor was realised as, for C++ handle mapping. */
  getBodyForDescriptor(index: number): PhysicsBody | null {
    return this.colliders.bodyForDescriptor(index)
  }

  /**
   * Emit one collider for this track: recorded as a descriptor and realised
   * as a Rapier body. Track modules call this instead of building
   * `rapier.ColliderDesc` inline, so the same geometry can be replayed into
   * the C++ engine.
   */
  emitCollider(desc: AdventureColliderDesc): EmittedCollider {
    this.colliderEpoch++
    return this.colliders.emit(desc)
  }

  /**
   * Drop an emitted body's colliders from the descriptor list before the body
   * is removed from the Rapier world, so the C++ export stops carrying them.
   */
  retireEmittedBody(body: PhysicsBody): void {
    if (this.colliders.retireBody(body)) this.colliderEpoch++
  }

  /**
   * Declare that this track built a Rapier collider the descriptor path does
   * not cover, so the C++ adventure gate knows the export is incomplete.
   */
  markUnexportedCollider(reason: string): void {
    this.colliderEpoch++
    this.unexportedColliders.push(reason)
  }

  /** Reasons this track cannot be fully exported to C++; empty when it can. */
  getUnexportedColliders(): readonly string[] {
    return this.unexportedColliders
  }

  /** Drop the previous track's descriptors (called from clearTrack). */
  protected resetTrackColliders(): void {
    this.colliderEpoch++
    this.colliders.clear()
    this.unexportedColliders = []
  }

  /**
   * Emit an extra, body-local collider on an already-emitted body. Accepts
   * either the handle emitCollider() returned or the raw Rapier body.
   */
  attachCollider(parent: EmittedCollider | PhysicsBody, desc: AdventureColliderDesc): void {
    this.colliderEpoch++
    this.colliders.attach(parent, desc)
  }

  /**
   * Registers a callback listener to handle story events in the main Game class.
   */
  setEventListener(callback: AdventureCallback): void {
    this.onEvent = callback
  }

  /**
   * Every Rapier body this track owns — structure plus each sensor family.
   *
   * Deduplicated, because a body can be reachable through more than one list
   * (a bucket contributes both its floor and its goal sensor). This is the
   * single enumeration of the track's physics footprint, used both to stamp
   * collision groups and to export the track into the WASM world.
   */
  collectTrackBodies(): PhysicsBody[] {
    const bodies = new Set<PhysicsBody>()

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

    return [...bodies]
  }

  protected applyDefaultAdventureCollisionGroups(): void {
    for (const body of this.collectTrackBodies()) {
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
  getSensor(): PhysicsBody | null {
    return this.adventureSensor
  }

  /**
   * Get reset sensors for penalty zones
   */
  getResetSensors(): PhysicsBody[] {
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
  // Construction lives in track-materials.ts; these keep the protected surface.

  protected getTrackMaterial(colorHex: string): StandardMaterial {
    return createTrackMaterial(this.scene, this.materials, colorHex)
  }

  /**
   * Get a PBR track material with emissive glow and clear coat.
   * Use this for tracks that should look more physically realistic.
   */
  protected getTrackPBRMaterial(colorHex: string): PBRMaterial {
    return createTrackPBRMaterial(this.scene, this.materials, colorHex)
  }

  /**
   * Resolve adventure track geometry material from the active track's premium profile.
   */
  protected getThemedTrackMaterial(role: TrackMaterialRole): StandardMaterial | PBRMaterial {
    return createThemedTrackMaterial(
      this.scene,
      this.materials,
      role,
      this.currentTrackInfo?.id ?? ''
    )
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
  //
  // Geometry + mesh construction lives in track-primitives.ts (over the pure
  // layout maths in track-geometry.ts). These wrappers keep the protected
  // method surface every track module already calls.

  /** Context handed to each primitive. Rebuilt per call — clearTrack() swaps
   * the arrays out, so a cached context would hold the old track's lists. */
  private primitiveContext(): TrackPrimitiveContext {
    return {
      scene: this.scene,
      hasWorld: Boolean(this.world),
      adventureTrack: this.adventureTrack,
      adventureBodies: this.adventureBodies,
      kinematicBindings: this.kinematicBindings,
      gravityWells: this.gravityWells,
      chromaGates: this.chromaGates,
      resetSensors: this.resetSensors,
      materials: this.materials,
      emit: (desc) => this.colliders.emit(desc),
      attach: (parent, desc) => this.colliders.attach(parent, desc),
      getTrackMaterial: (hex) => this.getTrackMaterial(hex),
      setGoalSensor: (body) => {
        this.adventureSensor = body
      },
    }
  }

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
    return primitives.addStraightRamp(
      this.primitiveContext(),
      startPos, heading, width, length, inclineRad, material, wallHeight, friction
    )
  }

  /** Creates a curved ramp segment. */
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
    return primitives.addCurvedRamp(
      this.primitiveContext(),
      startPos, startHeading, radius, totalAngle, inclineRad, width, wallHeight,
      material, segments, bankingAngle, friction
    )
  }

  /** Creates walls alongside a track segment. */
  protected createWall(
    center: Vector3,
    heading: number,
    length: number,
    trackWidth: number,
    height: number,
    inclineRad: number,
    mat: StandardMaterial | PBRMaterial,
    friction: number = 0.5
  ): void {
    primitives.createWall(
      this.primitiveContext(),
      center, heading, length, trackWidth, height, inclineRad, mat, friction
    )
  }

  /** Creates a rotating platform. */
  protected createRotatingPlatform(
    center: Vector3,
    radius: number,
    angVelY: number,
    material: StandardMaterial | PBRMaterial,
    hasTeeth: boolean = false
  ): void {
    primitives.createRotatingPlatform(
      this.primitiveContext(), center, radius, angVelY, material, hasTeeth
    )
  }

  /** Creates a goal basin at the specified position. */
  protected createBasin(pos: Vector3, material: StandardMaterial | PBRMaterial): void {
    primitives.createBasin(this.primitiveContext(), pos, material)
  }

  /** Creates a static cylinder obstacle. */
  protected createStaticCylinder(
    pos: Vector3,
    diameter: number,
    height: number,
    material: StandardMaterial | PBRMaterial,
  ): void {
    primitives.createStaticCylinder(this.primitiveContext(), pos, diameter, height, material)
  }

  /** Lattice of static pins on the most recent straight ramp surface. */
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
    primitives.createPinField(
      this.primitiveContext(),
      rampStart, heading, inclineRad, rampLength, pinSpacing,
      evenOffsets, oddOffsets, pinDiameter, pinHeight, material
    )
  }

  /** Kinematic mill whose angular velocity is along the ramp normal (not world Y). */
  protected createInclinedMill(
    center: Vector3,
    radius: number,
    inclineRad: number,
    angVelAlongNormal: number,
    material: StandardMaterial | PBRMaterial,
  ): void {
    primitives.createInclinedMill(
      this.primitiveContext(), center, radius, inclineRad, angVelAlongNormal, material
    )
  }

  /** Side catch basin with a reset sensor (penalty zone). */
  protected createResetBasin(pos: Vector3, material: StandardMaterial | PBRMaterial): void {
    primitives.createResetBasin(this.primitiveContext(), pos, material)
  }

  /** Creates a dynamic physics block. */
  protected createDynamicBlock(pos: Vector3, size: number, mass: number, material: StandardMaterial): void {
    primitives.createDynamicBlock(this.primitiveContext(), pos, size, mass, material)
  }

  /** Creates a chroma gate that changes ball color state. */
  protected createChromaGate(pos: Vector3, color: 'RED' | 'GREEN' | 'BLUE'): void {
    primitives.createChromaGate(this.primitiveContext(), pos, color)
  }

  /** Creates an arc pylon with repulsive gravity well. */
  protected createArcPylon(pos: Vector3, mat: StandardMaterial): void {
    primitives.createArcPylon(this.primitiveContext(), pos, mat)
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
  protected setBallColorState(ball: PhysicsBody, color: 'RED' | 'GREEN' | 'BLUE'): void {
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
  ): primitives.ExitPortalParts {
    return primitives.createExitPortal(
      this.primitiveContext(), position, ringColorHex, coreColorHex, radius, depth
    )
  }
}
