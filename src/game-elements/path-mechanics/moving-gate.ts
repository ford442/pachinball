import { MeshBuilder, Vector3, Mesh, PointLight, Color3, Scalar } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { getMaterialLibrary } from '../../materials'
import type { MovingGateConfig } from './types'
import { PathMechanic } from './base'

export enum GateState {
  OPENING,
  OPEN,
  CLOSING,
  CLOSED,
}

export class MovingGate extends PathMechanic {
  private gateMesh: Mesh | null = null
  private gateFrameLeft: Mesh | null = null
  private gateFrameRight: Mesh | null = null
  private physicsBody: RAPIER.RigidBody | null = null
  private position = Vector3.Zero()
  private state = GateState.CLOSED
  private timer = 0
  private openHeight = 4
  private closedHeight = 0.5
  private cycleDuration = 3
  private currentHeight = 0.5
  private gateWidth = 6
  private gateLight: PointLight | null = null

  spawn(config: MovingGateConfig): void {
    if (this.isSpawned) return

    this.position = config.position.clone()
    this.gateWidth = config.gateWidth
    this.openHeight = config.openHeight
    this.closedHeight = config.closedHeight
    this.cycleDuration = config.cycleDuration
    this.currentHeight = config.startOpen ? this.openHeight : this.closedHeight
    this.state = config.startOpen ? GateState.OPEN : GateState.CLOSED

    this.setMapColors(config.mapBaseColor, config.mapAccentColor)
    this.createVisuals()
    this.createPhysics()

    this.isSpawned = true
    console.log(`[MovingGate] Spawned at ${this.position}`)
  }

  despawn(): void {
    if (!this.isSpawned) return

    this.gateMesh?.dispose()
    this.gateFrameLeft?.dispose()
    this.gateFrameRight?.dispose()
    this.gateLight?.dispose()
    if (this.physicsBody) {
      this.world.removeRigidBody(this.physicsBody)
    }

    this.gateMesh = null
    this.gateFrameLeft = null
    this.gateFrameRight = null
    this.physicsBody = null
    this.gateLight = null
    this.isSpawned = false
  }

  private createVisuals(): void {
    const matLib = getMaterialLibrary(this.scene)
    const frameMat = matLib.getChromeMaterial()

    // Gate frame posts
    this.gateFrameLeft = MeshBuilder.CreateBox('gateFrameL', {
      width: 0.8, height: 5, depth: 0.8
    }, this.scene)
    this.gateFrameLeft.position = this.position.add(new Vector3(-this.gateWidth / 2 - 0.4, 2.5, 0))
    this.gateFrameLeft.material = frameMat
    this.gateFrameLeft.parent = this.rootNode

    this.gateFrameRight = MeshBuilder.CreateBox('gateFrameR', {
      width: 0.8, height: 5, depth: 0.8
    }, this.scene)
    this.gateFrameRight.position = this.position.add(new Vector3(this.gateWidth / 2 + 0.4, 2.5, 0))
    this.gateFrameRight.material = frameMat
    this.gateFrameRight.parent = this.rootNode

    // The moving gate bar
    this.gateMesh = MeshBuilder.CreateBox('gateBar', {
      width: this.gateWidth, height: 0.4, depth: 0.6
    }, this.scene)
    this.gateMesh.position = this.position.add(new Vector3(0, this.currentHeight, 0))
    this.gateMesh.material = this.neonMaterial
    this.gateMesh.parent = this.rootNode

    // Gate status light
    this.gateLight = new PointLight('gateLight', this.position.add(new Vector3(0, 4, 0)), this.scene)
    this.gateLight.intensity = 0.8
    this.gateLight.range = 8
    this.updateLightColor()
  }

  private createPhysics(): void {
    // Kinematic body for moving gate
    this.physicsBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(this.position.x, this.position.y + this.currentHeight, this.position.z)
    )

    // Gate collider
    this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(this.gateWidth / 2, 0.2, 0.3),
      this.physicsBody
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(dt: number, _ballBodies: RAPIER.RigidBody[]): void {
    if (!this.isSpawned || !this.physicsBody) return

    this.timer += dt

    // State machine for gate cycle
    switch (this.state) {
      case GateState.CLOSED:
        if (this.timer > this.cycleDuration) {
          this.state = GateState.OPENING
          this.timer = 0
        }
        break

      case GateState.OPENING:
        this.currentHeight = Scalar.Lerp(this.currentHeight, this.openHeight, dt * 2)
        if (Math.abs(this.currentHeight - this.openHeight) < 0.1) {
          this.currentHeight = this.openHeight
          this.state = GateState.OPEN
          this.timer = 0
        }
        this.updateGatePosition()
        break

      case GateState.OPEN:
        if (this.timer > this.cycleDuration * 0.5) {
          this.state = GateState.CLOSING
          this.timer = 0
        }
        break

      case GateState.CLOSING:
        this.currentHeight = Scalar.Lerp(this.currentHeight, this.closedHeight, dt * 3)
        if (Math.abs(this.currentHeight - this.closedHeight) < 0.1) {
          this.currentHeight = this.closedHeight
          this.state = GateState.CLOSED
          this.timer = 0
        }
        this.updateGatePosition()
        break
    }
  }

  private updateGatePosition(): void {
    if (!this.physicsBody || !this.gateMesh) return

    const newPos = { x: this.position.x, y: this.position.y + this.currentHeight, z: this.position.z }
    this.physicsBody.setNextKinematicTranslation(newPos)
    this.gateMesh.position.y = this.position.y + this.currentHeight
  }

  private updateLightColor(): void {
    if (!this.gateLight) return
    const isOpen = this.state === GateState.OPEN || this.state === GateState.OPENING
    this.gateLight.diffuse = isOpen ? Color3.Green() : Color3.FromHexString(this.mapAccentColor)
  }

  protected updateVisualColors(): void {
    if (this.gateMesh) {
      this.gateMesh.material = this.neonMaterial
    }
    this.updateLightColor()
  }
}
