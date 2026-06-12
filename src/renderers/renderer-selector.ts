/**
 * Renderer selection for WebGPU vs WebGL2 fallback.
 *
 * Pachinball is built on Babylon.js, which already abstracts WebGPU/WebGL
 * behind `EngineFactory.CreateAsync`. This module only decides *which*
 * backend that factory should attempt, and exposes the result for
 * Playwright / debugging.
 *
 * Priority (first match wins):
 *   1. URL param    ?renderer=webgpu|webgl2
 *   2. global       window.DEBUG_RENDERER = 'webgpu' | 'webgl2'
 *   3. localStorage pachinball-renderer
 *   4. default      'auto' (WebGPU first, automatic WebGL fallback)
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
    if (stored === RENDERER_WEBGL2 || stored === RENDERER_WEBGPU) return stored
  } catch {
    // Private browsing / storage disabled — ignore.
  }

  return RENDERER_AUTO
}

/**
 * Persist a renderer preference. Takes effect on next reload since the
 * Babylon engine is created once during bootstrap.
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
