/**
 * #519 A2: the bootstrap's C++ preload resolves `./wasm/PhysicsModule.js` against the page, not
 * the importing chunk (`/assets/wasm/…` was a 404 in every production build), and sends no HEAD
 * probe (Workbox's precache route answers GET only, so the probe failed offline).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolvePhysicsBundleUrl } from '../src/wasm/bundle-url'
import {
  getPreloadedWasmModule,
  preloadWasmPhysicsNow,
  resetWasmPreloadForTests,
} from '../src/engine/wasm-idle-preload'

describe('resolvePhysicsBundleUrl', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('resolves a public-root path against the page, including under a subdirectory base', () => {
    vi.stubGlobal('window', { location: { href: 'https://example.test/pachinball/?debug=1' } })
    expect(resolvePhysicsBundleUrl('./wasm/PhysicsModule.js')).toBe('https://example.test/pachinball/wasm/PhysicsModule.js')
    expect(resolvePhysicsBundleUrl('/wasm/PhysicsModule.js')).toBe('https://example.test/wasm/PhysicsModule.js')
  })

  it('passes absolute http(s) / blob URLs through, and bare paths when there is no page', () => {
    vi.stubGlobal('window', { location: { href: 'https://example.test/' } })
    expect(resolvePhysicsBundleUrl('https://cdn.test/a.js')).toBe('https://cdn.test/a.js')
    expect(resolvePhysicsBundleUrl('blob:https://example.test/1')).toBe('blob:https://example.test/1')
    vi.unstubAllGlobals()
    expect(resolvePhysicsBundleUrl('./wasm/PhysicsModule.js')).toBe('./wasm/PhysicsModule.js')
  })
})

describe('preloadWasmPhysicsNow', () => {
  let pageHref: string

  beforeEach(() => {
    // A fake "site": <dir>/index.html with the glue at <dir>/wasm/PhysicsModule.js.
    const dir = mkdtempSync(join(tmpdir(), 'pachinball-preload-'))
    mkdirSync(join(dir, 'wasm'))
    writeFileSync(
      join(dir, 'wasm', 'PhysicsModule.js'),
      'export default async function factory() { return { marker: "page-relative" } }\n',
    )
    pageHref = pathToFileURL(join(dir, 'index.html')).href
    resetWasmPreloadForTests()
    vi.stubGlobal('localStorage', { getItem: () => 'wasm-owner' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetWasmPreloadForTests()
  })

  it('loads the glue from the page-relative URL without a HEAD probe', async () => {
    vi.stubGlobal('window', { location: { href: pageHref } })
    const fetchSpy = vi.fn(() => Promise.reject(new Error('offline')))
    vi.stubGlobal('fetch', fetchSpy)

    preloadWasmPhysicsNow('./wasm/PhysicsModule.js')
    const mod = (await getPreloadedWasmModule()) as unknown as { marker?: string } | null

    expect(mod?.marker).toBe('page-relative')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('settles null when the bundle is missing', async () => {
    vi.stubGlobal('window', { location: { href: pageHref } })
    preloadWasmPhysicsNow('./wasm/Missing.js')
    expect(await getPreloadedWasmModule()).toBeNull()
  })
})
