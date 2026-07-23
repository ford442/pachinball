import {
  Mesh,
  MeshBuilder,
  Scene,
  Vector3,
  StandardMaterial,
  Color3,
  Scalar,
  PointLight,
  Quaternion,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import type { GameConfigType } from '../config'
import { color, emissive, FEEDER_STYLES, INTENSITY } from './visual-language'

export enum MagSpinState {
  IDLE,
  CATCH,
  SPIN,
  RELEASE,
  COOLDOWN,
}

const WELL_DIAMETER = 3.5
const WELL_RADIUS = WELL_DIAMETER / 2
const RING_COUNT = 3

export class MagSpinFeeder {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private config: GameConfigType['magSpin']

  private position: Vector3
  public _mesh: Mesh | null = null
  private ringMeshes: Mesh[] = []
  private ringMaterials: StandardMaterial[] = []
  private light: PointLight | null = null

  private state: MagSpinState = MagSpinState.IDLE
  private timer = 0

  private caughtBall: RAPIER.RigidBody | null = null
  private physicsBody: RAPIER.RigidBody | null = null
  private gameplayEnabled = true

  private ringAngularVelocity = 0
  private releaseShakeIntensity = 0
  private idlePulsePhase = 0
  private ballSpinAngle = 0

  public onStateChange: ((state: MagSpinState) => void) | null = null

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
    config: GameConfigType['magSpin']
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.config = config
    this.position = new Vector3(
      this.config.feederPosition.x,
      this.config.feederPosition.y,
      this.config.feederPosition.z
    )

    this.createMesh()
    this.createPhysics()
  }

  getPosition(): Vector3 {
    return this.position.clone()
  }

  getState(): MagSpinState {
    return this.state
  }

  getCatchRadius(): number {
    return this.config.catchRadius
  }

  private createMesh(): void {
    const well = MeshBuilder.CreateCylinder('magSpinWell', {
      diameter: WELL_DIAMETER,
      height: 1.0,
      tessellation: 32,
      cap: Mesh.NO_CAP,
    }, this.scene)
    well.position.copyFrom(this.position)

    const wellMat = new StandardMaterial('magSpinMat', this.scene)
    wellMat.diffuseColor = Color3.Black()
    wellMat.emissiveColor = emissive(FEEDER_STYLES.MAG_SPIN.base, INTENSITY.LOW)
    wellMat.backFaceCulling = false
    well.material = wellMat

    const floor = MeshBuilder.CreateCylinder('magSpinFloor', {
      diameter: WELL_DIAMETER,
      height: 0.1,
      tessellation: 32,
    }, this.scene)
    floor.position.copyFrom(this.position)
    floor.position.y -= 0.45
    floor.material = wellMat

    this._mesh = well

    const ringYOffsets = [0.35, 0.5, 0.65]
    const ringDiameters = [3.2, 3.5, 3.8]

    for (let i = 0; i < RING_COUNT; i++) {
      const ring = MeshBuilder.CreateTorus(`magSpinRing${i}`, {
        diameter: ringDiameters[i],
        thickness: 0.15,
        tessellation: 32,
      }, this.scene)
      ring.position.copyFrom(this.position)
      ring.position.y += ringYOffsets[i]

      const ringMat = new StandardMaterial(`magSpinRingMat${i}`, this.scene)
      ringMat.emissiveColor = color(FEEDER_STYLES.MAG_SPIN.active)
      ring.material = ringMat

      this.ringMeshes.push(ring)
      this.ringMaterials.push(ringMat)
    }

    this.light = new PointLight('magSpinLight', this.position.add(new Vector3(0, 2, 0)), this.scene)
    this.light.diffuse = color(FEEDER_STYLES.MAG_SPIN.active)
    this.light.intensity = 0.5
    this.light.range = 10
  }

  private createPhysics(): void {
    this.physicsBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
        .setTranslation(this.position.x, this.position.y, this.position.z)
    )

    this.world.createCollider(
      this.rapier.ColliderDesc.cylinder(0.1, WELL_RADIUS)
        .setTranslation(0, -0.4, 0),
      this.physicsBody
    )

    const wallCount = 8
    const radius = WELL_RADIUS + 0.2
    const wallHeight = 1.0
    const wallThickness = 0.4
    const wallWidth = (2 * Math.PI * radius) / wallCount

    for (let i = 0; i < wallCount; i++) {
      const angle = (i / wallCount) * Math.PI * 2
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const q = Quaternion.FromEulerAngles(0, -angle, 0)

      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(wallThickness / 2, wallHeight / 2, wallWidth / 2 + 0.1)
          .setTranslation(x, 0, z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
        this.physicsBody
      )
    }
  }

  update(dt: number, ballBodies: RAPIER.RigidBody[]): void {
    if (!this.gameplayEnabled) return
    this.timer -= dt
    this.updateVisuals(dt)
    this.updateStateMachine(dt, ballBodies)
  }

  setGameplayEnabled(enabled: boolean): void {
    this.gameplayEnabled = enabled
    if (this._mesh) this._mesh.setEnabled(enabled)
    if (this.physicsBody && this.world.getRigidBody(this.physicsBody.handle)) {
      this.physicsBody.setEnabled(enabled)
    }
    if (this.light) this.light.setEnabled(enabled)
  }

  private updateVisuals(dt: number): void {
    const anim = this.config.animation
    const targetSpeed = this.state === MagSpinState.SPIN ? anim.ringSpeedSpin
      : this.state === MagSpinState.IDLE ? anim.ringSpeedIdle
      : anim.ringSpeedDefault
    this.ringAngularVelocity = Scalar.Lerp(
      this.ringAngularVelocity,
      targetSpeed,
      dt * (this.state === MagSpinState.SPIN ? anim.ringLerpSpin : anim.ringLerpDefault)
    )

    const ringSpin = dt * this.ringAngularVelocity
    for (let i = 0; i < this.ringMeshes.length; i++) {
      const ring = this.ringMeshes[i]
      ring.rotation.y += ringSpin * (i % 2 === 0 ? 1 : -1)
    }

    if (this.releaseShakeIntensity > 0) {
      const shakeX = (Math.random() - 0.5) * this.releaseShakeIntensity
      const shakeZ = (Math.random() - 0.5) * this.releaseShakeIntensity
      for (const ring of this.ringMeshes) {
        ring.position.x = this.position.x + shakeX
        ring.position.z = this.position.z + shakeZ
      }
      this.releaseShakeIntensity *= this.config.animation.shakeDecay
    } else {
      const ringYOffsets = [0.35, 0.5, 0.65]
      for (let i = 0; i < this.ringMeshes.length; i++) {
        this.ringMeshes[i].position.copyFrom(this.position)
        this.ringMeshes[i].position.y += ringYOffsets[i]
      }
    }

    if (this.state === MagSpinState.IDLE) {
      this.idlePulsePhase += dt
      const pulse = 0.5 + 0.5 * Math.sin(this.idlePulsePhase * anim.idlePulseFrequency)
      if (this.light) {
        this.light.intensity = anim.idleLightBase + pulse * anim.idleLightPulseAmplitude
      }
      for (const mat of this.ringMaterials) {
        mat.emissiveColor = color(FEEDER_STYLES.MAG_SPIN.active).scale(anim.idleEmissiveBase + pulse * anim.idleEmissivePulseAmplitude)
      }
    }
  }

  private updateStateMachine(dt: number, ballBodies: RAPIER.RigidBody[]): void {
    switch (this.state) {
      case MagSpinState.IDLE:
        this.checkProximity(ballBodies)
        break

      case MagSpinState.CATCH:
        this.updateCatch(dt)
        break

      case MagSpinState.SPIN:
        this.updateSpin(dt)
        if (this.timer <= 0) {
          this.setState(MagSpinState.RELEASE)
        }
        break

      case MagSpinState.RELEASE:
        this.setState(MagSpinState.COOLDOWN)
        break

      case MagSpinState.COOLDOWN:
        if (this.timer <= 0) {
          this.setState(MagSpinState.IDLE)
        }
        break
    }
  }

  private updateCatch(dt: number): void {
    if (!this.caughtBall) return

    const currentPos = this.caughtBall.translation()
    const targetPos = this.position.add(new Vector3(0, this.config.holdYOffset, 0))
    const lerpFactor = dt * this.config.catchLerpSpeed

    const newX = Scalar.Lerp(currentPos.x, targetPos.x, lerpFactor)
    const newY = Scalar.Lerp(currentPos.y, targetPos.y, lerpFactor)
    const newZ = Scalar.Lerp(currentPos.z, targetPos.z, lerpFactor)

    this.caughtBall.setNextKinematicTranslation({ x: newX, y: newY, z: newZ })
    this.caughtBall.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.caughtBall.setAngvel({ x: 0, y: 0, z: 0 }, true)

    const dist = Vector3.Distance(
      new Vector3(newX, newY, newZ),
      targetPos
    )
    if (dist < this.config.catchArrivalDistance) {
      this.setState(MagSpinState.SPIN)
    }
  }

  private updateSpin(dt: number): void {
    if (!this.caughtBall) return

    const targetPos = this.position.add(new Vector3(0, this.config.holdYOffset, 0))
    this.caughtBall.setNextKinematicTranslation({
      x: targetPos.x,
      y: targetPos.y,
      z: targetPos.z,
    })

    this.ballSpinAngle += dt * this.config.spinAngularSpeed
    const extras = this.config.physicsExtras
    const spinQ = Quaternion.FromEulerAngles(
      this.ballSpinAngle,
      this.ballSpinAngle * extras.spinAxisMultiplierY,
      this.ballSpinAngle * extras.spinAxisMultiplierZ,
    )
    this.caughtBall.setNextKinematicRotation({ x: spinQ.x, y: spinQ.y, z: spinQ.z, w: spinQ.w })

    const chargeT = 1 - Math.max(0, this.timer) / this.config.spinDuration
    if (this.light) {
      this.light.intensity = this.config.animation.spinChargeLightBase + chargeT * this.config.animation.spinChargeLightScale
    }
  }

  private checkProximity(ballBodies: RAPIER.RigidBody[]): void {
    const pullRadius = this.config.catchRadius

    for (const body of ballBodies) {
      const pos = body.translation()
      const dist = Vector3.Distance(new Vector3(pos.x, pos.y, pos.z), this.position)

      if (dist < pullRadius && pos.y < this.config.maxCaptureHeightY) {
        this.captureBall(body)
        return
      }
    }
  }

  private captureBall(body: RAPIER.RigidBody): void {
    this.caughtBall = body
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    body.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true)
    this.ballSpinAngle = 0
    this.setState(MagSpinState.CATCH)
  }

  private setState(newState: MagSpinState): void {
    this.state = newState
    this.timer = 0
    this.onStateChange?.(newState)

    switch (newState) {
      case MagSpinState.IDLE:
        this.setRingColor(FEEDER_STYLES.MAG_SPIN.active)
        if (this.light) {
          this.light.diffuse = color(FEEDER_STYLES.MAG_SPIN.active)
          this.light.intensity = this.config.animation.stateLightIdle
        }
        break

      case MagSpinState.CATCH:
        this.setRingColor(FEEDER_STYLES.MAG_SPIN.locked)
        if (this.light) {
          this.light.diffuse = color(FEEDER_STYLES.MAG_SPIN.locked)
          this.light.intensity = this.config.animation.stateLightCatch
        }
        break

      case MagSpinState.SPIN:
        this.timer = this.config.spinDuration
        this.setRingColor(FEEDER_STYLES.MAG_SPIN.release)
        if (this.light) {
          this.light.diffuse = color(FEEDER_STYLES.MAG_SPIN.release)
          this.light.intensity = this.config.animation.stateLightSpin
        }
        break

      case MagSpinState.RELEASE:
        this.releaseBall()
        break

      case MagSpinState.COOLDOWN:
        this.timer = this.config.cooldown
        this.setRingColor('#666666')
        if (this.light) {
          this.light.intensity = this.config.animation.stateLightCooldown
        }
        break
    }
  }

  private setRingColor(hex: string): void {
    const c = color(hex)
    for (const mat of this.ringMaterials) {
      mat.emissiveColor = c
    }
  }

  private releaseBall(): void {
    if (!this.caughtBall) return

    const body = this.caughtBall
    this.caughtBall = null

    body.setBodyType(this.rapier.RigidBodyType.Dynamic, true)

    const currentPos = body.translation()
    const target = this.config.releaseTarget
    const targetDir = new Vector3(
      target.x - currentPos.x,
      0,
      target.z - currentPos.z
    ).normalize()

    const angleVariance = (Math.random() - 0.5) * 2 * this.config.releaseAngleVariance
    const cos = Math.cos(angleVariance)
    const sin = Math.sin(angleVariance)
    const finalDir = new Vector3(
      targetDir.x * cos - targetDir.z * sin,
      this.config.releaseUpwardBias,
      targetDir.x * sin + targetDir.z * cos
    ).normalize()

    const impulse = finalDir.scale(this.config.releaseForce)
    body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true)
    const extras = this.config.physicsExtras
    body.setAngvel({
      x: (Math.random() - 0.5) * extras.releaseSpinVarianceXZ,
      y: extras.releaseSpinBaseY,
      z: (Math.random() - 0.5) * extras.releaseSpinVarianceXZ,
    }, true)

    this.releaseShakeIntensity = this.config.animation.releaseShakeInitial
  }
}
