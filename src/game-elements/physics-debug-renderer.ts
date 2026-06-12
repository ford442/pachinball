/**
 * Physics Debug Renderer — draws Rapier's collider/joint wireframes via a
 * Babylon LinesMesh. Toggled from the Developer settings panel.
 * WebGL2 is the recommended renderer for this view (see renderer-selector.ts).
 */

import { LinesMesh, VertexData, type Scene } from '@babylonjs/core'
import type { PhysicsSystem } from './physics'

export class PhysicsDebugRenderer {
  private readonly scene: Scene
  private readonly physics: PhysicsSystem
  private linesMesh: LinesMesh | null = null
  private indices: Uint32Array | null = null
  private enabled = false
  private lastUpdateMs = 0

  /** Refresh rate cap — collider shapes rarely need 60Hz to be useful as a debug overlay. */
  private static readonly UPDATE_INTERVAL_MS = 250

  constructor(scene: Scene, physics: PhysicsSystem) {
    this.scene = scene
    this.physics = physics
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.linesMesh?.dispose()
      this.linesMesh = null
      this.indices = null
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Call once per frame (after the physics step) while enabled.
   * Rebuilds the mesh geometry directly from Rapier's flat vertex/color
   * buffers — avoids allocating a Vector3/Color4 per line endpoint, which
   * for a busy pachinko table (tens of thousands of segments) is fast
   * enough to do every frame but not via CreateLineSystem's array API.
   */
  update(): void {
    if (!this.enabled) return

    const now = performance.now()
    if (now - this.lastUpdateMs < PhysicsDebugRenderer.UPDATE_INTERVAL_MS) return
    this.lastUpdateMs = now

    const world = this.physics.getWorld()
    if (!world) return

    const { vertices, colors } = world.debugRender()
    const vertexCount = vertices.length / 3
    if (vertexCount === 0) return

    if (!this.linesMesh) {
      this.linesMesh = new LinesMesh('physicsDebugLines', this.scene, null, null, false, true, true)
      this.linesMesh.isPickable = false
    }

    if (!this.indices || this.indices.length !== vertexCount) {
      this.indices = new Uint32Array(vertexCount)
      for (let i = 0; i < vertexCount; i++) this.indices[i] = i
    }

    const vertexData = new VertexData()
    vertexData.positions = vertices
    vertexData.indices = this.indices
    vertexData.colors = colors
    vertexData.applyToMesh(this.linesMesh, true)
  }

  dispose(): void {
    this.linesMesh?.dispose()
    this.linesMesh = null
    this.indices = null
  }
}
