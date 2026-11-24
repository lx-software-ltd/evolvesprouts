import { defineConfig, devices } from '@playwright/test';

const sitePort = 3100;
const crmPort = 3199;
const origin = `http://localhost:${sitePort}`;

export default defineConfig({
  testDir: './e2e',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `${origin}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // The deployed site is a static export. This smoke suite uses the dev server.
    command: 'node ./e2e/dev-server.mjs',
    url: `${origin}/en/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      E2E_SITE_PORT: String(sitePort),
      E2E_CRM_PORT: String(crmPort),
      NEXT_PUBLIC_SITE_ORIGIN: origin,
      NEXT_PUBLIC_EMAIL: 'dev@example.com',
      NEXT_PUBLIC_API_BASE_URL: `http://localhost:${crmPort}`,
      NEXT_PUBLIC_WWW_CRM_API_KEY: 'e2e-dummy',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
