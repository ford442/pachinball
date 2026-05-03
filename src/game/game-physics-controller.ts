/**
 * Game Physics Controller — Physics stepping, collision processing, nudge/tilt, ball loss.
 */

import { Vector3, Quaternion } from '@babylonjs/core'
import type { Mesh } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'

import type { PhysicsSystem } from '../game-elements/physics'
import type { BallManager } from '../game-elements/ball-manager'
import type { BallAnimator } from '../game-elements/ball-animator'
import type { GameObjects } from '../objects'
import type { EffectsSystem } from '../effects'
import type { DisplaySystem } from '../display'
import type { SoundSystem } from '../game-elements/sound-system'
import type { HapticManager } from '../game-elements/haptics'
import type { GameStateManager } from './game-state'
import type { EventBus } from './event-bus'
import type { AdventureState } from '../game-elements/adventure-state'
import type { AdventureManager } from './game-adventure'
import type { ZoneTriggerSystem } from '../game-elements/zone-trigger-system'
import type { CameraController } from '../game-elements/camera-controller'
import type { MagSpinFeeder } from '../game-elements/mag-spin-feeder'
import type { NanoLoomFeeder } from '../game-elements/nano-loom-feeder'
import type { PrismCoreFeeder } from '../game-elements/prism-core-feeder'
import type { GaussCannonFeeder } from '../game-elements/gauss-cannon-feeder'
import type { QuantumTunnelFeeder } from '../game-elements/quantum-tunnel-feeder'
import type { InputFrame } from '../game-elements'
import { BallType, GAME_TUNING, GameConfig } from '../config'
import { DisplayState } from '../game-elements'
import { TABLE_MAPS } from '../shaders/lcd-table'
import { PALETTE, CameraMode } from '../game-elements'

export interface PhysicsHost {
  readonly engine: import('@babylonjs/core').Engine | import('@babylonjs/core').WebGPUEngine
  readonly physics: PhysicsSystem
  readonly stateManager: GameStateManager
  readonly eventBus: EventBus
  readonly ballManager: BallManager | null
  readonly gameObjects: GameObjects | null
  readonly effects: EffectsSystem | null
  readonly display: DisplaySystem | null
  readonly ballAnimator: BallAnimator | null
  readonly hapticManager: HapticManager | null
  readonly soundSystem: SoundSystem
  readonly mapManager: import('./game-maps').TableMapManager | null
  readonly uiManager: import('./game-ui').GameUIManager | null
  readonly adventureState: AdventureState
  adventureManager: AdventureManager | null
  readonly zoneTriggerSystem: ZoneTriggerSystem | null
  readonly cameraController: CameraController | null
  readonly dynamicWorld: import('../game-elements/dynamic-world').DynamicWorld | null
  readonly magSpinFeeder: MagSpinFeeder | null
  readonly nanoLoomFeeder: NanoLoomFeeder | null
  readonly prismCoreFeeder: PrismCoreFeeder | null
  readonly gaussCannon: GaussCannonFeeder | null
  readonly quantumTunnel: QuantumTunnelFeeder | null
  readonly tableCam: import('@babylonjs/core').ArcRotateCamera | null
  readonly accessibility: import('../game-elements').AccessibilityConfig

  score: number
  comboCount: number
  comboTimer: number
  lives: number
  tiltActive: boolean
  goldBallStack: Array<{ type: BallType; timestamp: number }>
  sessionGoldBalls: number
  powerupActive: boolean
  powerupTimer: number
  plungerChargeLevel: number
  nudgeState: { tiltWarnings: number; lastNudgeTime: number; tiltActive: boolean; tiltWarningActive: boolean }
  isCameraFollowMode: boolean
  cameraFollowTransition: number
  readonly cameraFollowTransitionSpeed: number

  updateHUD(): void
  resetBall(): void
  triggerJackpot(): void
  tryActivateSlotMachine(): void
  rebuildHandleCaches(): void
  updateGoldBallDisplay(): void
  showMessage(msg: string, duration: number): void
  setGameState(state: import('../game-elements').GameState): void
  endAdventureMode(): void
  getBallPosition(): Vector3 | null
}

