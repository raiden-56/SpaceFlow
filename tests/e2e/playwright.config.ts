// Playwright E2E configuration.
//
// Playwright starts its own isolated stack so E2E never touches development data:
//   - API on E2E_API_PORT (4100) with NODE_ENV=test -> uses TEST_DATABASE_URL, rate limits and
//     background jobs disabled.
//   - Vite dev server on E2E_WEB_PORT (5180), proxying /api to that API.
// The global setup migrates and reseeds the test database before every run.
//
// Browser: bundled Chromium by default (CI). Set E2E_CHANNEL=msedge or chrome to use an installed
// browser instead (e.g. when a corporate proxy blocks `playwright install`).
// Set E2E_BASE_URL to point at an already-running deployment; the local servers are then skipped.
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const apiPort = Number(process.env.E2E_API_PORT ?? 4100);
const webPort = Number(process.env.E2E_WEB_PORT ?? 5180);
const external = !!process.env.E2E_BASE_URL;
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${webPort}`;
const channel = process.env.E2E_CHANNEL || undefined;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  globalSetup: external ? undefined : './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report' }]] : [['list']],
  outputDir: '../../test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    channel,
    // 3D is optional: tests drive the 2D plan and list views, which work everywhere.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 5'], channel }, grep: /@mobile/ },
  ],
  webServer: external
    ? undefined
    : [
        {
          command: 'npx tsx src/server.ts',
          cwd: path.join(root, 'apps/api'),
          url: `http://127.0.0.1:${apiPort}/api/v1/health`,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            NODE_ENV: 'test',
            API_PORT: String(apiPort),
            API_BASE_URL: `http://127.0.0.1:${apiPort}`,
            WEB_ORIGIN: `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
            JOBS_ENABLED: 'false',
          },
        },
        {
          command: `npx vite --port ${webPort} --strictPort --host 127.0.0.1`,
          cwd: path.join(root, 'apps/web'),
          url: `http://127.0.0.1:${webPort}`,
          reuseExistingServer: false,
          timeout: 120_000,
          env: { VITE_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
        },
      ],
});
