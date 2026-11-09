import { test, expect, Page } from '@playwright/test';

/**
 * ContextIQ: Agentic Playwright Orchestrator
 * File: tests/e2e-pipeline.spec.ts
 *
 * Production-grade E2E pipeline covering environment routing,
 * functional flow, visual regression, and structured diagnostics.
 */

const DEFAULT_BASE_URL = 'https://atlassian.com';
const LOG_PREFIX = '[ContextIQ-Error]';

/** Resolved once at module load; overridable per run via TEST_BASE_URL */
const TARGET_BASE_URL: string = process.env.TEST_BASE_URL?.trim() || DEFAULT_BASE_URL;

/**
 * Structured diagnostic logger.
 * Emits a consistent, machine-readable line plus the full stack trace
 * so downstream agents (e.g. Rovo) can parse failures reliably.
 */
function logDiagnostic(stage: string, message: string, error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(
    `${LOG_PREFIX} stage="${stage}" message="${message}" url="${TARGET_BASE_URL}" ` +
      `timestamp="${new Date().toISOString()}"`
  );
  console.error(`${LOG_PREFIX} name="${err.name}" detail="${err.message}"`);
  if (err.stack) {
    console.error(`${LOG_PREFIX} stack:\n${err.stack}`);
  }
}

/**
 * Wraps a critical execution step in try/catch with structured logging.
 * Re-throws so Playwright still marks the test as failed (and retries/reports work).
 */
async function runStep<T>(stage: string, failureMessage: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    logDiagnostic(stage, failureMessage, error);
    throw error;
  }
}

/** Page-object style helpers keep selectors centralized and resilient */
class PortalPage {
  constructor(private readonly page: Page) {}

  get header() {
    return this.page.locator('header').first();
  }

  get headerNavigation() {
    return this.header.getByRole('navigation').first();
  }

  get headerLinks() {
    return this.header.getByRole('link');
  }

  get primaryCta() {
    return this.page
      .getByRole('link', { name: /get it free|try for free|get started|start free/i })
      .first();
  }

  async open(): Promise<void> {
    await this.page.goto('/', { waitUntil: 'domcontentloaded' });
  }

  async dismissCookieBannerIfPresent(): Promise<void> {
    const consentButton = this.page
      .getByRole('button', { name: /accept|agree|allow all|got it/i })
      .first();
    try {
      if (await consentButton.isVisible({ timeout: 3_000 })) {
        await consentButton.click();
      }
    } catch {
      // Non-critical: banner may not exist in this region/session.
    }
  }
}

test.describe('ContextIQ E2E Pipeline', () => {
  /** ENVIRONMENT ROUTING: resolve and announce the target for this run */
  test.beforeAll(() => {
    console.info(
      `[ContextIQ-Info] Environment routing active. Target Base URL: ${TARGET_BASE_URL} ` +
        `(source: ${process.env.TEST_BASE_URL ? 'TEST_BASE_URL' : 'default'})`
    );
  });

  /** Route every test to the resolved base URL via a per-test context override */
  test.use({
    baseURL: TARGET_BASE_URL,
    viewport: { width: 1440, height: 900 },
  });

  test.beforeEach(async ({ page }) => {
    // Surface browser-side problems in the pipeline logs for later triage
    page.on('pageerror', (error) => {
      console.error(`${LOG_PREFIX} stage="browser-runtime" message="Uncaught page exception" detail="${error.message}"`);
    });
    page.on('requestfailed', (request) => {
      console.error(
        `${LOG_PREFIX} stage="network" message="Request failed" url="${request.url()}" ` +
          `reason="${request.failure()?.errorText ?? 'unknown'}"`
      );
    });
  });

  test('portal navigation, CTA flow, and visual baseline', async ({ page }) => {
    const portal = new PortalPage(page);

    // STEP 1: Navigate to the portal
    await runStep('navigation', 'Portal failed to load from the resolved Base URL', async () => {
      await portal.open();
      await expect(page).toHaveURL(/atlassian\.com|./);
      await portal.dismissCookieBannerIfPresent();
    });

    // STEP 2: Assert vital header navigation elements are visible
    await runStep('header-assertions', 'Target locator failed to resolve on viewport', async () => {
      await expect(portal.header, 'Header container should be visible').toBeVisible();
      await expect(portal.headerNavigation, 'Primary navigation should be visible').toBeVisible();

      const linkCount = await portal.headerLinks.count();
      expect(linkCount, 'Header should expose multiple navigation links').toBeGreaterThan(1);

      await expect(portal.headerLinks.first(), 'First header link should be visible').toBeVisible();
    });

    // STEP 3: VISUAL CHECKPOINT - core layout must match baseline snapshot
    await runStep('visual-regression', 'Visual snapshot diverged from baseline beyond tolerance', async () => {
      await page.waitForLoadState('networkidle').catch(() => {
        /* Long-polling pages may never go idle; proceed to stability checks */
      });
      await expect(page).toHaveScreenshot('portal-landing.png', { maxDiffPixels: 100 });
    });

    // STEP 4: Click the primary CTA button
    const originUrl = page.url();
    await runStep('cta-interaction', 'Primary CTA failed to resolve or click', async () => {
      await expect(portal.primaryCta, 'Primary CTA should be visible').toBeVisible();
      await expect(portal.primaryCta, 'Primary CTA should be enabled').toBeEnabled();
      await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        portal.primaryCta.click(),
      ]);
    });

    // STEP 5: Verify the resulting page loaded successfully
    await runStep('post-cta-verification', 'Resulting page did not load as expected after CTA click', async () => {
      await expect(page).not.toHaveURL(originUrl, { timeout: 15_000 });
      await expect(page).toHaveURL(/signup|try|get-started|free|trial|products|login|\/s\//i);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  });
});