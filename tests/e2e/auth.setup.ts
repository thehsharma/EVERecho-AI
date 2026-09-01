import { test as setup } from '@playwright/test';
import { ACCOUNTS, DEMO_PASSWORD } from './helpers';

/**
 * Signs in each demonstration account once and saves the session.
 *
 * Signing in inside every test hammers the auth rate limiter, which is doing
 * exactly what it should — the fix belongs in the suite, not in the limiter.
 */
for (const [role, email] of Object.entries(ACCOUNTS)) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/archives/);
    await page.context().storageState({ path: `tests/e2e/.auth/${role}.json` });
  });
}
