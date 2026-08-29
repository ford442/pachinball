/**
 * Physics Debug Renderer — Rapier wireframes in rapier/mirror mode;
 * packed C++ transform/contact buffers (+ cached static AABBs) in owner/worker.
 * WebGL2 is the recommended renderer for this view (see renderer-selector.ts).
 */

import { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'
import type { PhysicsSystem } from './physics'
import { buildWasmDebugLineBuffers } from './wasm-debug-geometry'

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
   * Rebuilds the mesh geometry from Rapier and/or packed WASM buffers.
   */
  update(): void {
    if (!this.enabled) return

    const now = performance.now()
    if (now - this.lastUpdateMs < PhysicsDebugRenderer.UPDATE_INTERVAL_MS) return
    this.lastUpdateMs = now

    const mode = this.physics.getWasmMode()
    const useWasmDraw = mode === 'wasm-owner' || mode === 'wasm-worker'

    if (!useWasmDraw) {
      const world = this.physics.getWorld()
      if (!world) return
      const { vertices, colors } = world.debugRender()
      this.applyLineBuffers(vertices, colors)
      return
    }

    const wasm = buildWasmDebugLineBuffers(
      this.physics.getWasmEngine(),
      this.physics.getWasmDebugColliders(),
    )
    const positions = wasm.positions
    const colors = wasm.colors

    if (!this.physics.getOwnerSkipRapierStep()) {
      const world = this.physics.getWorld()
      if (world) {
        const rendered = world.debugRender()
        for (let i = 0; i < rendered.vertices.length; i++) {
          positions.push(rendered.vertices[i] ?? 0)
        }
        for (let i = 0; i < rendered.colors.length; i++) {
          colors.push(rendered.colors[i] ?? 0)
        }
      }
    }

    this.applyLineBuffers(positions, colors)
  }

  private applyLineBuffers(
    vertices: ArrayLike<number>,
    colors: ArrayLike<number>,
  ): void {
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
    vertexData.positions = vertices as number[] | Float32Array
    vertexData.indices = this.indices
    vertexData.colors = colors as number[] | Float32Array
    vertexData.applyToMesh(this.linesMesh, true)
  }

  dispose(): void {
    this.linesMesh?.dispose()
    this.linesMesh = null
    this.indices = null
  }
}
