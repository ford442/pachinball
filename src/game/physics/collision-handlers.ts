/**
 * Collision obstacle handlers — individual scoring/effects reactions for each
 * obstacle type. Pulled out of CollisionDispatcher so the dispatch logic stays
 * focused on handle-space conversion and routing.
 */

import { Vector3 } from '@babylonjs/core'
import type { Mesh } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'

import type { BumperVisual } from '../../game-elements/types'
import { DisplayState } from '../../game-elements'
import { GAME_TUNING, PhysicsConfig } from '../../config'
import { getPhysicsTuningValue } from '../../game-elements/physics-tuning'
import { TABLE_MAPS } from '../../shaders/lcd-table'
import { PALETTE } from '../../game-elements'

import type { PhysicsHost } from './types'
import type { ScoringBridge } from './scoring-bridge'

export interface CollisionHandlerContext {
  host: PhysicsHost
  scoringBridge: ScoringBridge
  ballHandleSet: Set<number>
  bumperVisualMap: Map<number, BumperVisual>
}

export function handleBumperCollision(
  ctx: CollisionHandlerContext,
  bump: RAPIER.RigidBody,
  ballBody: RAPIER.RigidBody,
  ballHandle: number
): void {
  if (!ctx.ballHandleSet.has(ballHandle)) return

  const ballPos = ballBody.translation()
  const vis = ctx.bumperVisualMap.get(bump.handle)
  if (!vis) return

  const ballMesh = getBallMeshForBody(ctx.host, ballBody)
  if (ballMesh && ctx.host.ballAnimator) {
    const velocity = ballBody.linvel()
    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)
    const impactIntensity = Math.min(speed / 20, 1.0)
    const bumperPos = vis.mesh.position
    const impactNormal = new Vector3(
      ballPos.x - bumperPos.x,
      ballPos.y - bumperPos.y,
      ballPos.z - bumperPos.z
    ).normalize()
    ctx.host.ballAnimator.animateBallImpact(ballMesh, impactNormal, impactIntensity)
  }

  if (ballPos.y > 1.5) {
    if (ctx.host.display?.getDisplayState() === DisplayState.IDLE) {
      ctx.scoringBridge.activateHologramCatch(ballBody, bump, ctx.bumperVisualMap)
    }
    return
  }

  ctx.host.gameObjects?.activateBumperHit(bump)
  ctx.host.effects?.addCameraShake(0.3)
  const comboResult = ctx.scoringBridge.registerBumperHit()
  ctx.scoringBridge.syncComboSnapshot()
  ctx.scoringBridge.emitComboProgressEvent(comboResult.event)
  ctx.scoringBridge.emitComboChainEvent(comboResult.chain)

  const bumperBasePoints = GAME_TUNING.scoring.bumperHitBase * (Math.floor(comboResult.comboCount / GAME_TUNING.combo.multiplierDivisor) + 1)
  const chainAdjustedBase = Math.round(bumperBasePoints * comboResult.chain.chainMultiplier)
  ctx.scoringBridge.awardScore(
    chainAdjustedBase,
    'bumper-hit',
    new Vector3(ballPos.x, ballPos.y, ballPos.z)
  )
  if (comboResult.chain.bonusPoints > 0) {
    ctx.scoringBridge.awardScore(comboResult.chain.bonusPoints, 'combo-chain-bonus', new Vector3(ballPos.x, ballPos.y, ballPos.z))
    ctx.scoringBridge.recordChainBonus(comboResult.chain.bonusPoints)
  }
  ctx.scoringBridge.registerComboMultiplierHit()

  if (comboResult.comboCount >= GAME_TUNING.combo.feverThreshold && ctx.host.display?.getDisplayState() === DisplayState.IDLE) {
    ctx.host.eventBus.emit('fever:start')
    ctx.host.eventBus.emit('display:set', DisplayState.FEVER)
    ctx.host.effects?.setLightingMode('fever', 0)
  }

  const impactTier = ctx.scoringBridge.getComboImpactTier()
  ctx.host.effects?.spawnEnhancedBumperImpact(vis.mesh.position, impactTier)
  ctx.host.effects?.spawnBumperSpark(vis.mesh.position, vis.color || PALETTE.CYAN)
  ctx.host.effects?.spawnImpactRing(vis.mesh.position, new Vector3(0, 1, 0), PALETTE.CYAN)
  ctx.host.effects?.triggerImpactFlash(vis.mesh.position, 1.0, vis.color || '#44aaff')
  ctx.host.effects?.playBeep(400 + Math.random() * 200)
  ctx.host.updateHUD()
  ctx.host.effects?.setLightingMode('hit', impactTier === 'heavy' ? 0.35 : impactTier === 'medium' ? 0.25 : 0.2)
  ctx.host.adventureState.updateGoal('hit-pegs', 1)

  const velocity = ballBody.linvel()
  const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)
  ctx.host.hapticManager?.bumper(speed)

  const impactNormal = new Vector3(
    ballPos.x - vis.mesh.position.x,
    ballPos.y - vis.mesh.position.y,
    ballPos.z - vis.mesh.position.z
  ).normalize()
  applySpinTransfer(ctx.host, ballBody, impactNormal, speed)

  if (speed > 12) {
    const mapColor = TABLE_MAPS[ctx.host.mapManager?.getCurrentMap() || 'neon-helix']?.baseColor || '#00d9ff'
    ctx.host.effects?.triggerCabinetShake('heavy', mapColor)
  }
  if (speed > 8) {
    const impactStrength = Math.min((speed - 8) / 14, 1)
    ctx.host.cameraController?.notifyImpact(vis.mesh.position, impactStrength)
  }

  ctx.host.soundSystem.playImpact('bumper', speed, {
    position: new Vector3(ballPos.x, ballPos.y, ballPos.z),
  })
}

