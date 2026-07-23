import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
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
