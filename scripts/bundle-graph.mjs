/**
 * Tiny, dependency-free readers for the built `dist/index.html`, shared by
 * scripts/check-bundle-size.mjs and tests/bundle-graph.test.ts.
 *
 * The browser's boot graph is exactly what index.html says it is: one module
 * entry script plus the `modulepreload` links Vite emits for that entry's static
 * imports. Reading it is more honest than guessing "the largest index-*.js".
 */

/** @param {string} attrs raw attribute string of a tag */
function attr(attrs, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')
  const m = re.exec(attrs)
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null
}

function tags(html, tagName) {
  const out = []
  const re = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi')
  let m
  while ((m = re.exec(html)) !== null) out.push(m[1])
  return out
}

/** `src` of the first `<script type="module" src=...>`, or null. */
export function parseEntryScript(html) {
  for (const attrs of tags(html, 'script')) {
    if ((attr(attrs, 'type') ?? '').toLowerCase() !== 'module') continue
    const src = attr(attrs, 'src')
    if (src) return src
  }
  return null
}

/** `href`s of every `<link rel="modulepreload">`, in document order. */
export function parseModulepreloads(html) {
  const out = []
  for (const attrs of tags(html, 'link')) {
    const rel = (attr(attrs, 'rel') ?? '').toLowerCase().split(/\s+/)
    if (!rel.includes('modulepreload')) continue
    const href = attr(attrs, 'href')
    if (href) out.push(href)
  }
  return out
}

/** Last path segment, without query/hash. */
export function assetBasename(href) {
  return (href.split(/[?#]/)[0] ?? '').split('/').pop() ?? ''
}

/**
 * Names of the JS chunks the browser fetches before the app can boot: the entry plus
 * every modulepreloaded chunk, minus those a caller wants to exclude (babylon-core is
 * budgeted on its own row).
 *
 * @param {string} html
 * @param {{ excludePrefixes?: string[] }} [opts]
 * @returns {{ entry: string | null, preloaded: string[] }}
 */
export function bootChunks(html, opts = {}) {
  const exclude = opts.excludePrefixes ?? []
  const entrySrc = parseEntryScript(html)
  const entry = entrySrc ? assetBasename(entrySrc) : null
  const preloaded = parseModulepreloads(html)
    .map(assetBasename)
    .filter((name) => name.endsWith('.js') && name !== entry)
    .filter((name) => !exclude.some((p) => name.startsWith(p)))
  return { entry, preloaded: [...new Set(preloaded)] }
}
