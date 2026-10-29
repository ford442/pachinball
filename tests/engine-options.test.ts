import { describe, it, expect } from 'vitest'
import {
  resolveEngineOptions,
  resolveHardwareScalingLevel,
  type EngineOptionsContext,
} from '../src/engine/engine-options'

const desktopCtx = (search = '', dpr = 1): EngineOptionsContext => ({
  search,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
  devicePixelRatio: dpr,
})

const mobileCtx = (search = ''): EngineOptionsContext => ({
  search,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile)',
  devicePixelRatio: 3,
})

describe('resolveEngineOptions', () => {
  it('defaults preserveDrawingBuffer to false on desktop', () => {
    const opts = resolveEngineOptions(desktopCtx())
    expect(opts.preserveDrawingBuffer).toBe(false)
    // The canvas is not multisampled: MSAA lives on the scene's HDR target (#488 §3).
    expect(opts.antialias).toBe(false)
    expect(opts.stencil).toBe(true)
    expect(opts.setMaximumLimits).toBe(true)
    expect(opts.adaptToDeviceRatio).toBe(false)
    expect(opts.powerPreference).toBe('high-performance')
    expect(opts.audioEngine).toBe(false)
    expect(opts.doNotHandleContextLost).toBe(false)
    expect(opts.failIfMajorPerformanceCaveat).toBe(false)
    expect(opts.premultipliedAlpha).toBe(true)
    expect(opts.featureLevel).toBe('core')
    expect(opts.enableGPUDebugMarkers).toBe(false)
  })

  it('uses default powerPreference on mobile', () => {
    const opts = resolveEngineOptions(mobileCtx())
    expect(opts.powerPreference).toBe('default')
  })

  it('honors ?preserveBuffer=1', () => {
    const opts = resolveEngineOptions(desktopCtx('?preserveBuffer=1'))
    expect(opts.preserveDrawingBuffer).toBe(true)
  })

  it('honors window.DEBUG_PRESERVE_DRAWING_BUFFER', () => {
    const opts = resolveEngineOptions({
      ...desktopCtx(),
      debugPreserveDrawingBuffer: true,
    })
    expect(opts.preserveDrawingBuffer).toBe(true)
  })

  it('honors ?antialias=1 (canvas MSAA back on) and ?maxLimits=0', () => {
    expect(resolveEngineOptions(desktopCtx('?antialias=1')).antialias).toBe(true)
    expect(resolveEngineOptions(desktopCtx('?antialias=0')).antialias).toBe(false)
    const opts = resolveEngineOptions(desktopCtx('?maxLimits=0'))
    expect(opts.setMaximumLimits).toBe(false)
  })

  it('honors ?power=low-power', () => {
    const opts = resolveEngineOptions(desktopCtx('?power=low-power'))
    expect(opts.powerPreference).toBe('low-power')
  })

  it('honors ?gpu=compat, ?gpu=strict, and ?gpuDebug=1', () => {
    expect(resolveEngineOptions(desktopCtx('?gpu=compat')).featureLevel).toBe('compatibility')
    expect(resolveEngineOptions(desktopCtx('?gpu=strict')).failIfMajorPerformanceCaveat).toBe(true)
    expect(resolveEngineOptions(desktopCtx('?gpuDebug=1')).enableGPUDebugMarkers).toBe(true)
  })
})

describe('resolveHardwareScalingLevel', () => {
  // level = 1 / renderScale; renderScale = min(DPR, 1.5 mobile | 2 desktop) before the tier is known.
  it('renders a DPR-3 phone at 1.5x CSS pixels (was level 2: half CSS, 1/6 of native per axis)', () => {
    expect(1 / resolveHardwareScalingLevel(mobileCtx())).toBeCloseTo(1.5)
  })

  it('follows DPR on desktop up to 2x', () => {
    expect(resolveHardwareScalingLevel(desktopCtx('', 3))).toBeCloseTo(0.5)
    expect(resolveHardwareScalingLevel(desktopCtx('', 2))).toBeCloseTo(0.5)
    expect(1 / resolveHardwareScalingLevel(desktopCtx('', 1.5))).toBeCloseTo(1.5)
  })

  it('returns 1 on standard desktop', () => {
    expect(resolveHardwareScalingLevel(desktopCtx('', 1))).toBe(1)
  })

  it('honours ?renderScale=', () => {
    expect(resolveHardwareScalingLevel(desktopCtx('?renderScale=1', 2))).toBe(1)
    expect(1 / resolveHardwareScalingLevel(mobileCtx('?renderScale=0.75'))).toBeCloseTo(0.75)
  })
})
