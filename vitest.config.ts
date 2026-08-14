import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@babylonjs\/core(\/.*)?$/,
        replacement: path.resolve(__dirname, 'tests/mocks/babylon-core.ts'),
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
