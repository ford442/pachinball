// Types and interfaces for game objects
import type { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export interface FlipperConfig {
  position: Vector3
  length: number
  angle: number
  strength: number
  isLeft: boolean
}

export interface BumperConfig {
  position: Vector3
  radius: number
  points: number
  color: string
}

export interface WallConfig {
  start: Vector3
  end: Vector3
  height: number
  thickness: number
}

export interface RailConfig {
  path: Vector3[]
  radius: number
}

export interface GameObjectRefs {
  flippers: Map<string, { mesh: TransformNode; body: RAPIER.RigidBody; joint: RAPIER.ImpulseJoint }>
  bumpers: Map<string, Mesh>
  walls: Mesh[]
  rails: Mesh[]
  pins: AbstractMesh[]
}

export interface FlipperVisuals {
  root: TransformNode
  blade: Mesh
  tip: Mesh
  bevelLeft: Mesh
  bevelRight: Mesh
  pivotCyl: Mesh
  pivotCap: Mesh
  pivotRing: Mesh
}