export class GamePhysicsController {
  private readonly host: PhysicsHost
  private lastCollisionTime: Map<string, number> = new Map()
  private bumperHandleSet: Set<number> = new Set()
  private targetHandleSet: Set<number> = new Set()
  private ballHandleSet: Set<number> = new Set()
  private deathZoneHandle: number = -1
  private adventureSensorHandle: number = -1
  private static readonly COLLISION_DEBOUNCE_MS = 16

  constructor(host: PhysicsHost) {
    this.host = host
  }

  rebuildHandleCaches(): void {
    this.bumperHandleSet.clear()
    this.targetHandleSet.clear()
    this.ballHandleSet.clear()

    for (const b of (this.host.gameObjects?.getBumperBodies() || [])) {
      this.bumperHandleSet.add(b.handle)
    }
    for (const b of (this.host.gameObjects?.getTargetBodies() || [])) {
      this.targetHandleSet.add(b.handle)
    }
    for (const b of (this.host.ballManager?.getBallBodies() || [])) {
      this.ballHandleSet.add(b.handle)
    }

    const dz = this.host.gameObjects?.getDeathZoneBody()
    this.deathZoneHandle = dz ? dz.handle : -1

    this.adventureSensorHandle = -1
  }

  applyInputFrame(frame: InputFrame): void {
    if (frame.flipperLeft !== null) {
      // Delegated to input actions
    }
    if (frame.flipperRight !== null) {
      // Delegated to input actions
    }
    if (frame.plunger) {
      // Delegated to input actions
    }
    if (frame.nudge) {
      const rapier = this.host.physics.getRapier()
      if (rapier) {
        this.applyNudge(new rapier.Vector3(frame.nudge.x, frame.nudge.y, frame.nudge.z))
      }
    }
  }

  stepPhysics(
    inputManager: { update: () => void; processBufferedInputs: () => InputFrame | null } | null,
    inputActions: { handleFlipperLeft: (p: boolean) => void; handleFlipperRight: (p: boolean) => void; handlePlunger: () => void } | null
  ): void {
    inputManager?.update()
    const inputFrame = inputManager?.processBufferedInputs()
    if (inputFrame) {
      if (inputFrame.flipperLeft !== null) inputActions?.handleFlipperLeft(inputFrame.flipperLeft)
      if (inputFrame.flipperRight !== null) inputActions?.handleFlipperRight(inputFrame.flipperRight)
      if (inputFrame.plunger) inputActions?.handlePlunger()
      this.applyInputFrame(inputFrame)
    }

    if (!this.host.stateManager.isPlaying()) return

    const rawDt = this.host.engine.getDeltaTime() / 1000

    this.host.physics.step(rawDt, (h1, h2, start) => {
      if (!start) return
      const pairKey = h1 < h2 ? `${h1}_${h2}` : `${h2}_${h1}`
      const now = performance.now()
      const lastTime = this.lastCollisionTime.get(pairKey) || 0
      if (now - lastTime < GamePhysicsController.COLLISION_DEBOUNCE_MS) return
      this.lastCollisionTime.set(pairKey, now)

      const world = this.host.physics.getWorld()
      if (world) {
        const b1 = world.getRigidBody(h1)
        const b2 = world.getRigidBody(h2)
        if (b1?.isFixed() && b2?.isFixed()) return
      }

      this.processCollision(h1, h2)
    })

    const dt = Math.min(rawDt, 1 / 30)

    // Mesh sync
    const bindings = this.host.gameObjects?.getBindings() || []
    for (const binding of bindings) {
      const body = binding.rigidBody
      const mesh = binding.mesh
      if (!body || !mesh) continue
      if (body.isFixed()) continue
      if (body.isSleeping()) continue

      const pos = body.translation()
      const rot = body.rotation()
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) continue
      if (Math.abs(pos.x) > 100 || Math.abs(pos.y) > 100 || Math.abs(pos.z) > 100) continue

      mesh.position.set(pos.x, pos.y, pos.z)
      if (!mesh.rotationQuaternion) {
        mesh.rotationQuaternion = new Quaternion(rot.x, rot.y, rot.z, rot.w)
      } else {
        mesh.rotationQuaternion.set(rot.x, rot.y, rot.z, rot.w)
      }
    }

