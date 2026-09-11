import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MRT_REQUIRED_LIMITS,
  resolveRequiredLimits,
  probeGpuLimits,
  describeClampedLimits,
  type AdapterLike,
  type GpuLike,
} from '../src/engine/gpu-limits'

/** A generous adapter: every MRT limit met or exceeded. */
const generousLimits: Record<string, number> = Object.fromEntries(
  Object.entries(MRT_REQUIRED_LIMITS).map(([name, value]) => [name, value * 2]),
)

/** Safari/Metal shape: 12 uniform buffers per stage, 32 colour-attachment bytes per sample. */
const strictLimits: Record<string, number> = {
  ...generousLimits,
  maxUniformBuffersPerShaderStage: 12,
  maxColorAttachmentBytesPerSample: 32,
}

function fakeAdapter(limits: Record<string, number> | undefined): AdapterLike {
  return { limits }
}

function fakeGpu(
  adapter: AdapterLike | null,
  onRequest?: (options?: unknown) => void,
): GpuLike {
  return {
    requestAdapter: async (options) => {
      onRequest?.(options)
      return adapter
    },
  }
}

let warnSpy: ReturnType<typeof vi.spyOn>
let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
  logSpy.mockRestore()
})

describe('resolveRequiredLimits', () => {
  it('requests exactly what MRT needs when the adapter exceeds every limit', () => {
    const resolved = resolveRequiredLimits(generousLimits)

    expect(resolved.requiredLimits).toEqual({ ...MRT_REQUIRED_LIMITS })
    expect(resolved.clamped).toEqual([])
    expect(resolved.unsupported).toEqual([])
  })

  it('never requests above the adapter, and reports what it had to clamp', () => {
    const resolved = resolveRequiredLimits(strictLimits)

    expect(resolved.requiredLimits.maxUniformBuffersPerShaderStage).toBe(12)
    expect(resolved.requiredLimits.maxColorAttachmentBytesPerSample).toBe(32)
    expect(resolved.clamped).toEqual([
      { name: 'maxColorAttachmentBytesPerSample', requested: 64, granted: 32 },
      { name: 'maxUniformBuffersPerShaderStage', requested: 16, granted: 12 },
    ])

    // The whole point: requestDevice() can never fail because of this list.
    for (const [name, value] of Object.entries(resolved.requiredLimits)) {
      expect(value).toBeLessThanOrEqual(strictLimits[name])
    }
  })

  it('omits limits the adapter does not report instead of guessing', () => {
    const partial = { ...generousLimits }
    delete partial.maxColorAttachmentBytesPerSample

    const resolved = resolveRequiredLimits(partial)

    expect(resolved.unsupported).toEqual(['maxColorAttachmentBytesPerSample'])
    expect('maxColorAttachmentBytesPerSample' in resolved.requiredLimits).toBe(false)
  })

  it('ignores non-numeric and non-finite adapter values', () => {
    const resolved = resolveRequiredLimits({
      ...generousLimits,
      maxBindGroups: 'four' as unknown as number,
      maxTextureDimension2D: Number.POSITIVE_INFINITY,
    })

    expect(resolved.unsupported).toEqual(['maxBindGroups', 'maxTextureDimension2D'])
  })

  it('inverts the comparison for min* limits, where smaller is more capable', () => {
    const resolved = resolveRequiredLimits(
      { minUniformBufferOffsetAlignment: 256 },
      { minUniformBufferOffsetAlignment: 64 },
    )

    // Asking for 64 on an adapter that can only do 256 would fail; request 256.
    expect(resolved.requiredLimits.minUniformBufferOffsetAlignment).toBe(256)
    expect(resolved.clamped).toEqual([
      { name: 'minUniformBufferOffsetAlignment', requested: 64, granted: 256 },
    ])
  })

  it('returns an empty request when there are no adapter limits at all', () => {
    const resolved = resolveRequiredLimits(undefined)

    expect(resolved.requiredLimits).toEqual({})
    expect(resolved.unsupported).toEqual(Object.keys(MRT_REQUIRED_LIMITS))
  })

  it('reads prototype-backed limits like a real GPUSupportedLimits', () => {
    // GPUSupportedLimits exposes its limits on the prototype, not as own properties.
    const proto = generousLimits
    const supportedLimits = Object.create(proto) as Record<string, number>

    const resolved = resolveRequiredLimits(supportedLimits)

    expect(resolved.requiredLimits).toEqual({ ...MRT_REQUIRED_LIMITS })
    expect(resolved.unsupported).toEqual([])
  })
})

describe('probeGpuLimits', () => {
  it('resolves limits from the adapter it requests', async () => {
    const resolved = await probeGpuLimits(fakeGpu(fakeAdapter(strictLimits)))

    expect(resolved?.requiredLimits.maxUniformBuffersPerShaderStage).toBe(12)
    expect(resolved?.clamped).toHaveLength(2)
  })

  it('forwards powerPreference but drops the non-WebGPU "default" hint', async () => {
    const seen: unknown[] = []
    await probeGpuLimits(fakeGpu(fakeAdapter(generousLimits), (o) => seen.push(o)), {
      powerPreference: 'high-performance',
    })
    await probeGpuLimits(fakeGpu(fakeAdapter(generousLimits), (o) => seen.push(o)), {
      powerPreference: 'default',
    })

    expect(seen[0]).toEqual({ powerPreference: 'high-performance' })
    expect(seen[1]).toEqual({})
  })

  it('only forwards featureLevel for the compatibility probe', async () => {
    const seen: unknown[] = []
    await probeGpuLimits(fakeGpu(fakeAdapter(generousLimits), (o) => seen.push(o)), {
      featureLevel: 'core',
    })
    await probeGpuLimits(fakeGpu(fakeAdapter(generousLimits), (o) => seen.push(o)), {
      featureLevel: 'compatibility',
    })

    expect(seen[0]).toEqual({})
    expect(seen[1]).toEqual({ featureLevel: 'compatibility' })
  })

  it('returns null when there is no navigator.gpu', async () => {
    expect(await probeGpuLimits(undefined)).toBeNull()
  })

  it('returns null when the adapter request yields nothing', async () => {
    expect(await probeGpuLimits(fakeGpu(null))).toBeNull()
  })

  it('returns null instead of throwing when requestAdapter rejects', async () => {
    const gpu: GpuLike = {
      requestAdapter: () => Promise.reject(new Error('no adapter')),
    }

    expect(await probeGpuLimits(gpu)).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe('describeClampedLimits', () => {
  it('renders a compact one-line summary', () => {
    expect(
      describeClampedLimits([
        { name: 'maxUniformBuffersPerShaderStage', requested: 16, granted: 12 },
        { name: 'maxColorAttachmentBytesPerSample', requested: 64, granted: 32 },
      ]),
    ).toBe('maxUniformBuffersPerShaderStage 16→12, maxColorAttachmentBytesPerSample 64→32')
  })
})
