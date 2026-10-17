import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * The build a replay was recorded on, and the build that verified it (#444):
 * the commit, `-dirty` when the tree has uncommitted changes.
 * `PACHINBALL_BUILD_ID` overrides it (CI, a release tag).
 */
function resolveBuildId(): string {
  if (process.env.PACHINBALL_BUILD_ID) return process.env.PACHINBALL_BUILD_ID
  const git = (args: string) => execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  try {
    const sha = git('rev-parse --short=12 HEAD')
    return git('status --porcelain --untracked-files=no') ? `${sha}-dirty` : sha
  } catch {
    return 'unknown'
  }
}

const BUILD_ID = resolveBuildId()

/** `dist/build-info.json`: the replay verifier reports this as its verifier_version. */
function buildInfo(): Plugin {
  return {
    name: 'pachinball-build-info',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build-info.json', source: `${JSON.stringify({ buildId: BUILD_ID })}\n` })
    },
  }
}

export default defineConfig({
  // Use relative paths so assets resolve correctly when deployed to a subdirectory
  base: './',
  define: {
    __PACHINBALL_BUILD__: JSON.stringify(BUILD_ID),
  },
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
          if (id.includes('@babylonjs/loaders')) return 'babylon-loaders'
          if (id.includes('node_modules/@babylonjs/core')) return 'babylon-core'
          if (id.match(/leaderboard-system|level-select-screen|name-entry-dialog/)) {
            return 'ui-overlays'
          }
          return undefined
        },
      },
    },
  },
  plugins: [
    buildInfo(),
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
            // Live arcade reads (#444): the last board and stored replays stay
            // viewable offline. Writes and auth are POSTs and never cached.
            urlPattern: /^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\/(leaderboard|replays)\b/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'arcade-reads',
              networkTimeoutSeconds: 4,
              expiration: {
                maxEntries: 48,
                maxAgeSeconds: 60 * 60 * 24,
              },
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
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
