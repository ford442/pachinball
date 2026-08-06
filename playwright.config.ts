import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // Boot the Vite dev server for e2e instead of relying on a hand-started `npm run dev &`.
  // Pinned to 5173 with --strictPort because verify_prism_core.spec.ts hard-codes
  // http://localhost:5173. reuseExistingServer keeps local runs fast (attach to a dev
  // server you already have up); CI always starts its own.
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
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
      testIgnore: '**/mobile-touch-smoke.spec.ts',
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
        hasTouch: true,
        isMobile: true,
      },
      testMatch: '**/mobile-touch-smoke.spec.ts',
    },
  ],
});
