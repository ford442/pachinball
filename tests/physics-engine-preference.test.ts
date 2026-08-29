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
  })

  it('defaults to wasm-owner when localStorage is unset', () => {
    expect(WASM_PHYSICS.defaultEngine).toBe('wasm-owner')
    expect(getPhysicsEnginePreference()).toBe('wasm-owner')
    expect(getWasmPhysicsRuntimeMode()).toBe('wasm-owner')
  })

  it('honors an explicit rapier override', () => {
    localStorage.setItem(WASM_PHYSICS.flagKey, 'rapier')
    expect(getPhysicsEnginePreference()).toBe('rapier')
    expect(getWasmPhysicsRuntimeMode()).toBe('rapier')
  })
})
