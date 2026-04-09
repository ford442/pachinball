// Types and interfaces for game objects
import type { Mesh, Vector3, TransformNode } from '@babylonjs/core'
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
  pins: Mesh[]
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
