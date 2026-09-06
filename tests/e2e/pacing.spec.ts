import { test, expect } from '@playwright/test';
import { ACCOUNTS, signIn, openDemoArchive } from './helpers';

/**
 * Reaching help, from anywhere, without anything having read the person.
 *
 * The two properties are equally important and pull in opposite directions.
 * It has to be genuinely reachable — one action, from every screen, including
 * the ones somebody is most likely to be on when they need it. And it has to
 * be unconditional, because the alternative is a product that decides somebody
 * is struggling, which requires reading their state to decide.
 */
test.describe('crisis resources', () => {
  test.use({ storageState: 'tests/e2e/.auth/family.json' });

  test('are one action from any screen, and never interrupt', async ({ page }) => {
    const archiveId = await openDemoArchive(page);

    for (const path of ['', '/memories', '/ask', '/listen', '/timeline']) {
      await page.goto(`/archives/${archiveId}${path}`);

      const link = page.getByRole('link', { name: 'If you need help now' });
      await expect(link).toBeVisible();

      // Never a dialog. An interruption that has to be dismissed is the one
      // shape this must not take.
      expect(await page.getByRole('dialog').count()).toBe(0);
      expect(await page.getByRole('alertdialog').count()).toBe(0);
    }

    await page.getByRole('link', { name: 'If you need help now' }).click();
    await page.waitForURL(/\/support#help-now/);

    // What they came for, at the top, not after three cards about retention.
    const card = page.locator('#help-now');
    await expect(card).toBeVisible();
    await expect(card).toContainText('emergency');
    await expect(card).toContainText('watched for signs of distress');
  });
});

test.describe('nothing counts anything at anybody', () => {
  test('no streak, score or progress on the screens a bereaved person uses', async ({ page }) => {
    await signIn(page, ACCOUNTS.family);
    const archiveId = await openDemoArchive(page);

    for (const path of ['', '/memories', '/timeline', '/gaps']) {
      await page.goto(`/archives/${archiveId}${path}`);
      const body = (await page.locator('body').innerText()).toLowerCase();
      for (const word of ['streak', 'day in a row', 'keep it up', '% complete', 'progress bar']) {
        expect(body, `${path} should not contain "${word}"`).not.toContain(word);
      }
    }
  });
});
