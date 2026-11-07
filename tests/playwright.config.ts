import { defineConfig, devices } from '@playwright/test';

/**
 * RovoTest: Agentic Playwright Orchestrator
 * Production-grade Playwright configuration.
 */
export default defineConfig({
  testDir: './tests',

  /* Run tests in parallel, both across and within files */
  fullyParallel: true,

  /* Fail the CI build if test.only is accidentally committed */
  forbidOnly: !!process.env.CI,

  /* Retry failed tests up to 2 times */
  retries: 2,

  /* Let Playwright decide worker count locally; limit on CI for stability */
  workers: process.env.CI ? 4 : undefined,

  /* 30-second timeout per test */
  timeout: 30_000,

  /* Assertion timeout */
  expect: {
    timeout: 5_000,
  },

  /* Reporters: HTML and JSON outputs */
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  /* Artifact output directory */
  outputDir: 'test-results/artifacts',

  use: {
    /* Capture screenshots automatically only on test failures */
    screenshot: 'only-on-failure',

    /* Collect trace on first retry for debugging */
    trace: 'on-first-retry',

    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    baseURL: process.env.BASE_URL,
  },

  /* Cross-browser projects */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});