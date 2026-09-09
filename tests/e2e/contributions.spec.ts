import { expect, test } from '@playwright/test';
import { openDemoArchive } from './helpers';

/**
 * The contributor loop, in a real browser.
 *
 * The assertions that carry the weight are about consequences being stated
 * before a decision, not after it: a contributor told that nothing they send
 * changes the archive, and a storyteller told exactly what accepting a
 * disagreement will and will not do.
 */

test.describe('a contributor adds what they know', () => {
  test.use({ storageState: 'tests/e2e/.auth/contributor.json' });

  test('is told nothing they send changes the archive', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/contribute`);

    await expect(page.getByText('Nothing here changes the archive')).toBeVisible();
    await expect(page.getByText(/never replaced by it/)).toBeVisible();
  });

  test('is asked how they know, and why that matters', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/contribute`);

    await expect(page.getByRole('group', { name: 'How do you know this?' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /I was there/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Somebody told me/ })).toBeVisible();
    await expect(page.getByText(/stops second-hand stories becoming/)).toBeVisible();
  });

  test('sends a suggestion and sees it waiting', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/contribute`);

    const title = `The corner shop ${Date.now()}`;
    await page.getByLabel('A short name for it').fill(title);
    await page
      .getByLabel('What you want to say')
      .fill('There was a shop on the corner that sold sweets by weight in paper cones.');
    await page.getByRole('button', { name: 'Send this suggestion' }).click();

    await expect(page.getByText('Sent for them to look at.')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(title)).toBeVisible();
  });

  test('says plainly what a different recollection will do', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/contribute`);

    await page.getByLabel('What would you like to add?').selectOption('alternate_account');
    await expect(
      page.getByText(/Nothing is replaced\. Your account is added beside theirs/),
    ).toBeVisible();
  });

  test('is never offered a decision on their own suggestion', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/proposals`);

    // They can see what they sent and what became of it — the review trail is
    // part of trusting the archive — but the decision is not theirs to make,
    // and offering a button the API will refuse is a broken promise.
    await expect(page.getByRole('button', { name: 'Accept this' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'No, leave it as it is' })).toHaveCount(0);
    await expect(page.getByText('Waiting for the storyteller to decide.').first()).toBeVisible();
  });
});

test.describe('the storyteller reviews', () => {
  test.use({ storageState: 'tests/e2e/.auth/storyteller.json' });

  test('is shown what accepting a disagreement does, and does not', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/proposals`);

    await expect(
      page.getByText('Nothing here has changed your archive', { exact: true }),
    ).toBeVisible();

    const disagreement = page
      .locator('.card')
      .filter({ hasText: 'this disagrees with something you said' })
      .first();
    await expect(disagreement).toBeVisible();
    await expect(
      disagreement.getByText(/adds their account beside yours and links the two/),
    ).toBeVisible();
    await expect(disagreement.getByText(/Nothing you said is changed or removed/)).toBeVisible();
  });

  test('sees what their archive says now, beside the suggestion', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/proposals`);

    const disagreement = page
      .locator('.card')
      .filter({ hasText: 'this disagrees with something you said' })
      .first();
    await expect(
      disagreement.getByRole('heading', { name: 'What your archive says now' }),
    ).toBeVisible();
    await expect(disagreement.locator('blockquote')).toBeVisible();
  });

  test('sees whether the contributor was there or was told', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/proposals`);

    const first = page.locator('.card').filter({ hasText: 'How they know' }).first();
    await expect(first).toBeVisible();
    await expect(first.getByText(/They were there\.|Somebody told them\./)).toBeVisible();
  });

  test('accepts one, and it moves to decided', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/proposals`);

    const first = page.locator('.card').filter({ hasText: 'How they know' }).first();
    await first.getByRole('button', { name: 'Accept this' }).click();

    await expect(page.getByRole('heading', { name: 'Already decided' })).toBeVisible();
    await expect(page.getByText('approved').first()).toBeVisible({ timeout: 15000 });
  });
});