    // Camera controller
    if (!GameConfig.camera.reducedMotion && this.host.cameraController && this.host.ballManager?.getBallBody()) {
      const ballBody = this.host.ballManager.getBallBody()!
      const pos = ballBody.translation()
      const vel = ballBody.linvel()
      const cameraMode = this.host.isCameraFollowMode ? CameraMode.BALL_FOLLOW : CameraMode.IDLE
      this.host.cameraController.update(dt, new Vector3(pos.x, pos.y, pos.z), new Vector3(vel.x, vel.y, vel.z), cameraMode)
      if (this.host.isCameraFollowMode && this.host.tableCam) {
        const targetY = pos.y + 2.5
        this.host.tableCam.target.y += (targetY - this.host.tableCam.target.y) * dt * 5
      }
    }

    // Dynamic world
    if (this.host.dynamicWorld && this.host.ballManager?.getBallBody()) {
      const ballBody = this.host.ballManager.getBallBody()!
      const pos = ballBody.translation()
      this.host.dynamicWorld.update(new Vector3(pos.x, pos.y, pos.z), dt)
    }

    // Debug HUD
    // (delegated to caller)

    // Adventure mode update
    const currentBallBodies = this.host.ballManager?.getBallBodies() || []
    this.host.adventureMode?.update(dt, currentBallBodies)
    this.host.zoneTriggerSystem?.update(currentBallBodies)

    this.host.gameObjects?.updateBumpers(dt)
    this.host.gameObjects?.updateTargets(dt)

    if (this.host.magSpinFeeder) {
      this.host.magSpinFeeder.update(dt, currentBallBodies)
    }
    if (this.host.nanoLoomFeeder) {
      this.host.nanoLoomFeeder.update(dt, currentBallBodies)
    }
    if (this.host.prismCoreFeeder) {
      this.host.prismCoreFeeder.update(dt, currentBallBodies)
    }
    if (this.host.gaussCannon) {
      this.host.gaussCannon.update(dt, currentBallBodies)
    }
    if (this.host.quantumTunnel) {
      this.host.quantumTunnel.update(dt, currentBallBodies)
    }

    this.host.ballManager?.updateCaughtBalls(dt, () => {
      this.host.effects?.playBeep(440)
    })

    this.host.effects?.updateShards(dt)
    this.host.effects?.updateBloom()
    this.host.effects?.updateCabinetLighting()
    this.host.effects?.updateSlotLighting()
    this.host.mapManager?.update(dt)
    this.host.zoneTriggerSystem?.update(currentBallBodies)
    this.host.adventureState.updateGoal('survive-time', dt)

    {
      const ballBody = this.host.ballManager?.getBallBody()
      const ballPos = ballBody ? (() => {
        const t = ballBody.translation()
        return new Vector3(t.x, t.y, t.z)
      })() : undefined
      this.host.effects?.updateAtmosphere(dt, ballPos)
    }

    this.host.ballManager?.updateTrailEffects()
    this.host.ballManager?.updateGoldBallGlow(dt)

    const ballBodies = this.host.ballManager?.getBallBodies() || []
    const isFever = this.host.effects?.currentLightingMode === 'fever'
    this.host.effects?.update(dt, ballBodies, isFever)

    const trailInfos = ballBodies
      .map((body) => {
        const binding = this.host.ballManager?.getBindings().find((b) => b.rigidBody === body)
        const mesh = binding?.mesh as Mesh | undefined
        const type = this.host.ballManager?.getBallType(body) || BallType.STANDARD
        return mesh ? { body, mesh, type } : null
      })
      .filter((info): info is NonNullable<typeof info> => info !== null)
    this.host.effects?.updateTrails(trailInfos)

    const stuckBalls = this.host.ballManager?.updateStuckDetection(dt) || []
    for (const stuckBall of stuckBalls) {
      if (stuckBall === this.host.ballManager?.getBallBody()) {
        this.host.ballManager?.resetBall()
      } else {
        this.host.ballManager?.removeBall(stuckBall)
      }
    }
    if (stuckBalls.length > 0) {
      this.rebuildHandleCaches()
    }

    const jackpotPhase = this.host.effects?.jackpotPhase || 0
    this.host.display?.update(dt, jackpotPhase)

