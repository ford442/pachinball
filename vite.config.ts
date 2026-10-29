import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const isBabylonLoaders = (id: string) => id.includes('node_modules/@babylonjs/loaders')
/**
 * Babylon's own audio engines. The game never runs them: the engine is created with
 * `audioEngine: false` (src/engine/engine-options.ts) and src/audio owns the one AudioContext. They
 * are still statically imported by the engine classes, so the chunks they `import()` must not count
 * as app-reachable.
 */
const isBabylonAudio = (id: string) => /node_modules\/@babylonjs\/core\/Audio(V2)?\//.test(id)

/**
 * Babylon 9 lazy-loads much of itself through `import()`: shaders, the glTF extensions, OpenPBR,
 * Gaussian splatting, KHR_interactivity's FlowGraph. Two facts about the module graph keep that
 * laziness in the build:
 *
 * - `isBoot`: on a chain of *static* imports from the entry. Only those `@babylonjs/core` modules go
 *   in the `babylon-core` chunk; pinning every core module there would pull the lazy targets back
 *   into the boot chunk.
 * - `isAppReachable`: reachable from the entry by static or dynamic imports *without* passing through
 *   `@babylonjs/loaders` (or a dynamic import made by Babylon's unused audio engines). A lazy chunk that is not is only ever fetched by the glTF loader, which is
 *   itself not precached, so it gets a `babylon-lazy-` name and the service worker skips it.
 * - `isLoaderCore`: a `@babylonjs/loaders` module the app imports, or one those import statically
 *   (the glTF 2.0 loader and its extension registry). Only these go in the `babylon-loaders` chunk;
 *   the extensions the registry `import()`s on demand get chunks of their own.
 */
function babylonChunkGraph() {
  let boot = new Set<string>()
  let app = new Set<string>()
  let loaderCore = new Set<string>()
  const plugin: Plugin = {
    name: 'babylon-chunk-graph',
    apply: 'build',
    buildEnd() {
      const ids = [...this.getModuleIds()]
      const walk = (
        withDynamic: boolean,
        enter: (id: string) => boolean,
        from?: string[],
        followDynamicFrom: (id: string) => boolean = () => true,
      ) => {
        const seen = new Set<string>()
        const stack = from ?? ids.filter((id) => this.getModuleInfo(id)?.isEntry)
        for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
          if (seen.has(id) || !enter(id)) continue
          seen.add(id)
          const info = this.getModuleInfo(id)
          if (!info) continue
          stack.push(...info.importedIds)
          if (withDynamic && followDynamicFrom(id)) stack.push(...info.dynamicallyImportedIds)
        }
        return seen
      }
      boot = walk(false, () => true)
      app = walk(true, (id) => !isBabylonLoaders(id), undefined, (id) => !isBabylonAudio(id))
      const loaderRoots = ids.filter((id) => {
        const info = isBabylonLoaders(id) ? this.getModuleInfo(id) : null
        return !!info && [...info.importers, ...info.dynamicImporters].some((by) => !isBabylonLoaders(by))
      })
      loaderCore = walk(false, isBabylonLoaders, loaderRoots)
    },
  }
  return {
    plugin,
    isBoot: (id: string) => boot.has(id),
    isAppReachable: (id: string) => app.has(id),
    isLoaderCore: (id: string) => loaderCore.has(id),
  }
}

const babylonChunks = babylonChunkGraph()

/**
 * Per-track adventure builders are dynamic imports, so each is its own `assets/<file>-<hash>.js`
 * chunk; the service worker fetches them on first visit to a track instead of precaching all of
 * them. Derived from the directory so a new track is never precached by accident (#464 item 8).
 */
const trackChunkIgnores = readdirSync(fileURLToPath(new URL('./src/adventure/tracks', import.meta.url)))
  .filter((file) => file.endsWith('.ts'))
  .map((file) => `**/${file.slice(0, -'.ts'.length)}-*.js`)

/** Runtime caching for the local `storage_manager` (src/config/api.ts DEV_*_BASE); dev only. */
const localStorageManagerCaching = [
  {
    urlPattern: /^http:\/\/localhost:8000\/api\//,
    handler: 'NetworkFirst' as const,
    options: {
      cacheName: 'nexus-api-dev',
      networkTimeoutSeconds: 4,
      expiration: {
        maxEntries: 32,
        maxAgeSeconds: 60 * 60,
      },
      cacheableResponse: {
        statuses: [0, 200],
      },
    },
  },
  {
    urlPattern: /^http:\/\/localhost:8000\/pachinball\//,
    handler: 'CacheFirst' as const,
    options: {
      cacheName: 'nexus-remote-assets-dev',
      expiration: {
        maxEntries: 64,
        maxAgeSeconds: 30 * 24 * 60 * 60,
      },
      cacheableResponse: {
        statuses: [0, 200],
      },
    },
  },
]

