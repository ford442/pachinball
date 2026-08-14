/**
 * Adventure Mode — exit-portal lifecycle.
 *
 * Owns the single active exit portal: spawning its visuals/sensor, animating
 * it each frame, and detecting when a ball has passed through.
 */

import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { AdventureCameraMixin } from './adventure-camera'
import { AdventureTrackType } from './adventure-types'
import { getTrackStartAnchor } from './portal-routing'
import { PALETTE } from '../game-elements/visual-language'
import type {
  ActiveExitPortal,
  ExitPortalKind,
  ExitPortalWorldMode,
} from './adventure-portal-types'

export abstract class AdventurePortalMixin extends AdventureCameraMixin {
  protected exitPortal: ActiveExitPortal | null = null
  /** Portals torn down since the last clearTrack() — merged into teardown stats. */
  protected portalsRemovedSinceClear = 0

  /**
   * Return the Rapier body handle of the active exit portal sensor, or -1 when
   * no portal is currently active.  Callers use this to register/unregister the
   * handle with GamePhysicsController so the collision dispatcher skips it.
   */
  getPortalSensorHandle(): number {
    return this.exitPortal?.sensor.handle ?? -1
  }

  activateExitPortal(
    trackId: AdventureTrackType,
    kind: ExitPortalKind,
    mode: ExitPortalWorldMode = 'STATIONARY_TABLE'
  ): boolean {
    if (!this.adventureActive) {
      return false
    }

    this.deactivateExitPortal()

    const position = this.getExitPortalPosition(trackId, mode)
    const isSuccess = kind === 'success'
    const ringHex = isSuccess ? PALETTE.CYAN : PALETTE.ALERT
    const coreHex = isSuccess ? PALETTE.GOLD : PALETTE.MAGENTA
    const portalRadius = mode === 'EXTENDED_MAP' ? 2.6 : 2.1
    const portalDepth = mode === 'EXTENDED_MAP' ? 1.0 : 0.8

    const portalParts = this.createExitPortal(position, ringHex, coreHex, portalRadius, portalDepth)

    this.exitPortal = {
      id: `${trackId}-exit-portal`,
      trackId,
      kind,
      mode,
      root: portalParts.root,
      core: portalParts.core,
      sensor: portalParts.sensor,
      ringMaterial: portalParts.ringMaterial,
      coreMaterial: portalParts.coreMaterial,
      ringBase: Color3.FromHexString(ringHex),
      coreBase: Color3.FromHexString(coreHex),
      animationTime: 0,
    }

    this.onEvent?.('PORTAL_ACTIVATED', {
      id: this.exitPortal.id,
      trackId,
      kind,
      mode,
      position,
    })

    return true
  }

  deactivateExitPortal(): void {
    if (!this.exitPortal) return

    const portal = this.exitPortal
    this.exitPortal = null

    this.onEvent?.('PORTAL_DEACTIVATED', { handle: portal.sensor.handle })

    portal.root.dispose()
    this.portalsRemovedSinceClear++

    if (this.world.getRigidBody(portal.sensor.handle)) {
      this.world.removeRigidBody(portal.sensor)
    }

    // createExitPortal() registers the sensor in adventureBodies — remove it here
    // so clearTrack() does not count an already-removed body as lingering.
    const bodyIndex = this.adventureBodies.indexOf(portal.sensor)
    if (bodyIndex >= 0) {
      this.adventureBodies.splice(bodyIndex, 1)
    }

    const portalMeshSet = new Set([portal.root, portal.core])
    this.adventureTrack = this.adventureTrack.filter(
      (mesh) => !portalMeshSet.has(mesh) && mesh.parent !== portal.root,
    )
    this.materials = this.materials.filter(
      (mat) => mat !== portal.ringMaterial && mat !== portal.coreMaterial,
    )
  }

  private getExitPortalPosition(trackId: AdventureTrackType, mode: ExitPortalWorldMode): Vector3 {
    // Use the builder-declared position when available (set by addExitPortal())
    if (this.portalPosition) {
      return this.portalPosition.clone()
    }
    // Fallback: generic formula relative to the track start anchor
    const anchor = getTrackStartAnchor(trackId)
    const zOffset = mode === 'EXTENDED_MAP' ? 95 : 55
    const yOffset = mode === 'EXTENDED_MAP' ? 2.2 : 1.4
    return new Vector3(anchor.x, anchor.y + yOffset, anchor.z + zOffset)
  }

  protected updateExitPortal(dt: number, ballBodies: RAPIER.RigidBody[]): void {
    const portal = this.exitPortal
    if (!portal) return

    portal.animationTime += dt

    if (this.accessibility.reducedMotion || this.accessibility.flashFrequencyMax <= 1) {
      portal.ringBase.scaleToRef(1.0, portal.ringMaterial.emissiveColor)
      portal.coreBase.scaleToRef(0.75, portal.coreMaterial.emissiveColor)
    } else {
      portal.root.rotation.z += dt * (portal.kind === 'success' ? 2.5 : 3.5)
      const pulse = 0.85 + Math.sin(portal.animationTime * (portal.kind === 'success' ? 6.0 : 8.0)) * 0.25
      portal.ringBase.scaleToRef(1.2 * pulse, portal.ringMaterial.emissiveColor)
      portal.coreBase.scaleToRef(0.85 * pulse, portal.coreMaterial.emissiveColor)
    }

    const sensorCollider = portal.sensor.collider(0)
    if (!sensorCollider) return

    const isAnyBallInside = ballBodies.some((candidateBall) => {
      const ballCollider = candidateBall.collider(0)
      return !!ballCollider && this.world.intersectionPair(sensorCollider, ballCollider)
    })
    if (!isAnyBallInside) return

    this.onEvent?.('PORTAL_ENTERED', {
      id: portal.id,
      trackId: portal.trackId,
      kind: portal.kind,
      position: portal.root.position.clone(),
    })

    this.deactivateExitPortal()
  }
}
