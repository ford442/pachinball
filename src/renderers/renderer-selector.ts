/**
 * Renderer selection for WebGPU vs WebGL2 fallback.
 *
 * Pachinball is built on Babylon.js, which already abstracts WebGPU/WebGL
 * Babylon's WebGPUEngine / Engine constructors. This module decides which backend
 * to instantiate. EngineFactory.CreateAsync always prefers WebGPU when available
 * and cannot be used to force WebGL2.
 * Playwright / debugging.
 *
 * Priority (first match wins):
 *   1. URL param    ?renderer=webgpu|webgl2
 *   2. global       window.DEBUG_RENDERER = 'webgpu' | 'webgl2'
 *   3. localStorage pachinball-renderer
 *   4. default      WebGPU-first auto (WebGL2 fallback on init failure)
 *
 * WebGL2 -> WebGPU porting notes:
 *   - `ShaderMaterial` with WGSL (display-shader.ts) needs a GLSL/canvas
 *     fallback — check `engine.isWebGPU` before using WGSL-only paths.
 *   - Compute-shader-style work (none currently) would need a CPU or
 *     transform-feedback equivalent under WebGL2.
 *   - Babylon's PBR materials, post-processes, and Rapier physics are
 *     backend-agnostic — no porting needed for gameplay/physics code.
 */

export const RENDERER_WEBGPU = 'webgpu'
export const RENDERER_WEBGL2 = 'webgl2'
export const RENDERER_AUTO = 'auto'
export const STORAGE_KEY = 'pachinball-renderer'

export type RendererPreference =
  | typeof RENDERER_AUTO
  | typeof RENDERER_WEBGPU
  | typeof RENDERER_WEBGL2

export type ActiveRenderer = typeof RENDERER_WEBGPU | typeof RENDERER_WEBGL2

/**
 * Resolve the user's renderer preference from URL param, debug global, or
 * localStorage. Does not check `navigator.gpu` — that's handled by
 * Babylon's `EngineFactory` itself when the preference is 'auto'.
 */
export function getRendererPreference(): RendererPreference {
  const params = new URLSearchParams(window.location.search)
  const urlRenderer = params.get('renderer')
  if (urlRenderer === RENDERER_WEBGL2 || urlRenderer === RENDERER_WEBGPU) {
    return urlRenderer
  }

  const debugGlobal = (window as unknown as { DEBUG_RENDERER?: string }).DEBUG_RENDERER
  if (typeof debugGlobal === 'string') {
    const normalized = debugGlobal.toLowerCase()
    if (normalized === RENDERER_WEBGL2 || normalized === RENDERER_WEBGPU) return normalized
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === RENDERER_WEBGL2 || stored === RENDERER_WEBGPU || stored === RENDERER_AUTO) {
      return stored
    }
  } catch {
    // Private browsing / storage disabled — ignore.
  }

  return RENDERER_AUTO
}

/**
 * Persist a renderer preference. Takes effect on next reload since the
 * Babylon engine is created once during bootstrap. Only `auto` clears the key:
 * `auto` is WebGPU-first, so removing an explicit `webgl2` choice would send the
 * player straight back into the renderer they just left (#450).
 */
export function setRendererPreference(renderer: RendererPreference): void {
  try {
    if (renderer === RENDERER_AUTO) {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, renderer)
    }
  } catch {
    // Private browsing / storage disabled — ignore.
  }
}

/**
 * Persist `renderer` and reload with it in the URL. `?renderer=` outranks storage in
 * getRendererPreference, so a stale param from an earlier switch (or the boot-error
 * banner's link) must be rewritten too or the reload lands on the old backend.
 */
export function reloadWithRenderer(renderer: RendererPreference): void {
  setRendererPreference(renderer)
  const url = new URL(window.location.href)
  if (renderer === RENDERER_AUTO) url.searchParams.delete('renderer')
  else url.searchParams.set('renderer', renderer)
  window.location.assign(url.toString())
}

/** Renderer currently running (set during bootstrap via exposeRenderer). */
export function getActiveRenderer(): ActiveRenderer {
  const fromWindow = (window as unknown as { currentRenderer?: string }).currentRenderer
  if (fromWindow === RENDERER_WEBGPU) return RENDERER_WEBGPU

  const canvas = document.getElementById('pachinball-canvas') as HTMLCanvasElement | null
  if (canvas?.dataset.renderer === RENDERER_WEBGPU) return RENDERER_WEBGPU

  return RENDERER_WEBGL2
}

/** Opt into WebGPU on the next page load. */
export function attemptWebGPURenderer(): void {
  reloadWithRenderer(RENDERER_WEBGPU)
}

/** Force the WebGL2 renderer on the next page load. */
export function useWebGL2Renderer(): void {
  reloadWithRenderer(RENDERER_WEBGL2)
}

/**
 * Tag the canvas/window with the renderer actually in use (which may differ
 * from the preference if WebGPU was requested but unavailable). Used by
 * Playwright tests and debug HUDs to confirm which backend is live.
 */
export function exposeRenderer(canvas: HTMLCanvasElement, isWebGPU: boolean): void {
  const active = isWebGPU ? RENDERER_WEBGPU : RENDERER_WEBGL2
  ;(window as unknown as { currentRenderer?: string }).currentRenderer = active
  canvas.dataset.renderer = active
  canvas.dataset.webglVersion = isWebGPU ? '' : '2'
}