    if (this.host.effects && !this.host.effects.isJackpotActive && this.host.display?.getDisplayState() === DisplayState.JACKPOT) {
      this.host.eventBus.emit('jackpot:end')
      this.host.eventBus.emit('display:set', DisplayState.IDLE)
      this.host.effects.setAtmosphereState('IDLE')
    }

    this.updateCombo(dt)
    this.updateTiltDecay(dt)

    if (this.host.powerupActive) {
      this.host.powerupTimer -= dt
      if (this.host.powerupTimer <= 0) this.host.powerupActive = false
    }
  }

  private processCollision(h1: number, h2: number): void {
    const world = this.host.physics.getWorld()
    if (!world) return
    if (h1 === 0 || h2 === 0 || h1 === h2) return

    const b1 = world.getRigidBody(h1)
    const b2 = world.getRigidBody(h2)
    if (!b1 || !b2) return

    if (this.adventureSensorHandle >= 0 && (h1 === this.adventureSensorHandle || h2 === this.adventureSensorHandle)) {
      this.host.endAdventureMode()
      return
    }

    if (this.deathZoneHandle >= 0 && (h1 === this.deathZoneHandle || h2 === this.deathZoneHandle)) {
      const ball = h1 === this.deathZoneHandle ? b2 : b1
      this.handleBallLoss(ball)
      return
    }

    const h1IsBumper = this.bumperHandleSet.has(h1)
    const h2IsBumper = this.bumperHandleSet.has(h2)
    if (h1IsBumper || h2IsBumper) {
      const bump = h1IsBumper ? b1 : b2
      const ballBody = h1IsBumper ? b2 : b1
      const ballHandle = h1IsBumper ? h2 : h1

      if (this.ballHandleSet.has(ballHandle)) {
        const ballPos = ballBody.translation()
        const bumperVisuals = this.host.gameObjects?.getBumperVisuals() || []
        const vis = bumperVisuals.find(v => v.body === bump)

        if (vis) {
          const ballMesh = this.getBallMeshForBody(ballBody)
          if (ballMesh && this.host.ballAnimator) {
            const velocity = ballBody.linvel()
            const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)
            const impactIntensity = Math.min(speed / 20, 1.0)
            const bumperPos = vis.mesh.position
            const impactNormal = new Vector3(
              ballPos.x - bumperPos.x,
              ballPos.y - bumperPos.y,
              ballPos.z - bumperPos.z
            ).normalize()
            this.host.ballAnimator.animateBallImpact(ballMesh, impactNormal, impactIntensity)
          }

          if (ballPos.y > 1.5) {
            if (this.host.display?.getDisplayState() === DisplayState.IDLE) {
              this.activateHologramCatch(ballBody, bump)
              return
            }
          } else {
            this.host.gameObjects?.activateBumperHit(bump)
            this.host.effects?.addCameraShake(0.3)
            const bumperPoints = GAME_TUNING.scoring.bumperHitBase * (Math.floor(this.host.comboCount / GAME_TUNING.combo.multiplierDivisor) + 1)
            this.host.score += bumperPoints
            this.host.comboCount++
            this.host.comboTimer = GAME_TUNING.combo.expirySeconds

            if (this.host.comboCount >= GAME_TUNING.combo.feverThreshold && this.host.display?.getDisplayState() === DisplayState.IDLE) {
              this.host.eventBus.emit('fever:start')
              this.host.eventBus.emit('display:set', DisplayState.FEVER)
              this.host.effects?.setLightingMode('fever', 0)
            }

            this.host.effects?.spawnEnhancedBumperImpact(vis.mesh.position, 'medium')
            this.host.effects?.spawnBumperSpark(vis.mesh.position, vis.color || PALETTE.CYAN)
            this.host.effects?.spawnImpactRing(vis.mesh.position, new Vector3(0, 1, 0), PALETTE.CYAN)
            this.host.effects?.triggerImpactFlash(vis.mesh.position, 1.0, vis.color || '#44aaff')
            this.host.effects?.spawnFloatingNumber(bumperPoints, new Vector3(ballPos.x, ballPos.y, ballPos.z))
            this.host.effects?.playBeep(400 + Math.random() * 200)
            this.host.updateHUD()
            this.host.effects?.setLightingMode('hit', 0.2)
            this.host.adventureState.updateGoal('hit-pegs', 1)

            const velocity = ballBody.linvel()
            const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)
            this.host.hapticManager?.bumper(speed)

            if (speed > 12) {
              const mapColor = TABLE_MAPS[this.host.mapManager?.getCurrentMap() || 'neon-helix']?.baseColor || '#00d9ff'
              this.host.effects?.triggerCabinetShake('heavy', mapColor)
            }

            this.host.soundSystem.playSample('bumper', vis.mesh.position)
            return
          }
        }
      }
    }

    const h1IsTarget = this.targetHandleSet.has(h1)
    const h2IsTarget = this.targetHandleSet.has(h2)
    if (h1IsTarget || h2IsTarget) {
      const tgt = h1IsTarget ? b1 : b2
      const ballBody = h1IsTarget ? b2 : b1
      const ballHandle = h1IsTarget ? h2 : h1

      if (this.ballHandleSet.has(ballHandle)) {
        const ballMesh = this.getBallMeshForBody(ballBody)
        if (ballMesh && this.host.ballAnimator) {
          const velocity = ballBody.linvel()
          const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)
          const impactIntensity = Math.min(speed / 20, 1.0)
          this.host.ballAnimator.animateSimpleImpact(ballMesh, impactIntensity)
        }
      }

      if (this.host.gameObjects?.deactivateTarget(tgt)) {
        this.host.score += GAME_TUNING.scoring.targetHitBase
        this.host.effects?.spawnFloatingNumber(GAME_TUNING.scoring.targetHitBase, new Vector3(ballBody.translation().x, ballBody.translation().y, ballBody.translation().z))
        this.host.effects?.playBeep(1200)
        this.host.ballManager?.spawnExtraBalls(1)
        this.host.updateHUD()
        this.host.eventBus.emit('reach:start')
        this.host.eventBus.emit('display:set', DisplayState.REACH)
        this.host.effects?.setLightingMode('reach', 3.0)
        this.host.effects?.setAtmosphereState('REACH')
        this.rebuildHandleCaches()
        this.host.tryActivateSlotMachine()
      }
    }
  }

  getBallMeshForBody(body: RAPIER.RigidBody): Mesh | null {
    const gameObjectBinding = this.host.gameObjects?.getBindings().find(b => b.rigidBody === body)
    if (gameObjectBinding) {
      return gameObjectBinding.mesh as Mesh
    }
    const ballManagerBinding = this.host.ballManager?.getBindings().find(b => b.rigidBody === body)
    return ballManagerBinding?.mesh as Mesh || null
  }

  getBallPosition(): Vector3 | null {
    const body = this.host.ballManager?.getBallBody()
    if (!body) return null
    const t = body.translation()
    return new Vector3(t.x, t.y, t.z)
  }

  private activateHologramCatch(ball: RAPIER.RigidBody, bumper: RAPIER.RigidBody): void {
    const bumperVisuals = this.host.gameObjects?.getBumperVisuals() || []
    const visual = bumperVisuals.find(v => v.body === bumper)
    if (!visual || !visual.hologram) return
    this.host.ballManager?.activateHologramCatch(ball, visual.hologram.position, 4.0)
    this.host.effects?.playBeep(880)
    this.host.eventBus.emit('reach:start')
    this.host.eventBus.emit('display:set', DisplayState.REACH)
    this.host.effects?.setLightingMode('reach', 4.0)
  }

  handleBallLoss(body: RAPIER.RigidBody): void {
    if (!this.host.stateManager.isPlaying()) return

    this.host.comboCount = 0
    if (this.host.display?.getDisplayState() === DisplayState.FEVER) {
      this.host.eventBus.emit('fever:end')
      this.host.eventBus.emit('display:set', DisplayState.IDLE)
      this.host.effects?.setLightingMode('normal', 0)
    }

    const collected = this.host.ballManager?.collectBall(body)
    if (collected && collected.type !== BallType.STANDARD) {
      this.host.soundSystem.playGoldBallCollect(collected.type)
      // Ball stack visual updated by caller
      this.host.goldBallStack.push({ type: collected.type, timestamp: performance.now() })
      this.host.sessionGoldBalls++
      this.host.score += collected.points
      const collectPos = new Vector3(body.translation().x, body.translation().y, body.translation().z)
      this.host.effects?.spawnFloatingNumber(collected.points, collectPos)
      this.host.showMessage(`+${collected.points}`, 1500)

      if (collected.type === BallType.SOLID_GOLD) {
        this.host.effects?.startSolidGoldPulse()
        this.host.eventBus.emit('jackpot:start')
        this.host.eventBus.emit('display:set', DisplayState.JACKPOT)
        this.host.hapticManager?.jackpot()
      } else {
        this.host.effects?.setBloomEnergy(1.5)
      }
      this.host.updateGoldBallDisplay()
    }

    this.host.ballManager?.removeBall(body)
    this.host.hapticManager?.ballLost()
    this.host.soundSystem.playSample('drain')

    const ballBody = this.host.ballManager?.getBallBody()
    if (body === ballBody) {
      const ballBodies = this.host.ballManager?.getBallBodies() || []
      if (ballBodies.length > 0) {
        this.host.ballManager?.setBallBody(ballBodies[0])
      } else {
        this.host.lives--
        if (this.host.lives > 0) {
          this.host.resetBall()
        } else {
          this.host.setGameState(3) // GameState.GAME_OVER
        }
      }
    }
    this.host.updateHUD()
  }

  applyNudge(direction: { x: number; y: number; z: number }): void {
    if (this.host.nudgeState.tiltActive) {
      this.host.hapticManager?.tiltWarning()
      return
    }
    const rapier = this.host.physics.getRapier()
    const ballBody = this.host.ballManager?.getBallBody()
    if (!ballBody || !rapier) return

    const now = performance.now()
    if (now - this.host.nudgeState.lastNudgeTime < GAME_TUNING.timing.nudgeCooldownMs) {
      this.host.nudgeState.tiltWarnings++
      if (this.host.nudgeState.tiltWarnings >= GameConfig.nudge.maxTiltWarnings) {
        this.triggerTilt()
        return
      }
    }
    this.host.nudgeState.lastNudgeTime = now

    const impulse = new rapier.Vector3(
      direction.x * GameConfig.nudge.force,
      GameConfig.nudge.verticalBoost,
      direction.z * GameConfig.nudge.force
    )
    ballBody.applyImpulse(impulse, true)

    const nudgeDirection = direction.x > 0 ? 'right' : direction.x < 0 ? 'left' : 'up'
    this.host.hapticManager?.nudge(nudgeDirection)

    if (!this.host.accessibility.reducedMotion) {
      this.host.effects?.addCameraShake(0.03)
    }
  }

  triggerTilt(): void {
    this.host.nudgeState.tiltActive = true
    this.host.nudgeState.tiltWarningActive = false
    this.host.tiltActive = true
    this.host.effects?.setBloomEnergy(3.0)
    setTimeout(() => this.host.effects?.setBloomEnergy(1.0), GAME_TUNING.timing.tiltBloomResetMs)
    this.host.effects?.playBeep(150)
    this.host.hapticManager?.tiltWarning()
    setTimeout(() => {
      this.host.nudgeState.tiltActive = false
      this.host.nudgeState.tiltWarnings = 0
      this.host.tiltActive = false
    }, GameConfig.nudge.tiltPenaltyTime)
  }

  private updateTiltDecay(dt: number): void {
    const now = performance.now()
    if (now - this.host.nudgeState.lastNudgeTime > GameConfig.nudge.tiltDecayTime && this.host.nudgeState.tiltWarnings > 0) {
      this.host.nudgeState.tiltWarnings = Math.max(0, this.host.nudgeState.tiltWarnings - dt)
    }
  }

  private updateCombo(dt: number): void {
    if (this.host.comboTimer > 0) {
      this.host.comboTimer -= dt
      if (this.host.comboTimer <= 0) {
        this.host.comboCount = 0
        this.host.updateHUD()
        if (this.host.display?.getDisplayState() === DisplayState.FEVER) {
          this.host.eventBus.emit('fever:end')
          this.host.eventBus.emit('display:set', DisplayState.IDLE)
          this.host.effects?.setLightingMode('normal', 0)
        }
      }
    }
  }
}


