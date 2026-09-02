import { expect, test } from '@playwright/test';
import { openDemoArchive } from './helpers';

/**
 * Capsules, in a real browser.
 *
 * The assertions are about the promise people find hardest to believe: that
 * sharing can be taken back, and that the one thing it cannot take back is
 * said out loud at the moment of the decision.
 */

test.describe('the storyteller makes and withdraws a capsule', () => {
  test.use({ storageState: 'tests/e2e/.auth/storyteller.json' });

  test('says what a capsule can and cannot do, before making one', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/capsules`);

    await expect(
      page.getByText('A capsule never shares more than your permissions allow'),
    ).toBeVisible();
    await expect(page.getByText(/only stories you have approved/)).toBeVisible();
    // The honest limit, stated up front rather than discovered.
    await expect(page.getByText(/cannot undo is a copy somebody already downloaded/)).toBeVisible();
  });

  test('warns at the moment of the download decision, not in a help page', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/capsules`);
    await page.getByRole('button', { name: 'Make a capsule' }).click();

    await expect(page.getByRole('checkbox', { name: /Let them keep a copy/ })).toBeVisible();
    await expect(
      page.getByText('A copy stays with them even if you withdraw the capsule later.'),
    ).toBeVisible();
  });

  test('makes one, then withdraws it', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/capsules`);
    await page.getByRole('button', { name: 'Make a capsule' }).click();

    const title = `For Anjali ${Date.now()}`;
    await page.getByLabel('What to call it').fill(title);

    // One story and one person, both chosen explicitly — there is no
    // "everything" and no "everyone".
    await page.getByRole('group', { name: 'Which stories?' }).getByRole('checkbox').first().check();
    await page.getByRole('group', { name: 'Who is it for?' }).getByRole('checkbox').first().check();

    await page.getByRole('button', { name: 'Make this capsule' }).click();
    const card = page.locator('.card').filter({ hasText: title });
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card.getByText('active')).toBeVisible();

    await card.getByRole('button', { name: 'Withdraw this' }).click();
    await expect(page.locator('.card').filter({ hasText: title }).getByText('revoked')).toBeVisible(
      { timeout: 15000 },
    );
  });

  test('shows opens and refusals together', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/capsules`);

    const first = page
      .locator('.card')
      .filter({ hasText: /\d+ (story|stories)/ })
      .first();
    await first.getByRole('link', { name: 'Who has opened it' }).click();

    await expect(page.getByRole('heading', { name: 'Who has opened it' })).toBeVisible();
    await expect(page.getByText(/every time somebody was turned away/)).toBeVisible();
  });
});

test.describe('a family member', () => {
  test.use({ storageState: 'tests/e2e/.auth/family.json' });

  test('is not offered a way to make one', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/capsules`);
    await expect(page.getByRole('button', { name: 'Make a capsule' })).toHaveCount(0);
  });
});
