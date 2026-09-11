import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  resolveEngineCreationPlan,
  webgpuFeatureLevelsToTry,
  toWebGLEngineOptions,
  toWebGPUEngineOptions,
  attachGpuContextLogging,
  createWebGPUEngineWithFallback,
  type WebGPUEngineFactory,
  type WebGPUEngineLike,
} from '../src/engine/create-engine'
import { resolveEngineOptions } from '../src/engine/engine-options'
import { MRT_REQUIRED_LIMITS, type ResolvedGpuLimits } from '../src/engine/gpu-limits'
import { getGpuDegrades, resetGpuDegradesForTests } from '../src/engine/gpu-degrade-telemetry'
import { RENDERER_AUTO, RENDERER_WEBGL2, RENDERER_WEBGPU } from '../src/renderers/renderer-selector'

const desktopCtx = (search = '') => ({
  search,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
  devicePixelRatio: 1,
})

function makeObservable() {
  const callbacks: Array<() => void> = []
  return {
    callbacks,
    observable: {
      add: (cb: () => void) => callbacks.push(cb),
      removeCallback: (cb: () => void) => {
        const i = callbacks.indexOf(cb)
        if (i >= 0) callbacks.splice(i, 1)
      },
    },
    fire: () => callbacks.forEach((cb) => cb()),
  }
}

let warnSpy: ReturnType<typeof vi.spyOn>
let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  resetGpuDegradesForTests()
})

afterEach(() => {
  warnSpy.mockRestore()
  logSpy.mockRestore()
})

describe('create-engine', () => {
  it('forces WebGL2 when preference is webgl2 regardless of WebGPU support', () => {
    expect(resolveEngineCreationPlan(RENDERER_WEBGL2, true)).toBe('webgl2')
    expect(resolveEngineCreationPlan(RENDERER_WEBGL2, false)).toBe('webgl2')
  })

  it('forces WebGPU when preference is webgpu', () => {
    expect(resolveEngineCreationPlan(RENDERER_WEBGPU, true)).toBe('webgpu')
    expect(resolveEngineCreationPlan(RENDERER_WEBGPU, false)).toBe('webgpu')
  })

  it('defaults to WebGPU when auto preference and WebGPU is supported', () => {
    expect(resolveEngineCreationPlan(RENDERER_AUTO, true)).toBe('webgpu')
    expect(resolveEngineCreationPlan(RENDERER_AUTO, false)).toBe('webgl2')
    expect(resolveEngineCreationPlan(RENDERER_WEBGL2, true)).toBe('webgl2')
  })

  it('tries compatibility after core, but not core after compat', () => {
    expect(webgpuFeatureLevelsToTry('core')).toEqual(['core', 'compatibility'])
    expect(webgpuFeatureLevelsToTry('compatibility')).toEqual(['compatibility'])
  })

  it('maps WebGL options including audioEngine false and SwiftShader-safe caveat', () => {
    const resolved = resolveEngineOptions(desktopCtx())
    const gl = toWebGLEngineOptions(resolved)
    expect(gl.audioEngine).toBe(false)
    expect(gl.failIfMajorPerformanceCaveat).toBe(false)
    expect(gl.premultipliedAlpha).toBe(true)
    expect(gl.doNotHandleContextLost).toBe(false)
  })

  it('maps WebGPU options without enableAllFeatures and remaps default power', () => {
    const resolved = resolveEngineOptions({
      search: '?gpuDebug=1',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile)',
      devicePixelRatio: 2,
    })
    const gpu = toWebGPUEngineOptions(resolved)
    expect(gpu.powerPreference).toBeUndefined()
    expect(gpu.setMaximumLimits).toBe(true)
    expect(gpu.enableAllFeatures).toBe(false)
    expect(gpu.enableGPUDebugMarkers).toBe(true)
    expect(gpu.audioEngine).toBe(false)
    expect(gpu.featureLevel).toBe('core')
  })

  it('requests no optional device features by default', () => {
    const resolved = resolveEngineOptions(desktopCtx())
    const gpu = toWebGPUEngineOptions(resolved)
    expect(gpu.deviceDescriptor?.requiredFeatures).toEqual([])
    expect(gpu.deviceDescriptor?.requiredLimits).toBeUndefined()
  })

  it('hands out a fresh deviceDescriptor per call (Babylon mutates it during initAsync)', () => {
    const resolved = resolveEngineOptions(desktopCtx())
    const a = toWebGPUEngineOptions(resolved)
    const b = toWebGPUEngineOptions(resolved)
    expect(a.deviceDescriptor).not.toBe(b.deviceDescriptor)
  })

  it('drops setMaximumLimits at the compatibility feature level', () => {
    const resolved = resolveEngineOptions(desktopCtx())
    expect(toWebGPUEngineOptions(resolved, 'core').setMaximumLimits).toBe(true)
    const compat = toWebGPUEngineOptions(resolved, 'compatibility')
    expect(compat.setMaximumLimits).toBe(false)
    expect(compat.featureLevel).toBe('compatibility')
  })

  it('attachGpuContextLogging observes loss/restore and logs only', () => {
    const lost = makeObservable()
    const restored = makeObservable()
    const engine = {
      onContextLostObservable: lost.observable,
      onContextRestoredObservable: restored.observable,
      // present but must never be called — resize is not recovery
      resize: vi.fn(),
    }

    const detach = attachGpuContextLogging(engine)
    expect(lost.callbacks).toHaveLength(1)
    expect(restored.callbacks).toHaveLength(1)

    lost.fire()
    restored.fire()
    expect(engine.resize).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()

    detach()
    expect(lost.callbacks).toHaveLength(0)
    expect(restored.callbacks).toHaveLength(0)
  })

  it('tolerates an engine without context observables', () => {
    expect(() => attachGpuContextLogging({})()).not.toThrow()
  })
})

