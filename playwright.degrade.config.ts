import { defineConfig, devices } from '@playwright/test'

/**
 * Dev-server config for physics-degrade.spec.ts.
 * Uses Vite dev (console.warn preserved) with public/wasm removed so the
 * default wasm-owner preference fail-closes to Rapier.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/physics-degrade.spec.ts',
  webServer: {
    command: 'rm -rf public/wasm && npm run dev -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu-sandbox',
        '--use-gl=angle',
        '--use-angle=swiftshader',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
