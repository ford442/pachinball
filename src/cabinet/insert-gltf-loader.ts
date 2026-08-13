/**
 * Playfield insert glTF loader — visual-only LOD meshes for table toys.
 * Colliders remain code-authored in Rapier; never mesh-collide insert art.
 */

import type { Scene, AbstractMesh, AssetContainer } from '@babylonjs/core'
import { QualityTier } from '../game-elements/visual-language'
import {
  loadCabinetGltf,
  pickCabinetGltfUrl,
  type CabinetLoadProgress,
} from './cabinet-gltf-loader'
import type { CabinetGltfConfig } from './cabinet-types'

export interface InsertGltfLoadResult {
  container: AssetContainer
  meshes: AbstractMesh[]
  url: string
  lod: 'simple' | 'high'
}

/** Prism Core insert asset paths under public/models/inserts/. */
export const PRISM_CORE_INSERT_GLTF: CabinetGltfConfig = {
  simpleUrl: 'models/inserts/prism-core/simple.glb',
  highUrl: 'models/inserts/prism-core/high.glb',
  loadTimeoutMs: 10_000,
}

/**
 * Load a playfield insert preferring tier LOD, falling back to simple on failure.
 */
export async function loadInsertGltfForPreset(
  scene: Scene,
  gltf: CabinetGltfConfig,
  tier: QualityTier,
  options: { onProgress?: CabinetLoadProgress } = {},
): Promise<InsertGltfLoadResult> {
  const primary = pickCabinetGltfUrl(gltf, tier)
  const timeoutMs = gltf.loadTimeoutMs ?? 10_000

  try {
    const container = await loadCabinetGltf(scene, primary.url, {
      onProgress: options.onProgress,
      timeoutMs,
    })
    return {
      container,
      meshes: container.meshes,
      url: primary.url,
      lod: primary.lod,
    }
  } catch (primaryErr) {
    if (primary.lod === 'simple') {
      throw primaryErr
    }
    console.warn(
      `[InsertGltf] High LOD failed (${primary.url}), falling back to simple:`,
      primaryErr,
    )
    options.onProgress?.(0)
    const container = await loadCabinetGltf(scene, gltf.simpleUrl, {
      onProgress: options.onProgress,
      timeoutMs,
    })
    return {
      container,
      meshes: container.meshes,
      url: gltf.simpleUrl,
      lod: 'simple',
    }
  }
}

/**
 * Parent insert meshes under a playfield anchor and disable procedural pick.
 */
export function attachInsertMeshes(
  meshes: AbstractMesh[],
  anchor: { x: number; y: number; z: number },
): void {
  for (const mesh of meshes) {
    mesh.isPickable = false
    mesh.parent = null
    mesh.position.set(anchor.x, anchor.y, anchor.z)
  }
}
