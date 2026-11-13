/**
 * Resolve a public-root bundle URL (`./wasm/PhysicsModule.js`) against the **page**, not the
 * importing module. A bare `import('./wasm/…')` from a built chunk resolves against
 * `/assets/`, so it 404s (#519 A2: the idle preload did exactly that in every production build,
 * hidden by a document-relative HEAD probe). Absolute http(s) and blob URLs pass through.
 *
 * Leaf module, lib-agnostic (`globalThis`, not the bare `window`): it is imported by the DOM app,
 * the WebWorker-lib physics worker, and the entry chunk's preload.
 */
export function resolvePhysicsBundleUrl(bundleUrl: string): string {
  if (/^(https?:|blob:)/i.test(bundleUrl)) return bundleUrl
  const win = (globalThis as Record<string, unknown>).window as
    | { location?: { href?: string } }
    | undefined
  if (!win?.location?.href) return bundleUrl
  try {
    return new URL(bundleUrl, win.location.href).href
  } catch {
    return bundleUrl
  }
}
