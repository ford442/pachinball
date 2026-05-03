import type { Vector3 } from '@babylonjs/core'

export interface PathMechanicConfig {
  position: Vector3
  mapBaseColor: string
  mapAccentColor: string
  isActive?: boolean
}

export interface MovingGateConfig extends PathMechanicConfig {
  gateWidth: number
  openHeight: number
  closedHeight: number
  cycleDuration: number
  startOpen?: boolean
}

export interface MagneticFieldConfig extends PathMechanicConfig {
  fieldRadius: number
  pullStrength: number
  liftForce: number
}

export interface SpinnerLauncherConfig extends PathMechanicConfig {
  spinnerRadius: number
  launchForce: number
  spinSpeed: number
}

export interface JumpPadConfig extends PathMechanicConfig {
  launchAngle: number
  launchForce: number
  cooldown: number
}

export interface ReactivePegClusterConfig extends PathMechanicConfig {
  pegCount: number
  clusterRadius: number
  activationScore: number
}
