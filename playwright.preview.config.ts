import { defineConfig, devices } from '@playwright/test'

/**
 * Production-bundle config: serves the built `dist/` with `vite preview` (COOP/COEP come
 * from vite.config.ts `preview.headers`, so the page is cross-origin isolated) and runs
 * the desktop smoke specs against it. Build first: `npx vite build`.
 *
 * Service workers are blocked so the smoke specs test the bundle, not Workbox;
 * tests/preview-sw.spec.ts opts back in with `test.use({ serviceWorkers: 'allow' })`.
 * Mobile stays on the dev-server config (playwright.config.ts).
 */
export default defineConfig({
  testDir: '.',
  webServer: {
    command: 'npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://localhost:4174',
    serviceWorkers: 'block',
    launchOptions: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu-sandbox',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: '**/mobile-touch-smoke.spec.ts',
    },
  ],
})
