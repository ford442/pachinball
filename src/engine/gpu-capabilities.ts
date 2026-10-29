/**
 * GPU capability record (#488 §2) — what this context can do, as booleans and formats that
 * consumers query, instead of inferring it from a quality-tier string.
 *
 * WebGPU optional features: we ask for an allow-list, intersected with what the adapter offers, so
 * the device has every feature the adapter can give and never fails `requestDevice()` over one it
 * cannot. (Babylon 9.30 intersects `requiredFeatures` too — `webgpuEngine.pure.js` `initAsync` —
 * but the intersection is done here explicitly so the code says what it does.)
 */

import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'

// Babylon's TEXTURETYPE_* constants (stable since Babylon 4), inlined so this entry-chunk module
// needs no runtime Babylon import and unit-tests under the Babylon mock.
const TEXTURETYPE_UNSIGNED_BYTE = 0
const TEXTURETYPE_FLOAT = 1
const TEXTURETYPE_HALF_FLOAT = 2
const TEXTURETYPE_UNSIGNED_INT_10F_11F_11F_REV = 13

/** Optional WebGPU features worth having. Order is irrelevant; anything the adapter lacks is dropped. */
export const OPTIONAL_WEBGPU_FEATURES = [
  'texture-compression-bc',
  'texture-compression-astc',
  'texture-compression-etc2',
  'timestamp-query',
  'float32-filterable',
  'rg11b10ufloat-renderable',
  'shader-f16',
] as const
export type OptionalWebGPUFeature = (typeof OPTIONAL_WEBGPU_FEATURES)[number]

/** The allow-list ∩ the adapter's features, in allow-list order. */
export function selectWebGPUFeatures(adapterFeatures: Iterable<string>): OptionalWebGPUFeature[] {
  const offered = new Set(adapterFeatures)
  return OPTIONAL_WEBGPU_FEATURES.filter((f) => offered.has(f))
}

/**
 * Format of the scene's HDR colour target, best first:
 * - `rg11b10ufloat`: packed 32-bit float RGB, half the bandwidth of RGBA16F (no alpha; the scene
 *   colour's alpha is never read — the graph's last pass writes an opaque canvas).
 * - `rgba16f` / `rgba32f`: classic half / full float.
 * - `rgba8`: no float render target at all (LDR).
 */
export type HdrFormat = 'rg11b10ufloat' | 'rgba16f' | 'rgba32f' | 'rgba8'

export interface GpuCapabilities {
  readonly backend: 'webgpu' | 'webgl2'
  /** Block-compressed texture families the device can sample (KTX2 transcodes to the first one). */
  readonly compressedTextures: { readonly bc: boolean; readonly astc: boolean; readonly etc2: boolean }
  /** GPU timestamp queries: `EngineInstrumentation.gpuFrameTimeCounter` measures real GPU time. */
  readonly gpuTimer: boolean
  /** Best renderable HDR colour format (see `HdrFormat`). */
  readonly hdrFormat: HdrFormat
  /** `shader-f16` (WGSL `f16`). Always false on WebGL2. */
  readonly f16: boolean
  /** Linear filtering of 32-bit float textures. */
  readonly float32Filterable: boolean
  /** Largest MSAA sample count a render target may use (1 = none). */
  readonly maxMsaaSamples: number
}

/** The subset of Babylon's engine caps the record is built from (injectable for tests). */
export interface CapsSource {
  isWebGPU: boolean
  getCaps(): {
    s3tc?: unknown
    bptc?: unknown
    astc?: unknown
    etc2?: unknown
    timerQuery?: unknown
    textureHalfFloatRender?: boolean
    textureFloatRender?: boolean
    textureFloatLinearFiltering?: boolean
    rg11b10ufColorRenderable?: boolean
    maxMSAASamples?: number
  }
  /** WebGPU: the features the device was created with. */
  readonly enabledExtensions?: readonly string[]
}

export function resolveGpuCapabilities(engine: CapsSource | AbstractEngine): GpuCapabilities {
  const source = engine as CapsSource
  const caps = source.getCaps()
  const webgpu = source.isWebGPU === true
  const features = new Set(webgpu ? (source.enabledExtensions ?? []) : [])

  let hdrFormat: HdrFormat
  if (caps.rg11b10ufColorRenderable === true && caps.textureHalfFloatRender === true) hdrFormat = 'rg11b10ufloat'
  else if (caps.textureHalfFloatRender === true) hdrFormat = 'rgba16f'
  else if (caps.textureFloatRender === true) hdrFormat = 'rgba32f'
  else hdrFormat = 'rgba8'

  return {
    backend: webgpu ? 'webgpu' : 'webgl2',
    compressedTextures: {
      bc: Boolean(caps.s3tc) || Boolean(caps.bptc),
      astc: Boolean(caps.astc),
      etc2: Boolean(caps.etc2),
    },
    gpuTimer: Boolean(caps.timerQuery),
    hdrFormat,
    f16: features.has('shader-f16'),
    float32Filterable: caps.textureFloatLinearFiltering === true,
    maxMsaaSamples: Math.max(1, caps.maxMSAASamples ?? 1),
  }
}

/** Babylon texture type for an HDR format (`format` stays RGBA: Babylon maps type 13 to rg11b10ufloat). */
export function hdrTextureType(format: HdrFormat): number {
  switch (format) {
    case 'rg11b10ufloat':
      return TEXTURETYPE_UNSIGNED_INT_10F_11F_11F_REV
    case 'rgba16f':
      return TEXTURETYPE_HALF_FLOAT
    case 'rgba32f':
      return TEXTURETYPE_FLOAT
    case 'rgba8':
      return TEXTURETYPE_UNSIGNED_BYTE
  }
}

/** One-line summary for the boot log. */
export function formatGpuCapabilities(c: GpuCapabilities): string {
  const tc = Object.entries(c.compressedTextures)
    .filter(([, on]) => on)
    .map(([k]) => k)
  return (
    `[Bootstrap] GPU caps: ${c.backend}, hdr=${c.hdrFormat}, msaa≤${c.maxMsaaSamples}, ` +
    `gpuTimer=${c.gpuTimer ? 'yes' : 'no'}, f16=${c.f16 ? 'yes' : 'no'}, ` +
    `compressed=${tc.length > 0 ? tc.join('+') : 'none'}`
  )
}
