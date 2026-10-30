/**
 * TrackBuilderApi — the public surface a TS track module builds through (#489 slice A).
 *
 * Track modules (`src/adventure/tracks/*`) used to reach into TrackBuilder's
 * protected members with `as unknown as` casts. They now take this interface
 * as their only parameter; `TrackBuilder.trackBuilderApi()` implements it, and
 * the JSON compiler builds through the same object (it is a `TrackBuildApi`).
 *
 * The object is rebuilt per build: clearTrack() swaps the lists below for new
 * arrays, so a module must not keep it past its synchronous build call.
 */

import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import type { PhysicsBody } from '../core/physics-api'
import type {
  AnimatedObstacle,
  ChromaGate,
  ConveyorZone,
  DampingZone,
  GravityWell,
  KinematicBinding,
} from './adventure-types'
import type { TrackInfo } from './adventure-track-progression'
import type { AdventureColliderDesc } from './track-collider-descriptors'
import type { EmittedCollider } from './track-collider-emitter'
import type { TrackBuildApi } from './track-compiler'

export interface TrackBuilderApi extends TrackBuildApi {
  /** Scene that track meshes are created in. */
  readonly scene: Scene
  /** False when the builder has no physics world (bodies are then never created). */
  readonly hasWorld: boolean
  /** Campaign catalog info for the track being built; null for free-roam. */
  readonly currentTrackInfo: TrackInfo | null

  // Per-track lists. A module pushes what it builds outside the primitives
  // so the per-frame systems and clearTrack() see it.
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
  createArcPylon(pos: Vector3, mat: StandardMaterial): void
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