describe('createWebGPUEngineWithFallback', () => {
  const canvas = {} as HTMLCanvasElement

  function stubEngine(init: () => Promise<void>): WebGPUEngineLike & { dispose: ReturnType<typeof vi.fn> } {
    return { initAsync: init, dispose: vi.fn() }
  }

  it('returns the core engine when the first attempt succeeds', async () => {
    const engine = stubEngine(() => Promise.resolve())
    const factory = vi.fn(() => engine) as unknown as WebGPUEngineFactory

    const result = await createWebGPUEngineWithFallback(canvas, resolveEngineOptions(desktopCtx()), factory)

    expect(result?.engine).toBe(engine)
    expect(result?.featureLevel).toBe('core')
    expect(factory).toHaveBeenCalledTimes(1)
    expect(engine.dispose).not.toHaveBeenCalled()
  })

  it('disposes the failed core engine, then retries compatibility without maximum limits', async () => {
    const failed = stubEngine(() => Promise.reject(new Error('device lost')))
    const ok = stubEngine(() => Promise.resolve())
    const seen: Array<{ featureLevel?: string; setMaximumLimits?: boolean; disposedBefore: boolean }> = []

    const factory = vi.fn((_canvas: HTMLCanvasElement, options) => {
      const engine = seen.length === 0 ? failed : ok
      seen.push({
        featureLevel: options.featureLevel,
        setMaximumLimits: options.setMaximumLimits,
        disposedBefore: failed.dispose.mock.calls.length > 0,
      })
      return engine
    }) as unknown as WebGPUEngineFactory

    const result = await createWebGPUEngineWithFallback(canvas, resolveEngineOptions(desktopCtx()), factory)

    expect(result?.engine).toBe(ok)
    expect(result?.featureLevel).toBe('compatibility')
    expect(failed.dispose).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([
      { featureLevel: 'core', setMaximumLimits: true, disposedBefore: false },
      // dispose of the core attempt happened before the compatibility construct
      { featureLevel: 'compatibility', setMaximumLimits: false, disposedBefore: true },
    ])
  })

  it('returns null after every level fails, disposing each attempt', async () => {
    const engines: Array<ReturnType<typeof stubEngine>> = []
    const factory = vi.fn(() => {
      const engine = stubEngine(() => Promise.reject(new Error('nope')))
      engines.push(engine)
      return engine
    }) as unknown as WebGPUEngineFactory

    const result = await createWebGPUEngineWithFallback(canvas, resolveEngineOptions(desktopCtx()), factory)

    expect(result).toBeNull()
    expect(engines).toHaveLength(2)
    for (const engine of engines) expect(engine.dispose).toHaveBeenCalledTimes(1)
  })

  it('?gpu=compat skips the core attempt entirely', async () => {
    const engine = stubEngine(() => Promise.resolve())
    const factory = vi.fn(() => engine) as unknown as WebGPUEngineFactory

    const result = await createWebGPUEngineWithFallback(
      canvas,
      resolveEngineOptions(desktopCtx('?gpu=compat')),
      factory,
    )

    expect(result?.featureLevel).toBe('compatibility')
    expect(factory).toHaveBeenCalledTimes(1)
    expect(vi.mocked(factory).mock.calls[0][1].featureLevel).toBe('compatibility')
  })

  it('keeps going when disposing a failed attempt throws', async () => {
    const failed: WebGPUEngineLike = {
      initAsync: () => Promise.reject(new Error('device lost')),
      dispose: () => {
        throw new Error('dispose exploded')
      },
    }
    const ok = stubEngine(() => Promise.resolve())
    let call = 0
    const factory = vi.fn(() => (call++ === 0 ? failed : ok)) as unknown as WebGPUEngineFactory

    const result = await createWebGPUEngineWithFallback(canvas, resolveEngineOptions(desktopCtx()), factory)

    expect(result?.engine).toBe(ok)
  })
})

