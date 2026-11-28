import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.BASE_URL?.endsWith('/')
  ? process.env.BASE_URL
  : process.env.BASE_URL
    ? `${process.env.BASE_URL}/`
    : 'http://localhost:4174/'

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/{smoke-prod,webgpu-boot,webgpu-no-glslang}.spec.ts',
  forbidOnly: !!process.env.CI,
  retries: 0,
  ...(process.env.BASE_URL
    ? {}
    : {
        webServer: {
          command: 'npx vite preview --port 4174 --strictPort',
          url: 'http://localhost:4174',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
  use: {
    baseURL,
    trace: 'retain-on-failure',
    serviceWorkers: 'allow',
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
    },
    {
      name: 'mobile-chrome',
      testMatch: '**/smoke-prod.spec.ts',
      use: { ...devices['Pixel 7'], hasTouch: true, isMobile: true },
    },
  ],
})
