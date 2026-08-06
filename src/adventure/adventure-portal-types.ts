/**
 * Shared types for the adventure exit-portal system.
 */

import type { Mesh, StandardMaterial, Color3 } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import type { AdventureTrackType } from './adventure-types'

export type ExitPortalKind = 'success' | 'timeout'
export type ExitPortalWorldMode = 'STATIONARY_TABLE' | 'EXTENDED_MAP'

export const FALLOUT_Y_THRESHOLD = -25

export interface ActiveExitPortal {
  id: string
  trackId: AdventureTrackType
  kind: ExitPortalKind
  mode: ExitPortalWorldMode
  root: Mesh
  core: Mesh
  sensor: RAPIER.RigidBody
  ringMaterial: StandardMaterial
  coreMaterial: StandardMaterial
  ringBase: Color3
  coreBase: Color3
  animationTime: number
}
