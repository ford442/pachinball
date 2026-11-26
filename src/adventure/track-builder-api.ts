/**
 * The surface a track is built through (#489 slice A).
 *
 * `TrackBuildApi` is the primitive set (ramps, basins, spinners, pin fields,
 * C++ toys). `TrackBuilderApi` adds what the element segments need — the
 * scene, the per-track lists, the collider emitter — and is what the JSON
 * compiler builds every track through. `TrackBuilder.trackBuilderApi()`
 * implements it; tests stub the primitive part.
 *
 * The object is rebuilt per build: clearTrack() swaps the lists below for new
 * arrays, so nothing may keep it past its synchronous build call.
 */

import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import type { PhysicsBody } from '../core/physics-api'
import type { PinFieldSpec } from '../core/pin-field'
import type {
  AnimatedObstacle,
  ChromaGate,
  ConveyorZone,
  DampingZone,
  GravityWell,
  KinematicBinding,
} from './adventure-types'
import type { TrackInfo } from './adventure-track-progression'
import type { AdventureColliderDesc, ForceFieldSpace } from './track-collider-descriptors'
import type { EmittedCollider } from './track-collider-emitter'
import type { GeoQuat, GeoVec3 } from './track-geometry'
import type { TrackMaterialRole } from './track-theme-profiles'

export type TrackMaterial = StandardMaterial | PBRMaterial

/** The track primitives. Implemented by TrackBuilder; stubbed in unit tests. */
export interface TrackBuildApi {
  currentStartPos: Vector3
  getTrackMaterial(colorHex: string): TrackMaterial
  getThemedTrackMaterial(role: TrackMaterialRole): TrackMaterial
  addStraightRamp(
    startPos: Vector3,
    heading: number,
    width: number,
    length: number,
    inclineRad: number,
    material: TrackMaterial,
    wallHeight?: number,
    friction?: number,
  ): Vector3
  addCurvedRamp(
    startPos: Vector3,
    startHeading: number,
    radius: number,
    totalAngle: number,
    inclineRad: number,
    width: number,
    wallHeight: number,
    material: TrackMaterial,
    segments?: number,
    bankingAngle?: number,
    friction?: number,
  ): Vector3
  createBasin(pos: Vector3, material: TrackMaterial): void
  addExitPortal(position: Vector3): void
  createRotatingPlatform(
    center: Vector3,
    radius: number,
    angVelY: number,
    material: TrackMaterial,
    hasTeeth?: boolean,
  ): void
  createChromaGate(pos: Vector3, color: 'RED' | 'GREEN' | 'BLUE'): void
  createStaticCylinder(
    pos: Vector3,
    diameter: number,
    height: number,
    material: TrackMaterial,
  ): void
  createPinField(
    rampStart: Vector3,
    heading: number,
    inclineRad: number,
    rampLength: number,
    pinSpacing: number,
    evenOffsets: readonly number[],
    oddOffsets: readonly number[],
    pinDiameter: number,
    pinHeight: number,
    material: TrackMaterial,
  ): void
  createInclinedMill(
    center: Vector3,
    radius: number,
    inclineRad: number,
    angVelAlongNormal: number,
    material: TrackMaterial,
  ): void
  createResetBasin(pos: Vector3, material: TrackMaterial): void
  /** One native pin field (a single C++ handle), spec already in world space. */
  createPinLattice(spec: PinFieldSpec, material: TrackMaterial): void
  /** One C++ force field box. */
  createForceField(
    center: GeoVec3,
    halfExtents: GeoVec3,
    rotation: GeoQuat,
    acceleration: GeoVec3,
    space: ForceFieldSpace,
    visible: boolean,
    material: TrackMaterial,
  ): void
  /** One static cone (one C++ handle), base centred on `base`. */
  createStaticCone(
    base: GeoVec3,
    radius: number,
    halfHeight: number,
    rotation: GeoQuat,
    restitution: number,
    friction: number,
    material: TrackMaterial,
  ): void
  /** One C++ axis-pull well. */
  createAxisPullWell(
    center: GeoVec3,
    radius: number,
    halfHeight: number,
    strength: number,
    enabled: boolean,
    visible: boolean,
    material: TrackMaterial,
  ): void
}

export interface TrackBuilderApi extends TrackBuildApi {
  /** Scene that track meshes are created in. */
  readonly scene: Scene
  /** False when the builder has no physics world (bodies are then never created). */
  readonly hasWorld: boolean
  /** Campaign catalog info for the track being built; null for free-roam. */
  readonly currentTrackInfo: TrackInfo | null

  // Per-track lists. The element segments push what they build outside the
  // primitives so the per-frame systems and clearTrack() see it.
  readonly adventureTrack: Mesh[]
  readonly adventureBodies: PhysicsBody[]
  readonly kinematicBindings: KinematicBinding[]
  readonly animatedObstacles: AnimatedObstacle[]
  readonly conveyorZones: ConveyorZone[]
  readonly gravityWells: GravityWell[]
  readonly dampingZones: DampingZone[]
  readonly chromaGates: ChromaGate[]
  readonly resetSensors: PhysicsBody[]

  getTrackMaterial(colorHex: string): StandardMaterial
  /** Emissive PBR material with clear coat, for tracks that want a glassier look. */
  getTrackPBRMaterial(colorHex: string): PBRMaterial

  /** Arc pylon with a repulsive gravity well. */
  createArcPylon(pos: Vector3, mat: TrackMaterial): void
  /**
   * Declare the exit portal position. AdventureMode.activateExitPortal() uses
   * it when the supervisor signals success or timeout; `rotation` and
   * `isActiveInitially` are reserved.
   */
  addExitPortal(position: Vector3, rotation?: Quaternion, isActiveInitially?: boolean): void

  /** Emit one collider: recorded as a descriptor (for the C++ export) and realised on Rapier. */
  emitCollider(desc: AdventureColliderDesc): EmittedCollider
  /** Emit an extra body-local collider on an already-emitted body. */
  attachCollider(parent: EmittedCollider | PhysicsBody, desc: AdventureColliderDesc): void
}
