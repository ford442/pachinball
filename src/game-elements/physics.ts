import { Vector3 } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'

// Gravity: -Y (down), -Z (roll towards player)
export const GRAVITY = new Vector3(0, -9.81, -5.0)

export class PhysicsSystem {
  private rapier: typeof RAPIER | null = null
  private world: RAPIER.World | null = null
  private eventQueue: RAPIER.EventQueue | null = null

  async init(): Promise<void> {
    if (this.rapier) return
    this.rapier = await import('@dimforge/rapier3d-compat')
    await (this.rapier.init as unknown as () => Promise<void>)()
    this.world = new this.rapier.World(new this.rapier.Vector3(GRAVITY.x, GRAVITY.y, GRAVITY.z))
    this.eventQueue = new this.rapier.EventQueue(true)
  }

  getWorld(): RAPIER.World | null {
    return this.world
  }

  getRapier(): typeof RAPIER | null {
    return this.rapier
  }

  getEventQueue(): RAPIER.EventQueue | null {
    return this.eventQueue
  }

  step(callback: (handle1: number, handle2: number, started: boolean) => void): void {
    if (!this.world || !this.eventQueue) return
    this.world.step(this.eventQueue)
    this.eventQueue.drainCollisionEvents(callback)
  }

  dispose(): void {
    this.world?.free()
  }
}
