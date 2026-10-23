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

export default defineConfig({
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
  // Pre-bundle the dev dependencies the import scan misses. Otherwise a fresh dev server finds them
  // on the first page load, re-optimizes and reloads the page; on a slow CI runner that reload can
  // land after a test has already started the game, leaving it a new Game back in the menu.
  optimizeDeps: {
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
          if (id.match(/leaderboard-system|level-select-screen|name-entry-dialog/)) {
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
      registerType: 'autoUpdate',
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
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // babylon-core exceeds Workbox's 2 MiB default
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: [
          '**/*.{js,css,html,wasm,svg,png,ogg,env,webp,ico,txt,webmanifest}',
        ],
        // Full backbox loops can be large — poster (attract.png) is precached instead
        globIgnores: [
          '**/backbox/*.mp4',
          '**/backbox/*.webm',
          // Classic-cabinet glTF loader — fetched on first classic preset use
          '**/babylon-loaders-*.js',
          // Babylon code only the glTF loader imports (extensions, OpenPBR, Gaussian splatting, …)
          '**/babylon-lazy-*.js',
          // Rapier (~2.15 MB): only the explicit `rapier` mode and the fail-closed
          // degrade (C++ bundle missing) load it; the C++ bundle is precached instead (#412)
          '**/rapier-*.js',
          // Leaderboard / name-entry / level-select overlays
          '**/ui-overlays-*.js',
          // Per-track adventure builders (dynamic import)
          '**/neon-helix-*.js',
          '**/pachinko-hall-*.js',
          '**/cyber-core-*.js',
          '**/pachinko-spire-*.js',
          '**/orbital-junkyard-*.js',
          '**/cpu-core-*.js',
          '**/bio-hazard-lab-*.js',
          '**/gravity-forge-*.js',
          '**/synthwave-surf-*.js',
          '**/prism-pathway-*.js',
          '**/magnetic-storage-*.js',
          '**/neural-network-*.js',
          '**/neon-stronghold-*.js',
          '**/casino-heist-*.js',
          '**/tesla-tower-*.js',
          '**/neon-skyline-*.js',
          '**/polychrome-void-*.js',
          // Canvas reel atlas — runtime-cached on first reel use
          '**/reel.png',
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
            urlPattern: /^http:\/\/localhost:8000\/api\//,
            handler: 'NetworkFirst',
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
          {
            urlPattern: /^http:\/\/localhost:8000\/pachinball\//,
            handler: 'CacheFirst',
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
      devOptions: {
        enabled: true,
        navigateFallback: 'index.html',
        type: 'module',
      },
    }),
  ],
})
