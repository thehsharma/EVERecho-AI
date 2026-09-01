import { defineConfig, devices } from '@playwright/test';

/**
 * Drives the real application: the Next.js app talking to the real API, the
 * real worker and a real database. Nothing is stubbed.
 *
 * Chromium is pre-installed in this environment at PLAYWRIGHT_BROWSERS_PATH.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    // The environment pre-installs Chromium at a revision this Playwright
    // version does not expect, so point at the real binary rather than
    // downloading another copy.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // A viewport a storyteller might actually use.
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
    {
      // A tablet viewport on Chromium: this product is used on tablets, and
      // WebKit is not available in this environment.
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 810, height: 1080 }, isMobile: false },
      dependencies: ['setup'],
    },
  ],
});
