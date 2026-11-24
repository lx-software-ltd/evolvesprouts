import { defineConfig, devices } from '@playwright/test';

const port = 3100;
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `${origin}/`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run dev -- -p ${port}`,
    url: `${origin}/en/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SITE_ORIGIN: origin,
      NEXT_PUBLIC_EMAIL: 'dev@example.com',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
