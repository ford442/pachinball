/**
 * Cabinet glTF loader — AssetContainer load with progress, timeout, LOD pick.
 * Collision is never derived from these meshes; playfield Rapier walls stay code-authored.
 */

import '@babylonjs/loaders/glTF'
import {
  SceneLoader,
  type Scene,
  type AbstractMesh,
  type AssetContainer,
  type ISceneLoaderProgressEvent,
} from '@babylonjs/core'
import { QualityTier } from '../game-elements/visual-language'
import { resolveAssetUrl } from '../game/game-utils'
import type { CabinetGltfConfig, CabinetPreset } from './cabinet-types'

export type CabinetLoadProgress = (progress: number) => void

export interface CabinetGltfLoadResult {
  container: AssetContainer
  meshes: AbstractMesh[]
  url: string
  lod: 'simple' | 'high'
}

const DEFAULT_TIMEOUT_MS = 15_000

/** Pick LOD URL from quality tier. LOW never requests high. */
export function pickCabinetGltfUrl(
  gltf: CabinetGltfConfig,
  tier: QualityTier,
): { url: string; lod: 'simple' | 'high' } {
  if (tier === QualityTier.LOW) {
    return { url: gltf.simpleUrl, lod: 'simple' }
  }
  return { url: gltf.highUrl, lod: 'high' }
}

/**
 * Split a resolved asset URL into rootUrl + sceneFilename for SceneLoader.
 * SceneLoader expects rootUrl ending with `/` and a relative filename.
 */
export function splitAssetUrl(resolvedUrl: string): { rootUrl: string; sceneFilename: string } {
  const lastSlash = resolvedUrl.lastIndexOf('/')
  if (lastSlash < 0) {
    return { rootUrl: './', sceneFilename: resolvedUrl }
  }
  return {
    rootUrl: resolvedUrl.slice(0, lastSlash + 1),
    sceneFilename: resolvedUrl.slice(lastSlash + 1),
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[CabinetGltf] Timed out after ${ms}ms loading ${label}`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * Load a cabinet (or insert) glTF into an AssetContainer and add it to the scene.
 */
export async function loadCabinetGltf(
  scene: Scene,
  relativeUrl: string,
  options: {
    onProgress?: CabinetLoadProgress
    timeoutMs?: number
  } = {},
): Promise<AssetContainer> {
  const resolved = resolveAssetUrl(relativeUrl)
  if (!resolved) {
    throw new Error(`[CabinetGltf] Invalid URL: ${relativeUrl}`)
  }

  const { rootUrl, sceneFilename } = splitAssetUrl(resolved)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const loadPromise = SceneLoader.LoadAssetContainerAsync(
    rootUrl,
    sceneFilename,
    scene,
    (event: ISceneLoaderProgressEvent) => {
      if (!options.onProgress) return
      if (event.lengthComputable && event.total > 0) {
        options.onProgress(Math.min(1, event.loaded / event.total))
      } else if (event.loaded > 0) {
        // Indeterminate progress: ease toward 0.9
        options.onProgress(Math.min(0.9, 0.15 + event.loaded / (event.loaded + 500_000)))
      }
    },
  )

  const container = await withTimeout(loadPromise, timeoutMs, relativeUrl)
  container.addAllToScene()
  options.onProgress?.(1)
  return container
}

/**
 * Load classic (or any preset with gltf config) preferring the tier LOD,
 * falling back to simple when high fails.
 */
export async function loadCabinetGltfForPreset(
  scene: Scene,
  gltf: CabinetGltfConfig,
  tier: QualityTier,
  options: {
    onProgress?: CabinetLoadProgress
  } = {},
): Promise<CabinetGltfLoadResult> {
  const primary = pickCabinetGltfUrl(gltf, tier)
  const timeoutMs = gltf.loadTimeoutMs ?? DEFAULT_TIMEOUT_MS

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
      `[CabinetGltf] High LOD failed (${primary.url}), falling back to simple:`,
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
 * Optional playfield-insert hook (not wired into toys in MVP).
 */
export async function loadOptionalInsert(
  scene: Scene,
  relativeUrl: string,
  onProgress?: CabinetLoadProgress,
): Promise<AssetContainer> {
  return loadCabinetGltf(scene, relativeUrl, { onProgress })
}

/**
 * Dev-only alignment check: compare loaded mesh world AABB against preset dims.
 * Logs a warning when extents diverge beyond epsilon; never throws in production paths.
 */
export function assertCabinetAlignment(
  meshes: AbstractMesh[],
  preset: CabinetPreset,
  options: { epsilon?: number; enabled?: boolean } = {},
): boolean {
  const enabled =
    options.enabled ??
    (typeof window !== 'undefined' &&
      (window as Window & { DEBUG_CABINET_ALIGN?: boolean }).DEBUG_CABINET_ALIGN === true)
  if (!enabled || meshes.length === 0) return true

  const epsilon = options.epsilon ?? 4
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true)
    const bi = mesh.getBoundingInfo()
    const min = bi.boundingBox.minimumWorld
    const max = bi.boundingBox.maximumWorld
    minX = Math.min(minX, min.x)
    maxX = Math.max(maxX, max.x)
    minY = Math.min(minY, min.y)
    maxY = Math.max(maxY, max.y)
    minZ = Math.min(minZ, min.z)
    maxZ = Math.max(maxZ, max.z)
  }

  const width = maxX - minX
  const height = maxY - minY
  const depth = maxZ - minZ
  // Outer shell ≈ preset width + side panels (~4); allow soft match on width/depth/height
  const okWidth = Math.abs(width - (preset.width + 4)) <= epsilon || Math.abs(width - preset.width) <= epsilon
  const okDepth = Math.abs(depth - preset.depth) <= epsilon
  const okHeight = Math.abs(height - preset.sideHeight) <= epsilon + 2

  if (!okWidth || !okDepth || !okHeight) {
    console.warn(
      `[CabinetGltf] Alignment check soft-fail for ${preset.type}: ` +
        `bbox=${width.toFixed(1)}×${height.toFixed(1)}×${depth.toFixed(1)} ` +
        `vs preset≈${preset.width}×${preset.sideHeight}×${preset.depth}`,
    )
    return false
  }
  return true
}
