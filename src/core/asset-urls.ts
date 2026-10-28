/**
 * Static asset URL resolution — Babylon-free (#322).
 *
 * Split out of `src/game/game-utils.ts` so `src/game-elements/` can resolve
 * asset paths without importing from the high-level game layer.
 *
 * This is the one place that reads `import.meta.env.BASE_URL` (#464 item 5).
 * Production is built with `base: './'` and served from `/pachinball/`, so an
 * asset path must never be joined to `/` by hand: `'/audio/x.js'` fetches the
 * origin root, not the game.
 */

/** URLs that already say where they live: passed through untouched. */
const ABSOLUTE_URL = /^(?:https?:|data:|blob:)/i

/** `''`, `'.'` and `'./'` mean "next to the document"; any other base gets a trailing slash. */
function normalizeBase(base: string): string {
  if (base === '' || base === '.' || base === './') return './'
  return base.endsWith('/') ? base : `${base}/`
}

/**
 * Resolve a public-dir path (`'audio/x.js'`, `'/textures/env.env'`) against the
 * deploy base: `'./audio/x.js'` under `base: './'`, `'/pachinball/audio/x.js'`
 * under an absolute base. Leading `./` and `/` on `assetPath` are dropped, so
 * both spellings land in the public dir. `http(s):`, `data:` and `blob:` URLs
 * are returned as-is.
 */
export function assetUrl(assetPath: string, base: string = import.meta.env.BASE_URL): string {
  if (ABSOLUTE_URL.test(assetPath)) return assetPath
  return normalizeBase(base) + assetPath.replace(/^(?:\.\/|\/)+/, '')
}

/** `assetUrl` for optional paths: `undefined` / `''` resolve to `undefined`. */
export function resolveAssetUrl(assetPath: string | undefined, base?: string): string | undefined {
  if (!assetPath) return undefined
  return assetUrl(assetPath, base)
}

/**
 * The document's directory as an absolute URL. A last path segment without a
 * `.` is read as a directory, so `https://host/pachinball` (no trailing slash)
 * still resolves `audio/x.js` to `/pachinball/audio/x.js`, not `/audio/x.js`.
 */
function documentDirectory(baseUri: string): URL {
  const url = new URL(baseUri)
  url.search = ''
  url.hash = ''
  const last = url.pathname.slice(url.pathname.lastIndexOf('/') + 1)
  if (last !== '' && !last.includes('.')) url.pathname += '/'
  return url
}

/**
 * `assetUrl` as an absolute URL, for APIs that take one (`AudioWorklet.addModule`).
 * Left relative, `'./audio/x.js'` resolves against `document.baseURI`, which is
 * wrong whenever the page was opened without its trailing slash
 * (`https://host/pachinball` → `https://host/audio/x.js`).
 */
export function resolveAbsoluteAssetUrl(
  assetPath: string,
  base: string = import.meta.env.BASE_URL,
  baseUri: string = document.baseURI,
): string {
  const url = assetUrl(assetPath, base)
  if (ABSOLUTE_URL.test(url)) return url
  return new URL(url, documentDirectory(baseUri)).href
}
