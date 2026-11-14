/**
 * Drop targets' gameplay state: which are up, and how long until a downed one respawns. Shared by
 * `GameObjects` (which also shows / hides and pulses the meshes) and the headless replay table
 * (#528), so a target hit scores and respawns on the same steps with or without a renderer.
 */

import type { PhysicsBody } from '../core/physics-api'

export class TargetBank {
  readonly bodies: PhysicsBody[] = []
  readonly active: boolean[] = []
  readonly respawnTimer: number[] = []

  constructor(private readonly respawnTime: () => number) {}

  add(body: PhysicsBody): void {
    this.bodies.push(body)
    this.active.push(true)
    this.respawnTimer.push(0)
  }

  clear(): void {
    this.bodies.length = 0
    this.active.length = 0
    this.respawnTimer.length = 0
  }

  /**
   * Advance the respawn timers by `dt`. `respawned(i)` runs for each target that comes back up this
   * step; `standing(i)` for each that was already up (the rendered table pulses it).
   */
  update(dt: number, respawned?: (i: number) => void, standing?: (i: number) => void): void {
    for (let i = 0; i < this.active.length; i++) {
      if (!this.active[i]) {
        const left = (this.respawnTimer[i] ?? 0) - dt
        this.respawnTimer[i] = left
        if (left <= 0) {
          this.active[i] = true
          respawned?.(i)
        }
      } else {
        standing?.(i)
      }
    }
  }

  /** Knock `body`'s target down. The index it had, or -1 when it is not a standing target. */
  deactivate(body: PhysicsBody): number {
    const idx = this.bodies.indexOf(body)
    if (idx !== -1 && this.active[idx]) {
      this.active[idx] = false
      this.respawnTimer[idx] = this.respawnTime()
      return idx
    }
    return -1
  }

  reset(): void {
    this.active.fill(true)
    this.respawnTimer.fill(0)
  }
}
