import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Use relative paths so assets resolve correctly when deployed to a subdirectory
  base: './',
  build: {
    target: 'es2022',
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: [
        'vite.svg',
        'reel.png',
        'icons/icon.svg',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'textures/environment.env',
        'assets/particle.png',
        'assets/shard.png',
        'assets/backbox/splash1.png',
        'assets/backbox/splash2.png',
        'backbox/attract.png',
        'audio/*.ogg',
        'wasm/**/*',
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
        // Main bundle + Rapier WASM chunk exceed Workbox's 2 MiB default
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: [
          '**/*.{js,css,html,wasm,svg,png,ogg,env,webp,ico,txt,webmanifest}',
        ],
        // Full backbox loops can be large — poster (attract.png) is precached instead
        globIgnores: ['**/backbox/*.mp4', '**/backbox/*.webm'],
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
