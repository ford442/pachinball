/**
 * GPU capability record (#488 §2): the optional-feature allow-list intersected with the adapter,
 * and the record consumers query instead of quality-tier strings.
 */

import { describe, it, expect } from 'vitest'
import {
  OPTIONAL_WEBGPU_FEATURES,
  formatGpuCapabilities,
  hdrTextureType,
  resolveGpuCapabilities,
  selectWebGPUFeatures,
  type CapsSource,
} from '../src/engine/gpu-capabilities'

const TEXTURETYPE_UNSIGNED_BYTE = 0
const TEXTURETYPE_FLOAT = 1
const TEXTURETYPE_HALF_FLOAT = 2
const TEXTURETYPE_UNSIGNED_INT_10F_11F_11F_REV = 13

function source(caps: ReturnType<CapsSource['getCaps']>, webgpu = true, enabled: string[] = []): CapsSource {
  return { isWebGPU: webgpu, getCaps: () => caps, enabledExtensions: enabled }
}

describe('selectWebGPUFeatures', () => {
  it('keeps the allow-list entries the adapter has, in allow-list order', () => {
    expect(selectWebGPUFeatures(['shader-f16', 'subgroups', 'texture-compression-bc'])).toEqual([
      'texture-compression-bc',
      'shader-f16',
    ])
  })

  it('asks for everything on an adapter that has everything, and nothing on one that has nothing', () => {
    expect(selectWebGPUFeatures([...OPTIONAL_WEBGPU_FEATURES, 'extra'])).toEqual([...OPTIONAL_WEBGPU_FEATURES])
    expect(selectWebGPUFeatures([])).toEqual([])
  })

  it('accepts a GPUSupportedFeatures-like set', () => {
    expect(selectWebGPUFeatures(new Set(['timestamp-query']))).toEqual(['timestamp-query'])
  })
})

describe('resolveGpuCapabilities', () => {
  it('a fully featured WebGPU device', () => {
    const caps = resolveGpuCapabilities(
      source(
        {
          s3tc: true,
          astc: true,
          etc2: true,
          timerQuery: true,
          textureHalfFloatRender: true,
          textureFloatRender: true,
          textureFloatLinearFiltering: true,
          rg11b10ufColorRenderable: true,
          maxMSAASamples: 4,
        },
        true,
        ['shader-f16'],
      ),
    )
    expect(caps).toEqual({
      backend: 'webgpu',
      compressedTextures: { bc: true, astc: true, etc2: true },
      gpuTimer: true,
      hdrFormat: 'rg11b10ufloat',
      f16: true,
      float32Filterable: true,
      maxMsaaSamples: 4,
    })
  })

  it('falls back through the HDR formats', () => {
    expect(resolveGpuCapabilities(source({ textureHalfFloatRender: true })).hdrFormat).toBe('rgba16f')
    expect(resolveGpuCapabilities(source({ textureFloatRender: true })).hdrFormat).toBe('rgba32f')
    expect(resolveGpuCapabilities(source({})).hdrFormat).toBe('rgba8')
    // RG11B10 renderable but no half float: still the plain float path.
    expect(resolveGpuCapabilities(source({ rg11b10ufColorRenderable: true, textureFloatRender: true })).hdrFormat).toBe('rgba32f')
  })

  it('WebGL2 never picks rg11b10ufloat (its render target draws black there)', () => {
    const caps = resolveGpuCapabilities(source({ rg11b10ufColorRenderable: true, textureHalfFloatRender: true }, false))
    expect(caps.hdrFormat).toBe('rgba16f')
  })

  it('WebGL2 never reports f16, and defaults MSAA to 1', () => {
    const caps = resolveGpuCapabilities(source({ textureHalfFloatRender: true }, false, ['shader-f16']))
    expect(caps.backend).toBe('webgl2')
    expect(caps.f16).toBe(false)
    expect(caps.gpuTimer).toBe(false)
    expect(caps.maxMsaaSamples).toBe(1)
  })

  it('maps each HDR format to its Babylon texture type', () => {
    expect(hdrTextureType('rg11b10ufloat')).toBe(TEXTURETYPE_UNSIGNED_INT_10F_11F_11F_REV)
    expect(hdrTextureType('rgba16f')).toBe(TEXTURETYPE_HALF_FLOAT)
    expect(hdrTextureType('rgba32f')).toBe(TEXTURETYPE_FLOAT)
    expect(hdrTextureType('rgba8')).toBe(TEXTURETYPE_UNSIGNED_BYTE)
  })

  it('formats a one-line boot summary', () => {
    const line = formatGpuCapabilities(resolveGpuCapabilities(source({ s3tc: true, textureHalfFloatRender: true, maxMSAASamples: 4 })))
    expect(line).toContain('hdr=rgba16f')
    expect(line).toContain('compressed=bc')
    expect(line).toContain('msaa≤4')
  })
})
