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
    expect(opts.antialias).toBe(true)
    expect(opts.stencil).toBe(true)
    expect(opts.setMaximumLimits).toBe(true)
    expect(opts.adaptToDeviceRatio).toBe(false)
    expect(opts.powerPreference).toBe('high-performance')
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

  it('honors ?antialias=0 and ?maxLimits=0', () => {
    const opts = resolveEngineOptions(desktopCtx('?antialias=0&maxLimits=0'))
    expect(opts.antialias).toBe(false)
    expect(opts.setMaximumLimits).toBe(false)
  })

  it('honors ?power=low-power', () => {
    const opts = resolveEngineOptions(desktopCtx('?power=low-power'))
    expect(opts.powerPreference).toBe('low-power')
  })
})

describe('resolveHardwareScalingLevel', () => {
  it('returns 2 on mobile', () => {
    expect(resolveHardwareScalingLevel(mobileCtx())).toBe(2)
  })

  it('returns min(DPR, 2) on HiDPI desktop', () => {
    expect(resolveHardwareScalingLevel(desktopCtx('', 3))).toBe(2)
    expect(resolveHardwareScalingLevel(desktopCtx('', 1.5))).toBe(1.5)
  })

  it('returns 1 on standard desktop', () => {
    expect(resolveHardwareScalingLevel(desktopCtx('', 1))).toBe(1)
  })
})