export default defineConfig(({ mode }) => ({
  // Use relative paths so assets resolve correctly when deployed to a subdirectory
  base: './',
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  // Cross-origin isolation for `crossOriginIsolated`/SharedArrayBuffer support in
  // local dev + preview. Production (Apache, outside this repo) already serves the
  // same headers plus CORP on cross-origin assets — see docs/cross-origin-isolation.md.
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // A fresh dev server must pre-bundle everything up front. A dependency it only finds on the first
  // page load makes it re-optimize and reload the page; on a slow CI runner that reload can land
  // after a test has already started the game, leaving it a new Game back in the menu.
  //  - `entries`: scan the app's one HTML entry. By default Vite scans every *.html under the root,
  //    and CI's WASM job clones emsdk into the checkout: its test pages import files that don't
  //    resolve, the whole scan fails, and *nothing* is pre-bundled.
  //  - `include`: the imports the scan still misses.
  optimizeDeps: {
    entries: ['index.html'],
    include: ['@babylonjs/core/Cameras/targetCamera', 'workbox-window'],
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Only the degrade / explicit-`rapier` path imports this, and only via
          // loadRapier()'s dynamic import (#412) — it is never in the entry graph.
          if (id.includes('@dimforge/rapier3d-compat')) return 'rapier'
          if (isBabylonLoaders(id)) return babylonChunks.isLoaderCore(id) ? 'babylon-loaders' : undefined
          if (id.includes('node_modules/@babylonjs/core')) {
            return babylonChunks.isBoot(id) ? 'babylon-core' : undefined
          }
          if (id.match(/leaderboard-system|campaign-map|name-entry-dialog/)) {
            return 'ui-overlays'
          }
          return undefined
        },
        chunkFileNames(chunk) {
          const loaderOnly =
            chunk.moduleIds.length > 0 && !chunk.moduleIds.some((id) => babylonChunks.isAppReachable(id))
          return loaderOnly && chunk.name !== 'babylon-loaders'
            ? 'assets/babylon-lazy-[name]-[hash].js'
            : 'assets/[name]-[hash].js'
        },
      },
    },
  },
  plugins: [
    babylonChunks.plugin,
    VitePWA({
      // 'prompt': a new worker waits until the player accepts the update toast
      // (src/pwa/update-toast.ts). 'autoUpdate' reloaded the page whenever a new
      // worker activated, mid-ball included, and never called onNeedRefresh.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: [
        'vite.svg',
        'icons/icon.svg',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'backbox/attract.png',
        'audio/*.ogg',
      ],
      manifest: {
        name: 'Nexus Cascade',
        short_name: 'Nexus Cascade',
        description: 'Hybrid pachinko / pinball arcade cabinet — play offline after first visit.',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        orientation: 'landscape',
        theme_color: '#0a0e1a',
        background_color: '#0a0e1a',
        categories: ['games', 'entertainment'],
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        // Unanchored: the game is served from /pachinball/, so its API paths are not at the root.
        navigateFallbackDenylist: [/\/api\//],
        cleanupOutdatedCaches: true,
        // The first install controls the open page at once (offline works without a reload).
        // Updates still wait for the toast: there is no skipWaiting.
        clientsClaim: true,
        // babylon-core exceeds Workbox's 2 MiB default
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: [
          '**/*.{js,css,html,wasm,svg,png,ogg,env,webp,ico,txt,webmanifest}',
        ],
        // Backbox clips (state loops, tracks/, incidents/) stream on demand; their .webp
        // posters are not precached either — only the state posters (attract.png, …) are.
        globIgnores: [
          '**/backbox/**/*.mp4',
          '**/backbox/**/*.webm',
          '**/backbox/**/*.webp',
          // Classic-cabinet glTF loader — fetched on first classic preset use
          '**/babylon-loaders-*.js',
          // Babylon code only the glTF loader imports (extensions, OpenPBR, Gaussian splatting, …)
          '**/babylon-lazy-*.js',
          // Rapier (~2.15 MB): only the explicit `rapier` mode and the fail-closed
          // degrade (C++ bundle missing) load it; the C++ bundle is precached instead (#412)
          '**/rapier-*.js',
          // Leaderboard / name-entry / campaign stage-map overlays
          '**/ui-overlays-*.js',
          // The update prompt only loads when a newer worker is waiting, i.e. online
          '**/update-toast-*.js',
          // Per-track adventure builders (dynamic import)
          ...trackChunkIgnores,
          // Canvas reel atlas — runtime-cached on first reel use
          '**/reel.png',
          // Concept art kept in public/ for reference; the game never loads it (~1 MB)
          '**/concept/**',
        ],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/storage\.noahcohn\.com\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nexus-api',
              networkTimeoutSeconds: 4,
              expiration: {
                maxEntries: 32,
                maxAgeSeconds: 60 * 60,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/storage\.noahcohn\.com\/pachinball\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'nexus-remote-assets',
              expiration: {
                maxEntries: 64,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          ...(mode === 'production' ? [] : localStorageManagerCaching),
          {
            urlPattern: ({ sameOrigin, request, url }) =>
              sameOrigin &&
              (request.destination === 'script' || url.pathname.endsWith('.js')),
            handler: 'CacheFirst',
            options: {
              cacheName: 'nexus-js-chunks',
              expiration: {
                maxEntries: 64,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: ({ sameOrigin, request }) =>
              sameOrigin &&
              (request.destination === 'image' ||
                request.destination === 'audio' ||
                request.destination === 'font' ||
                request.url.endsWith('.wasm') ||
                request.url.endsWith('.env')),
            handler: 'CacheFirst',
            options: {
              cacheName: 'nexus-static',
              expiration: {
                maxEntries: 128,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      // The dev server registers no service worker unless asked (PWA_DEV=1 npm run dev): its
      // CacheFirst rule for same-origin scripts would serve stale /src modules after an edit.
      devOptions: {
        enabled: process.env.PWA_DEV === '1',
        navigateFallback: 'index.html',
        type: 'module',
      },
    }),
  ],
}))
