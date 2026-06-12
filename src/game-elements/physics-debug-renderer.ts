/**
 * Physics Debug Renderer — draws Rapier's collider/joint wireframes via
 * Babylon LineSystem meshes. Toggled from the Developer settings panel.
 * WebGL2 is the recommended renderer for this view (see renderer-selector.ts).
 */

import { Color4, LinesMesh, MeshBuilder, Vector3, type Scene } from '@babylonjs/core'
import type { PhysicsSystem } from './physics'

export class PhysicsDebugRenderer {
  private readonly scene: Scene
  private readonly physics: PhysicsSystem
  private linesMesh: LinesMesh | null = null
  private enabled = false

  constructor(scene: Scene, physics: PhysicsSystem) {
    this.scene = scene
    this.physics = physics
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.linesMesh?.dispose()
      this.linesMesh = null
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  /** Call once per frame (after the physics step) while enabled. */
  update(): void {
    if (!this.enabled) return

    const world = this.physics.getWorld()
    if (!world) return

    const { vertices, colors } = world.debugRender()
    const segmentCount = Math.floor(vertices.length / 6)
    if (segmentCount === 0) {
      this.linesMesh?.dispose()
      this.linesMesh = null
      return
    }

    const lines: Vector3[][] = []
    const lineColors: Color4[][] = []
    for (let i = 0; i < segmentCount; i++) {
      const vOff = i * 6
      const cOff = i * 8
      lines.push([
        new Vector3(vertices[vOff], vertices[vOff + 1], vertices[vOff + 2]),
        new Vector3(vertices[vOff + 3], vertices[vOff + 4], vertices[vOff + 5]),
      ])
      const color = new Color4(colors[cOff], colors[cOff + 1], colors[cOff + 2], colors[cOff + 3] ?? 1)
      lineColors.push([color, color])
    }

    this.linesMesh = MeshBuilder.CreateLineSystem(
      'physicsDebugLines',
      { lines, colors: lineColors, instance: this.linesMesh ?? undefined },
      this.scene
    )
    this.linesMesh.isPickable = false
  }

  dispose(): void {
    this.linesMesh?.dispose()
    this.linesMesh = null
  }
}
