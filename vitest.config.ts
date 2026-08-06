import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Rapier's ESM WASM bundle needs inlining when loaded from Vitest's Node runner.
    server: {
      deps: {
        inline: ['@dimforge/rapier3d-compat'],
      },
    },
  },
})
