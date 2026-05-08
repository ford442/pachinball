import { Scene, MeshBuilder, Mesh, TransformNode } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { getMaterialLibrary } from '../materials'
import type { PhysicsBinding } from '../game-elements/types'
import { PALETTE } from '../game-elements/visual-language'

export interface DropTargetState {
  mesh: Mesh
  body: RAPIER.RigidBody
  isDropped: boolean
  dropTimer: number
  dropDuration: number
  resetTimer: number
  resetDuration: number
  targetIndex: number
  bankId: string
}

export interface DropTargetBank {
  bankId: string
  targets: DropTargetState[]
  isComplete: boolean
  color: string
  points: number
  bonusPoints: number
}

export class DropTargetBuilder {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private matLib: ReturnType<typeof getMaterialLibrary>

  constructor(
    scene: Scene,
    world: RAPIER.World,
    rapier: typeof RAPIER,
  ) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.matLib = getMaterialLibrary(scene)
  }

  /**
   * Create a single drop target
   */
  createDropTarget(
    x: number,
    z: number,
    targetIndex: number,
    bankId: string,
    colorHex: string = PALETTE.CYAN,
    scale: number = 1.0
  ): { state: DropTargetState; bindings: PhysicsBinding[] } {
    const bindings: PhysicsBinding[] = []

    const targetRoot = new TransformNode(`dropTarget_${bankId}_${targetIndex}`, this.scene)
    targetRoot.position.set(x, 0, z)

    // Main target body (tall cylinder)
    const targetMesh = MeshBuilder.CreateCylinder('targetCyl', {
      diameter: 0.4 * scale,
      height: 1.2 * scale,
      tessellation: 16
    }, this.scene) as Mesh

    targetMesh.parent = targetRoot
    targetMesh.material = this.matLib.getEnhancedBumperBodyMaterial(colorHex)

    // Target cap (visual indicator of status)
    const capMesh = MeshBuilder.CreateSphere('targetCap', {
      diameter: 0.5 * scale,
      segments: 16
    }, this.scene) as Mesh

    capMesh.position.y = 0.6 * scale
    capMesh.parent = targetRoot
    capMesh.material = this.matLib.getEnhancedBumperRingMaterial(colorHex)

    // Physics body - fixed target
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.6 * scale, z)
    )

    // Target collision - upper cylinder
    this.world.createCollider(
      this.rapier.ColliderDesc.cylinder(0.6 * scale, 0.2 * scale)
        .setRestitution(0.75)
        .setFriction(0.2)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      body
    )

    const state: DropTargetState = {
      mesh: targetMesh,
      body,
      isDropped: false,
      dropTimer: 0,
      dropDuration: 0.4, // Fast drop animation
      resetTimer: 0,
      resetDuration: 3.0, // Reset after 3 seconds
      targetIndex,
      bankId
    }

    bindings.push({ mesh: targetRoot as unknown as Mesh, rigidBody: body })

    return { state, bindings }
  }

  /**
   * Create a bank of drop targets
   */
  createDropTargetBank(
    centerX: number,
    centerZ: number,
    bankId: string,
    targetCount: number = 4,
    colorHex: string = PALETTE.CYAN,
    spacing: number = 0.6,
    scale: number = 1.0
  ): DropTargetBank {
    const targets: DropTargetState[] = []

    // Arrange targets in a line
    const startX = centerX - (targetCount - 1) * spacing / 2

    for (let i = 0; i < targetCount; i++) {
      const x = startX + i * spacing
      const { state } = this.createDropTarget(x, centerZ, i, bankId, colorHex, scale)
      targets.push(state)
    }

    return {
      bankId,
      targets,
      isComplete: false,
      color: colorHex,
      points: 500, // Per target
      bonusPoints: 5000 // For completing bank
    }
  }

  /**
   * Update drop target animation
   */
  updateDropTarget(state: DropTargetState, dt: number): void {
    if (state.isDropped) {
      // Animate target lowering
      state.dropTimer += dt
      const progress = Math.min(state.dropTimer / state.dropDuration, 1.0)

      // Lower the mesh
      if (state.mesh) {
        state.mesh.position.y = -progress * 0.8
      }

      // Handle reset timing
      if (state.dropTimer >= state.dropDuration) {
        state.resetTimer += dt

        if (state.resetTimer >= state.resetDuration) {
          this.resetDropTarget(state)
        }
      }
    }
  }

  /**
   * Hit a drop target
   */
  hitDropTarget(state: DropTargetState): void {
    if (!state.isDropped) {
      state.isDropped = true
      state.dropTimer = 0
      state.resetTimer = 0
    }
  }

  /**
   * Reset a drop target
   */
  resetDropTarget(state: DropTargetState): void {
    state.isDropped = false
    state.dropTimer = 0
    state.resetTimer = 0

    // Raise mesh back up
    if (state.mesh) {
      state.mesh.position.y = 0
    }
  }

  /**
   * Reset entire bank
   */
  resetBank(bank: DropTargetBank): void {
    for (const target of bank.targets) {
      this.resetDropTarget(target)
    }
    bank.isComplete = false
  }

  /**
   * Check if bank is complete and update state
   */
  updateBank(bank: DropTargetBank): boolean {
    const allDropped = bank.targets.every(t => t.isDropped)

    if (allDropped && !bank.isComplete) {
      bank.isComplete = true
      return true // Bank just completed
    }

    if (!allDropped && bank.isComplete) {
      bank.isComplete = false
    }

    return false
  }

  /**
   * Get completion percentage (0-1)
   */
  getBankProgress(bank: DropTargetBank): number {
    const droppedCount = bank.targets.filter(t => t.isDropped).length
    return droppedCount / bank.targets.length
  }
}
