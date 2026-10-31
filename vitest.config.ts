import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __PACHINBALL_BUILD__: JSON.stringify('vitest'),
  },
  resolve: {
    alias: [
      {
        find: /^@babylonjs\/core(\/.*)?$/,
        replacement: path.resolve(__dirname, 'tests/mocks/babylon-core.ts'),
      },
      {
        // vite-plugin-pwa's virtual module only exists inside a Vite build or dev server.
        find: /^virtual:pwa-register$/,
        replacement: path.resolve(__dirname, 'tests/mocks/pwa-register.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Rapier's ESM WASM bundle needs inlining when loaded from Vitest's Node runner.
    server: {
      deps: {
        inline: ['@dimforge/rapier3d-compat', 'base64-js'],
      },
    },
  },
})
