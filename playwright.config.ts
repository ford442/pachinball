import { defineConfig, devices } from '@playwright/test';

/**
 * Specs that only run under their own config: the preview set needs the built bundle on 4174/4175
 * (playwright.preview.config.ts), the degrade spec a dev server without public/wasm
 * (playwright.degrade.config.ts). Ignored here so a full `npx playwright test` is meaningful.
 */
const OTHER_CONFIG_SPECS = [
  '**/preview-*.spec.ts',
  '**/offline-boot.spec.ts',
  '**/physics-degrade.spec.ts',
]

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
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
    trace: 'retain-on-failure',
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
      testIgnore: ['**/mobile-touch-smoke.spec.ts', ...OTHER_CONFIG_SPECS],
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
