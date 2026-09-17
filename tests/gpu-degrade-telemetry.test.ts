/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  recordGpuDegrade,
  getGpuDegrades,
  countGpuDegrades,
  ensureGpuDegradeBuffer,
  resetGpuDegradesForTests,
  setActiveGpuFeatureLevel,
  GPU_DEGRADE_RING_SIZE,
  GPU_DEGRADE_GLOBAL,
  GPU_PROBE_GLOBAL,
  ensureGpuProbe,
  getGpuProbe,
  recordGpuProbeEngine,
  recordGpuProbePostProcess,
  formatGpuProbeSummary,
} from '../src/engine/gpu-degrade-telemetry'

beforeEach(() => {
  resetGpuDegradesForTests()
})

describe('gpu degrade telemetry', () => {
  it('publishes the buffer on window under the documented name', () => {
    ensureGpuDegradeBuffer()

    expect(Array.isArray((window as unknown as Record<string, unknown>)[GPU_DEGRADE_GLOBAL])).toBe(
      true,
    )
    expect(GPU_DEGRADE_GLOBAL).toBe('bootstrapGpuDegrades')
  })

  it('records path, featureLevel and timestamp', () => {
    const before = Date.now()
    recordGpuDegrade('webgpu-featurelevel', 'compatibility', 'requested core')

    const [entry] = getGpuDegrades()
    expect(entry.path).toBe('webgpu-featurelevel')
    expect(entry.featureLevel).toBe('compatibility')
    expect(entry.detail).toBe('requested core')
    expect(entry.timestamp).toBeGreaterThanOrEqual(before)
  })

  it('defaults featureLevel to null and omits an absent detail', () => {
    recordGpuDegrade('webgl2-fallback')

    const [entry] = getGpuDegrades()
    expect(entry.featureLevel).toBeNull()
    expect('detail' in entry).toBe(false)
  })

  it('drops the oldest entries past the ring size instead of growing forever', () => {
    // A flapping GPU context is exactly the case an unbounded window array would leak in.
    for (let i = 0; i < GPU_DEGRADE_RING_SIZE + 10; i++) {
      recordGpuDegrade('context-lost', null, `loss ${i}`)
    }

    const entries = getGpuDegrades()
    expect(entries).toHaveLength(GPU_DEGRADE_RING_SIZE)
    expect(entries[0].detail).toBe('loss 10')
    expect(entries[entries.length - 1].detail).toBe(`loss ${GPU_DEGRADE_RING_SIZE + 9}`)
  })

  it('counts entries per path for an analytics drain', () => {
    recordGpuDegrade('context-lost')
    recordGpuDegrade('context-restored')
    recordGpuDegrade('context-lost')

    expect(countGpuDegrades('context-lost')).toBe(2)
    expect(countGpuDegrades('context-restored')).toBe(1)
    expect(countGpuDegrades('webgl2-fallback')).toBe(0)
  })

  it('is bounded at 16 entries', () => {
    expect(GPU_DEGRADE_RING_SIZE).toBe(16)
  })

  it('defaults featureLevel to the level the engine actually booted on', () => {
    // The post-process layer can see "this is WebGPU" but not "this is the compat retry".
    setActiveGpuFeatureLevel('compatibility')
    recordGpuDegrade('postprocess-tier-boot', undefined, 'tier bloom-only: cap 12')

    expect(getGpuDegrades()[0].featureLevel).toBe('compatibility')
  })

  it('distinguishes the WebGL2 fallback from a WebGPU feature level', () => {
    setActiveGpuFeatureLevel('webgl2')
    recordGpuDegrade('postprocess-tier-runtime')

    expect(getGpuDegrades()[0].featureLevel).toBe('webgl2')
  })

  it('hands out a snapshot, not the live buffer', () => {
    recordGpuDegrade('context-lost')
    const snapshot = getGpuDegrades()
    snapshot.length = 0

    expect(getGpuDegrades()).toHaveLength(1)
  })
})

describe('gpu probe snapshot', () => {
  it('publishes an all-null snapshot on window before anything is known', () => {
    ensureGpuProbe()

    expect(GPU_PROBE_GLOBAL).toBe('bootstrapGpuProbe')
    expect((window as unknown as Record<string, unknown>)[GPU_PROBE_GLOBAL]).toEqual({
      backend: null,
      featureLevel: null,
      maxUniformBuffersPerShaderStage: null,
      postProcessTier: null,
    })
  })

  it('merges the engine half and the post-process half into one snapshot', () => {
    recordGpuProbeEngine('webgpu', 'compatibility')
    recordGpuProbePostProcess('bloom-only', 12)

    expect(getGpuProbe()).toEqual({
      backend: 'webgpu',
      featureLevel: 'compatibility',
      maxUniformBuffersPerShaderStage: 12,
      postProcessTier: 'bloom-only',
    })
  })

  it('records the undegraded path too — full tier is an answer, not a silence', () => {
    recordGpuProbeEngine('webgl2', 'webgl2')
    recordGpuProbePostProcess('full', null)

    expect(getGpuProbe().postProcessTier).toBe('full')
    expect(getGpuDegrades()).toHaveLength(0)
  })

  it('hands back a copy so a HUD reader cannot mutate the live snapshot', () => {
    recordGpuProbeEngine('webgpu', 'core')

    const copy = getGpuProbe()
    copy.backend = 'webgl2'

    expect(getGpuProbe().backend).toBe('webgpu')
  })
})

describe('gpu degrade telemetry without a window', () => {
  const realWindow = globalThis.window

  afterEach(() => {
    vi.unstubAllGlobals()
    globalThis.window = realWindow
  })

  it('falls back to a module-local buffer in a Node context', () => {
    vi.stubGlobal('window', undefined)

    expect(() => recordGpuDegrade('webgl2-fallback')).not.toThrow()
    expect(getGpuDegrades().length).toBeGreaterThan(0)
    resetGpuDegradesForTests()
  })
})

describe('formatGpuProbeSummary', () => {
  it('prints placeholders before the probe is filled', () => {
    expect(formatGpuProbeSummary()).toBe(
      '[Bootstrap] GPU probe: backend=? featureLevel=? pp=? maxUBO/stage=? degrades=0',
    )
  })

  it('carries backend, feature level, pp tier and degrade count', () => {
    recordGpuProbeEngine('webgpu', 'compatibility')
    recordGpuProbePostProcess('bloom-only', 12)
    recordGpuDegrade('postprocess-tier-boot', 'compatibility')
    expect(formatGpuProbeSummary()).toBe(
      '[Bootstrap] GPU probe: backend=webgpu featureLevel=compatibility pp=bloom-only maxUBO/stage=12 degrades=1',
    )
  })
})
