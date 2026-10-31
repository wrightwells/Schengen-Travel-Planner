import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:15173',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-320', use: { viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: '../api/.venv/bin/python ../tests/e2e/serve.py', url: 'http://127.0.0.1:18080/api/v1/health/ready', reuseExistingServer: false },
    { command: 'npm run dev -- --port 15173', url: 'http://127.0.0.1:15173', env: { API_TARGET: 'http://127.0.0.1:18080' }, reuseExistingServer: false },
  ],
});