export function handleFlipperCollision(
  ctx: CollisionHandlerContext,
  flipperBody: RAPIER.RigidBody,
  ballBody: RAPIER.RigidBody,
  ballHandle: number
): void {
  if (!ctx.ballHandleSet.has(ballHandle)) return

  const ballVel = ballBody.linvel()
  const speed = Math.sqrt(ballVel.x ** 2 + ballVel.y ** 2 + ballVel.z ** 2)
  const impactIntensity = Math.min(speed / 15, 1.0)

  const flipperPos = flipperBody.translation()
  const ballPos = ballBody.translation()
  const collisionNormal = new Vector3(
    ballPos.x - flipperPos.x,
    ballPos.y - flipperPos.y,
    ballPos.z - flipperPos.z
  ).normalize()

  const ballMesh = getBallMeshForBody(ctx.host, ballBody)
  if (ballMesh && ctx.host.ballAnimator) {
    ctx.host.ballAnimator.animateBallImpact(ballMesh, collisionNormal, impactIntensity * 0.7)
  }

  ctx.host.hapticManager?.flipper()
  ctx.host.effects?.playBeep(880 + Math.random() * 200)
  ctx.host.soundSystem.playImpact('flipper', speed, {
    position: new Vector3(ballPos.x, ballPos.y, ballPos.z),
  })

  const kickScale = getPhysicsTuningValue('flipperKickImpulse')
  const flipperAngVel = flipperBody.angvel().y
  if (kickScale > 0 && Math.abs(flipperAngVel) > 2 && speed > 1.2) {
    const rapier = ctx.host.physics.getRapier()
    if (rapier) {
      const kickStrength = Math.min(Math.abs(flipperAngVel) / 10, 1) * kickScale
      const lateralSign = flipperPos.x > 0 ? -1 : 1
      ballBody.applyImpulse(
        new rapier.Vector3(
          lateralSign * kickStrength * 0.35,
          kickStrength * 0.2,
          kickStrength * 0.95,
        ),
        true,
      )
      ctx.host.effects?.addCameraShake(Math.min(kickStrength * 0.08, 0.12))
    }
  }

  applySpinTransfer(ctx.host, ballBody, collisionNormal, speed)
}

export function handleTargetCollision(
  ctx: CollisionHandlerContext,
  tgt: RAPIER.RigidBody,
  ballBody: RAPIER.RigidBody,
  ballHandle: number
): void {
  if (ctx.ballHandleSet.has(ballHandle)) {
    const ballMesh = getBallMeshForBody(ctx.host, ballBody)
    if (ballMesh && ctx.host.ballAnimator) {
      const velocity = ballBody.linvel()
      const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)
      const impactIntensity = Math.min(speed / 20, 1.0)
      ctx.host.ballAnimator.animateSimpleImpact(ballMesh, impactIntensity)
      ctx.host.soundSystem.playImpact('peg', speed, {
        position: new Vector3(ballBody.translation().x, ballBody.translation().y, ballBody.translation().z),
      })
    }
  }

  if (ctx.host.gameObjects?.deactivateTarget(tgt)) {
    const ballPos = ballBody.translation()
    ctx.scoringBridge.awardScore(
      GAME_TUNING.scoring.targetHitBase,
      'target-hit',
      new Vector3(ballPos.x, ballPos.y, ballPos.z)
    )
    ctx.scoringBridge.registerComboMultiplierHit()
    ctx.host.effects?.playBeep(1200)
    ctx.host.ballManager?.spawnExtraBalls(1)
    ctx.host.updateHUD()
    ctx.host.eventBus.emit('reach:start')
    ctx.host.eventBus.emit('display:set', DisplayState.REACH)
    ctx.host.effects?.setLightingMode('reach', 3.0)
    ctx.host.effects?.setAtmosphereState('REACH')
    ctx.host.rebuildHandleCaches()
  }
}

