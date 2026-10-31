/**
 * True when WebGL is rasterised on the CPU (SwiftShader): Chrome's fallback on machines without GPU
 * acceleration, and every headless CI runner. Render passes that are cheap on a GPU cost real frame
 * time there, so the heavy post chain and the backbox composite scale down for it.
 *
 * WebGPU engines report false (no `_gl`): their software adapter is not a player-facing fallback.
 */
export function isSoftwareRasterizer(engine: unknown): boolean {
  const gl = (engine as { _gl?: WebGLRenderingContext | WebGL2RenderingContext | null } | null)?._gl
  if (!gl) return false
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  if (!debugInfo) return false
  const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string | null
  return renderer?.toLowerCase().includes('swiftshader') ?? false
}
