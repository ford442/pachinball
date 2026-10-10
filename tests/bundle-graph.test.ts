import { describe, expect, it } from 'vitest'
import { assetBasename, bootChunks, parseEntryScript, parseModulepreloads } from '../scripts/bundle-graph.mjs'

const html = `<!doctype html><html><head>
<script type="module" crossorigin src="./assets/index-CW7pZ_fX.js"></script>
<link rel="modulepreload" crossorigin href="./assets/babylon-core-j-UJ_RBi.js">
<link rel="modulepreload" crossorigin href="./assets/ui-overlays-D0J7DIDk.js">
<link rel="stylesheet" crossorigin href="./assets/index-abc.css">
<link rel="manifest" href="./manifest.webmanifest">
</head></html>`

describe('bundle-graph', () => {
  it('finds the module entry script regardless of attribute order', () => {
    expect(parseEntryScript(html)).toBe('./assets/index-CW7pZ_fX.js')
    expect(parseEntryScript('<script src="/a/x.js" type="module"></script>')).toBe('/a/x.js')
    expect(parseEntryScript('<script src="/a/x.js"></script>')).toBeNull()
    expect(parseEntryScript('<html></html>')).toBeNull()
  })

  it('lists only modulepreload links', () => {
    expect(parseModulepreloads(html)).toEqual([
      './assets/babylon-core-j-UJ_RBi.js',
      './assets/ui-overlays-D0J7DIDk.js',
    ])
  })

  it('assetBasename drops directories, query and hash', () => {
    expect(assetBasename('./assets/a-1.js?v=2#x')).toBe('a-1.js')
    expect(assetBasename('/p/assets/b.js')).toBe('b.js')
  })

  it('bootChunks excludes babylon-core on request and never repeats the entry', () => {
    const all = bootChunks(html)
    expect(all.entry).toBe('index-CW7pZ_fX.js')
    expect(all.preloaded).toEqual(['babylon-core-j-UJ_RBi.js', 'ui-overlays-D0J7DIDk.js'])

    const lean = bootChunks(html, { excludePrefixes: ['babylon-core-'] })
    expect(lean.preloaded).toEqual(['ui-overlays-D0J7DIDk.js'])

    const dup = bootChunks(`${html}<link rel="modulepreload" href="./assets/index-CW7pZ_fX.js">`)
    expect(dup.preloaded).not.toContain('index-CW7pZ_fX.js')
  })
})
