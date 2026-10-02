/**
 * Playfield insert glTF loader — visual-only LOD meshes for table toys.
 * Colliders remain code-authored in Rapier; never mesh-collide insert art.
 */

import type { AssetContainer } from '@babylonjs/core/assetContainer'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Scene } from '@babylonjs/core/scene'
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

export const MAG_SPIN_INSERT_GLTF: CabinetGltfConfig = {
  simpleUrl: 'models/inserts/mag-spin/simple.glb',
  highUrl: 'models/inserts/mag-spin/high.glb',
  loadTimeoutMs: 10_000,
}

export const NANO_LOOM_INSERT_GLTF: CabinetGltfConfig = {
  simpleUrl: 'models/inserts/nano-loom/simple.glb',
  highUrl: 'models/inserts/nano-loom/high.glb',
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
 * Place a loaded insert at its playfield anchor and make it unpickable.
 *
 * The glTF loader parents every file under `__root__`, whose rotation and
 * negative Z scale convert glTF's right-handed frame to Babylon's. Moving that
 * root keeps the conversion and every authored node transform; detaching the
 * meshes from it (the old behaviour) left inserts mirrored on X and wound
 * inside-out. Files without a root fall back to placing each mesh.
 */
export function attachInsertMeshes(
  meshes: AbstractMesh[],
  anchor: { x: number; y: number; z: number },
): void {
  for (const mesh of meshes) {
    mesh.isPickable = false
  }
  const root = meshes.find((m) => m.name === '__root__' && !m.parent)
  if (root) {
    root.position.set(anchor.x, anchor.y, anchor.z)
    return
  }
  for (const mesh of meshes) {
    mesh.parent = null
    mesh.position.set(anchor.x, anchor.y, anchor.z)
  }
}