describe('probe-and-clamp requiredLimits', () => {
  const canvas = {} as HTMLCanvasElement

  const stubEngine = () => ({ initAsync: () => Promise.resolve(), dispose: vi.fn() })

  /** Adapter that meets everything MRT asks for. */
  const fullyGranted: ResolvedGpuLimits = {
    requiredLimits: { ...MRT_REQUIRED_LIMITS },
    clamped: [],
    unsupported: [],
  }

  it('passes probed limits on the core attempt and turns setMaximumLimits off', async () => {
    const factory = vi.fn(() => stubEngine()) as unknown as WebGPUEngineFactory

    await createWebGPUEngineWithFallback(canvas, resolveEngineOptions(desktopCtx()), factory, {
      probeLimits: async () => fullyGranted,
    })

    const options = vi.mocked(factory).mock.calls[0][1]
    expect(options.featureLevel).toBe('core')
    // Babylon only honours setMaximumLimits when requiredLimits is unset; be explicit.
    expect(options.setMaximumLimits).toBe(false)
    expect(options.deviceDescriptor?.requiredLimits).toEqual({ ...MRT_REQUIRED_LIMITS })
    expect(options.deviceDescriptor?.requiredFeatures).toEqual([])
  })

  it('keeps the blunt setMaximumLimits when the adapter probe is unavailable', async () => {
    const factory = vi.fn(() => stubEngine()) as unknown as WebGPUEngineFactory

    await createWebGPUEngineWithFallback(canvas, resolveEngineOptions(desktopCtx()), factory, {
      probeLimits: async () => null,
    })

    const options = vi.mocked(factory).mock.calls[0][1]
    expect(options.setMaximumLimits).toBe(true)
    expect(options.deviceDescriptor?.requiredLimits).toBeUndefined()
  })

  it('drops probed limits on the compatibility retry — that retry asks for less', async () => {
    let call = 0
    const factory = vi.fn(() => {
      if (call++ === 0) {
        return { initAsync: () => Promise.reject(new Error('device lost')), dispose: vi.fn() }
      }
      return stubEngine()
    }) as unknown as WebGPUEngineFactory

    const result = await createWebGPUEngineWithFallback(
      canvas,
      resolveEngineOptions(desktopCtx()),
      factory,
      { probeLimits: async () => fullyGranted },
    )

    expect(result?.featureLevel).toBe('compatibility')
    const compatOptions = vi.mocked(factory).mock.calls[1][1]
    expect(compatOptions.setMaximumLimits).toBe(false)
    expect(compatOptions.deviceDescriptor?.requiredLimits).toBeUndefined()
  })

  it('does not probe when ?maxLimits=0 opted out of the MRT defense', async () => {
    const probeLimits = vi.fn(async () => fullyGranted)
    const factory = vi.fn(() => stubEngine()) as unknown as WebGPUEngineFactory

    await createWebGPUEngineWithFallback(
      canvas,
      resolveEngineOptions(desktopCtx('?maxLimits=0')),
      factory,
      { probeLimits },
    )

    expect(probeLimits).not.toHaveBeenCalled()
    expect(vi.mocked(factory).mock.calls[0][1].setMaximumLimits).toBe(false)
  })

  it('does not probe for ?gpu=compat, which never attempts core', async () => {
    const probeLimits = vi.fn(async () => fullyGranted)
    const factory = vi.fn(() => stubEngine()) as unknown as WebGPUEngineFactory

    await createWebGPUEngineWithFallback(
      canvas,
      resolveEngineOptions(desktopCtx('?gpu=compat')),
      factory,
      { probeLimits },
    )

    expect(probeLimits).not.toHaveBeenCalled()
  })

  it('records a clamped-limits degrade when the adapter cannot grant everything', async () => {
    const factory = vi.fn(() => stubEngine()) as unknown as WebGPUEngineFactory

    await createWebGPUEngineWithFallback(canvas, resolveEngineOptions(desktopCtx()), factory, {
      probeLimits: async () => ({
        requiredLimits: { ...MRT_REQUIRED_LIMITS, maxUniformBuffersPerShaderStage: 12 },
        clamped: [{ name: 'maxUniformBuffersPerShaderStage', requested: 16, granted: 12 }],
        unsupported: [],
      }),
    })

    const degrades = getGpuDegrades()
    expect(degrades).toHaveLength(1)
    expect(degrades[0].path).toBe('limits-clamped')
    expect(degrades[0].detail).toBe('maxUniformBuffersPerShaderStage 16\u219212')
  })
})

