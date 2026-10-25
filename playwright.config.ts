import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: { baseURL: 'http://localhost:3177', trace: 'retain-on-failure', channel: 'chrome' },
  webServer: {
    command: 'npm run build && node --import tsx scripts/start-e2e.mjs',
    url: 'http://localhost:3177/api/health',
    timeout: 90_000,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'mobile-360', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 800 } } },
    { name: 'tablet-768', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 900 } } },
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
  ],
});