export function handleSpinnerCollision(
  ctx: CollisionHandlerContext,
  obstacleBody: RAPIER.RigidBody,
  ballBody: RAPIER.RigidBody,
  ballHandle: number
): void {
  if (!ctx.ballHandleSet.has(ballHandle)) return

  ctx.scoringBridge.registerComboObstacleHit('spinner')
  ctx.scoringBridge.registerComboMultiplierHit()

  const vel = ballBody.linvel()
  const impactForce = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2)
  const visual = ctx.host.spinnerVisuals.find(v => v.body === obstacleBody)
  if (visual) {
    const ballPos = ballBody.translation()
    const pos = new Vector3(ballPos.x, ballPos.y, ballPos.z)
    ctx.host.spinnerBuilder?.triggerSpin(visual, impactForce, pos)
    ctx.scoringBridge.awardScore(GAME_TUNING.obstacle.spinnerHitBase, 'spinner-hit', pos)
    ctx.host.effects?.spawnEnhancedBumperImpact(pos, impactForce > 14 ? 'medium' : 'light')
    ctx.host.hapticManager?.bumper(impactForce)
    if (impactForce > 10) {
      const impactStrength = Math.min((impactForce - 10) / 16, 1)
      ctx.host.cameraController?.notifyImpact(pos, impactStrength)
    }
  }
}

export function handleBallTrapCollision(
  ctx: CollisionHandlerContext,
  obstacleBody: RAPIER.RigidBody,
  ballBody: RAPIER.RigidBody,
  ballHandle: number
): void {
  if (!ctx.ballHandleSet.has(ballHandle)) return

  const state = ctx.host.trapStates.find(s => s.body === obstacleBody)
  if (state && state.isOpen && !state.caughtBall) {
    ctx.scoringBridge.registerComboObstacleHit('trap')
    ctx.scoringBridge.registerComboMultiplierHit()
    const ballPos = ballBody.translation()
    const pos = new Vector3(ballPos.x, ballPos.y, ballPos.z)
    ctx.host.ballTrapBuilder?.catchBall(state, ballBody, pos)
    ctx.host.effects?.spawnImpactRing(pos, new Vector3(0, 1, 0), state.trapColor || PALETTE.MAGENTA)
    ctx.host.hapticManager?.bumper(8)
  }
}

export function handleLauncherCollision(
  ctx: CollisionHandlerContext,
  obstacleBody: RAPIER.RigidBody,
  ballBody: RAPIER.RigidBody,
  ballHandle: number
): void {
  if (!ctx.ballHandleSet.has(ballHandle)) return

  const state = ctx.host.launcherStates.find(s => s.body === obstacleBody)
  if (state && state.cooldownTimer <= 0) {
    ctx.scoringBridge.registerComboObstacleHit('launcher')
    ctx.scoringBridge.registerComboMultiplierHit()
    const forceVec = ctx.host.launcherBuilder?.triggerLauncher(state, 1.0)
    if (forceVec) {
      const rapier = ctx.host.physics.getRapier()
      if (rapier) {
        ballBody.applyImpulse(new rapier.Vector3(forceVec.x, forceVec.y, forceVec.z), true)
      }
    }
  }
}

export function handleGateCollision(
  ctx: CollisionHandlerContext,
  obstacleBody: RAPIER.RigidBody,
  ballHandle: number
): void {
  if (!ctx.ballHandleSet.has(ballHandle)) return

  const state = ctx.host.gateStates.find(s => s.body === obstacleBody)
  if (state && !state.isOpen) {
    ctx.scoringBridge.registerComboObstacleHit('gate')
    ctx.scoringBridge.registerComboMultiplierHit()
    ctx.host.movingGateBuilder?.openGate(state)
  }
}

export function getBallMeshForBody(host: PhysicsHost, body: RAPIER.RigidBody): Mesh | null {
  const gameObjectBinding = host.gameObjects?.getBindings().find(b => b.rigidBody === body)
  if (gameObjectBinding) {
    return gameObjectBinding.mesh as Mesh
  }
  const ballManagerBinding = host.ballManager?.getBindings().find(b => b.rigidBody === body)
  return ballManagerBinding?.mesh as Mesh || null
}

export function applySpinTransfer(
  host: PhysicsHost,
  ball: RAPIER.RigidBody,
  collisionNormal: Vector3,
  contactSpeed: number
): void {
  // Apply spin based on collision normal and ball velocity
  // Creates "English" effect where angled hits produce side spin
  const rapier = host.physics.getRapier()
  if (!rapier) return

  const spinFactor = PhysicsConfig.global.spinTransferFactor * Math.min(contactSpeed / 10, 1.0)
  const angvel = ball.angvel()

  // Apply spin perpendicular to collision normal and velocity direction
  const tangent = new Vector3(
    collisionNormal.z,
    0,
    -collisionNormal.x
  ).normalize()

  const spinAmount = spinFactor * PhysicsConfig.global.englishSpinAmount
  ball.setAngvel(
    new rapier.Vector3(
      angvel.x + tangent.x * spinAmount,
      angvel.y,
      angvel.z + tangent.z * spinAmount
    ),
    true
  )
}
