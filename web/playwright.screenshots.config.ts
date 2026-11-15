import { defineConfig, devices } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  testDir: './scripts',
  testMatch: 'capture-readme.ts',
  timeout: 180_000,
  projects: [{ name: 'readme', use: {
    ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 },
    locale: 'en-GB', timezoneId: 'Europe/London',
  } }],
});
