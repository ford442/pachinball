import type { TransformNode, Mesh, StandardMaterial, PointLight } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export interface PhysicsBinding {
  mesh: TransformNode
  rigidBody: RAPIER.RigidBody
}

export interface BumperVisual {
  mesh: Mesh
  body: RAPIER.RigidBody
  hologram?: Mesh
  hitTime: number
  sweep: number
}

export enum GameState {
  MENU,
  PAUSED,
  PLAYING,
  GAME_OVER,
}

export enum DisplayState {
  IDLE,
  REACH,
  FEVER,
}

export interface CabinetLight {
  mesh: Mesh
  material: StandardMaterial
  pointLight: PointLight
}

export interface ShardParticle {
  mesh: Mesh
  vel: import('@babylonjs/core').Vector3
  life: number
  material: StandardMaterial
}

export interface CaughtBall {
  body: RAPIER.RigidBody
  targetPos: import('@babylonjs/core').Vector3
  timer: number
}
