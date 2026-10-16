import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  WASM_PHYSICS,
  getPhysicsEnginePreference,
  getWasmPhysicsRuntimeMode,
} from '../src/config/physics'

describe('physics engine preference', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v) },
        removeItem: (k: string) => { store.delete(k) },
      },
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage')
    Reflect.deleteProperty(globalThis, 'crossOriginIsolated')
  })

  function setIsolated(value: boolean): void {
    Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value })
  }

  it('defaults to wasm-worker on a cross-origin-isolated page (#439)', () => {
    setIsolated(true)
    expect(WASM_PHYSICS.defaultEngine).toBe('wasm-worker')
    expect(getPhysicsEnginePreference()).toBe('wasm-worker')
    expect(getWasmPhysicsRuntimeMode()).toBe('wasm-worker')
  })

  it('defaults to in-process wasm-owner when the page is not isolated', () => {
    setIsolated(false)
    expect(WASM_PHYSICS.nonIsolatedDefaultEngine).toBe('wasm-owner')
    expect(getPhysicsEnginePreference()).toBe('wasm-owner')
    expect(getWasmPhysicsRuntimeMode()).toBe('wasm-owner')
  })

  it('defaults to wasm-owner when crossOriginIsolated is undefined (Node, old browsers)', () => {
    expect('crossOriginIsolated' in globalThis).toBe(false)
    expect(getPhysicsEnginePreference()).toBe('wasm-owner')
  })

  it('honors an explicit wasm-owner override on an isolated page', () => {
    setIsolated(true)
    localStorage.setItem(WASM_PHYSICS.flagKey, 'wasm-owner')
    expect(getWasmPhysicsRuntimeMode()).toBe('wasm-owner')
  })

  it('honors an explicit wasm-worker override on a non-isolated page', () => {
    setIsolated(false)
    localStorage.setItem(WASM_PHYSICS.flagKey, 'wasm-worker')
    expect(getWasmPhysicsRuntimeMode()).toBe('wasm-worker')
  })

  it('honors an explicit rapier override', () => {
    setIsolated(true)
    localStorage.setItem(WASM_PHYSICS.flagKey, 'rapier')
    expect(getPhysicsEnginePreference()).toBe('rapier')
    expect(getWasmPhysicsRuntimeMode()).toBe('rapier')
  })
})
