import { test, expect } from '@playwright/test';

test.describe('ContextIQ Demo Regression Suite', () => {
  test('Verify Checkout Primary Submit Button Selector', async ({ page }) => {
    const baseUrl = process.env.TEST_BASE_URL || 'https://atlassian.com';
    console.log(`[ContextIQ-Info] Navigating to target portal: ${baseUrl}`);
    
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    // Intentional selector mismatch to simulate a frontend breaking change
    // Simulates a developer renaming '#login-btn' to '#submit-login' without updating QA selectors
    const brokenSelector = '#checkout-submit-v1';
    
    try {
      console.log(`[ContextIQ-Info] Attempting to locate primary action button: ${brokenSelector}`);
      const submitButton = page.locator(brokenSelector);
      await expect(submitButton, `Expected primary button ${brokenSelector} to be visible on viewport`).toBeVisible({ timeout: 3000 });
      await submitButton.click();
    } catch (error) {
      console.error(`[ContextIQ-Error] stage="selector-resolution" message="DOM element ${brokenSelector} missing or renamed" url="${baseUrl}"`);
      throw error;
    }
  });
});