describe('degrade telemetry from the creation path', () => {
  const canvas = {} as HTMLCanvasElement

  it('records the feature-level fallback with the level we asked for', async () => {
    let call = 0
    const factory = vi.fn(() => {
      if (call++ === 0) {
        return { initAsync: () => Promise.reject(new Error('device lost')), dispose: vi.fn() }
      }
      return { initAsync: () => Promise.resolve(), dispose: vi.fn() }
    }) as unknown as WebGPUEngineFactory

    await createWebGPUEngineWithFallback(canvas, resolveEngineOptions(desktopCtx()), factory, {
      probeLimits: async () => null,
    })

    const degrades = getGpuDegrades()
    expect(degrades).toHaveLength(1)
    expect(degrades[0]).toMatchObject({
      path: 'webgpu-featurelevel',
      featureLevel: 'compatibility',
      detail: 'requested core',
    })
  })

  it('records context loss and restore as a pair', () => {
    const lost = makeObservable()
    const restored = makeObservable()

    attachGpuContextLogging(
      { onContextLostObservable: lost.observable, onContextRestoredObservable: restored.observable },
      { featureLevel: 'core' },
    )

    lost.fire()
    restored.fire()

    expect(getGpuDegrades().map((d) => d.path)).toEqual(['context-lost', 'context-restored'])
    expect(getGpuDegrades()[0].featureLevel).toBe('core')
  })
})
