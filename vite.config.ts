import { defineConfig } from 'vite'

export default defineConfig({
  // Use relative paths so assets resolve correctly when deployed to a subdirectory
  base: './',
  build: {
    target: 'es2022',
  },
})
