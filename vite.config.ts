import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Use relative paths so assets resolve correctly when deployed to a subdirectory
  base: './',
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
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
        // Main bundle + Rapier WASM chunk exceed Workbox's 2 MiB default
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
