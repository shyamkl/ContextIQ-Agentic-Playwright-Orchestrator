import { test, expect, Page } from '@playwright/test';

/**
 * ContextIQ: Agentic Playwright Orchestrator
 * File: tests/e2e-pipeline.spec.ts
 */

const DEFAULT_BASE_URL = 'https://atlassian.com';
const LOG_PREFIX = '[ContextIQ-Error]';

const TARGET_BASE_URL: string = process.env.TEST_BASE_URL?.trim() || DEFAULT_BASE_URL;

/** Root domain of the target; used to ignore third-party network noise in logs */
const TARGET_ROOT_DOMAIN = new URL(TARGET_BASE_URL).hostname.replace(/^www\./, '');

/** Third-party trackers/ads that slow pages and destabilize screenshots */
const BLOCKED_THIRD_PARTY =
  /googleadservices|google-analytics|googletagmanager|doubleclick|google\.[a-z.]+\/(pagead|ads)|pointmediatracker|techtarget|facebook\.net|linkedin\.com\/px|bat\.bing|hotjar|segment\.(io|com)/i;

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

async function runStep<T>(stage: string, failureMessage: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    logDiagnostic(stage, failureMessage, error);
    throw error;
  }
}

class PortalPage {
  constructor(private readonly page: Page) {}

  get headerNavigation() {
    return this.page.getByRole('navigation').first();
  }

  get headerLinks() {
    return this.headerNavigation.getByRole('link');
  }

  get primaryCta() {
    return this.page
      .getByRole('link', { name: /get it free|try for free|get started|start free/i })
      .first();
  }

  async open(): Promise<void> {
    await this.page.goto('/', { waitUntil: 'commit', timeout: 45_000 });
  }

  async dismissCookieBannerIfPresent(): Promise<void> {
    const consentButton = this.page
      .getByRole('button', { name: /accept|agree|allow all|got it/i })
      .first();
    try {
      await consentButton.waitFor({ state: 'visible', timeout: 3_000 });
      await consentButton.click();
    } catch {
      // Non-critical: banner may not exist in this region/session.
    }
  }
}

test.describe('ContextIQ E2E Pipeline', () => {
  test.beforeAll(() => {
    console.info(
      `[ContextIQ-Info] Environment routing active. Target Base URL: ${TARGET_BASE_URL} ` +
        `(source: ${process.env.TEST_BASE_URL ? 'TEST_BASE_URL' : 'default'})`
    );
  });

  test.use({
    baseURL: TARGET_BASE_URL,
    viewport: { width: 1440, height: 900 },
  });

  test.beforeEach(async ({ page }) => {
    // Block trackers and autoplay media: faster loads, deterministic screenshots
    await page.route('**/*', (route) => {
      const request = route.request();
      if (request.resourceType() === 'media' || BLOCKED_THIRD_PARTY.test(request.url())) {
        return route.abort();
      }
      return route.continue();
    });

    page.on('pageerror', (error) => {
      console.error(`${LOG_PREFIX} stage="browser-runtime" message="Uncaught page exception" detail="${error.message}"`);
    });

    page.on('requestfailed', (request) => {
      const reason = request.failure()?.errorText ?? 'unknown';
      let host = '';
      try {
        host = new URL(request.url()).hostname;
      } catch {
        /* ignore malformed URLs */
      }
      // Only report first-party failures; skip aborted requests (normal browser behavior)
      if (!host.endsWith(TARGET_ROOT_DOMAIN) || reason === 'net::ERR_ABORTED') return;
      console.error(
        `${LOG_PREFIX} stage="network" message="First-party request failed" ` +
          `url="${request.url().slice(0, 200)}" reason="${reason}"`
      );
    });
  });

  test('portal navigation, CTA flow, and visual baseline', async ({ page }) => {
    // Visual rendering across engines needs more headroom than the 30s global default
    test.setTimeout(60_000);

    const portal = new PortalPage(page);

    // STEP 1: Navigate
    await runStep('navigation', 'Portal failed to load from the resolved Base URL', async () => {
      await portal.open();
      await expect(page).toHaveURL(/^https?:\/\//);
      await portal.dismissCookieBannerIfPresent();
    });

    // STEP 2: Header navigation visibility
    await runStep('header-assertions', 'Target locator failed to resolve on viewport', async () => {
      await expect(portal.headerNavigation, 'Primary navigation should be visible').toBeVisible({ timeout: 10_000 });

      const linkCount = await portal.headerLinks.count();
      expect(linkCount, 'Navigation should expose multiple links').toBeGreaterThan(1);

      await expect(portal.headerLinks.first(), 'First navigation link should be visible').toBeVisible();
    });

    // STEP 3: Visual checkpoint
    await runStep('visual-regression', 'Visual snapshot diverged from baseline beyond tolerance', async () => {
      // Short, bounded wait; never rely on full network idle on a tracker-heavy site
      await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});

      await expect(portal.headerNavigation).toHaveScreenshot('portal-landing.png', {
        maxDiffPixels: 100,
        animations: 'disabled',
        mask: [page.locator('video')],
        timeout: 20_000,
      });
    });

    // STEP 4: Primary CTA
    const originUrl = page.url();
    await runStep('cta-interaction', 'Primary CTA failed to resolve or click', async () => {
      await expect(portal.primaryCta, 'Primary CTA should be visible').toBeVisible();
      await expect(portal.primaryCta, 'Primary CTA should be enabled').toBeEnabled();
      await portal.primaryCta.click();
    });

    // STEP 5: Post-CTA verification
    await runStep('post-cta-verification', 'Resulting page did not load as expected after CTA click', async () => {
      await expect(page).not.toHaveURL(originUrl, { timeout: 15_000 });
      await expect(page).toHaveURL(/signup|try|get-started|free|trial|products|login|\/s\//i);
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  });
});