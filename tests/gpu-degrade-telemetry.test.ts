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
  GPU_DEGRADE_RING_SIZE,
  GPU_DEGRADE_GLOBAL,
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
    expect(countGpuDegrades('limits-clamped')).toBe(0)
  })

  it('hands out a snapshot, not the live buffer', () => {
    recordGpuDegrade('context-lost')
    const snapshot = getGpuDegrades()
    snapshot.length = 0

    expect(getGpuDegrades()).toHaveLength(1)
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
