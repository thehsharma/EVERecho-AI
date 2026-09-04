import { expect, test } from '@playwright/test';
import { openDemoArchive } from './helpers';

/**
 * The coverage radar, from the storyteller's side.
 *
 * Most of these check what the screen must never do. The failure mode here is
 * not a broken button; it is a screen that works perfectly and makes somebody
 * feel behind on their own life.
 */

test.describe('things you might like to say more about', () => {
  test.use({ storageState: 'tests/e2e/.auth/storyteller.json' });

  /**
   * The first question on the page.
   *
   * Two of these tests consume one permanently — that is what "never ask
   * again" means — and the suite runs twice, once per viewport. So the
   * demonstration archive is seeded with several, and this fails loudly rather
   * than skipping if they have all been used up: a suite that quietly stops
   * checking is worse than one that says the fixture needs reseeding.
   */
  const firstQuestion = async (page: import('@playwright/test').Page) => {
    const card = page.locator('.card').first();
    await expect(
      card,
      'no coverage questions left in the demonstration archive — run pnpm db:seed',
    ).toBeVisible();
    return card;
  };

  test('shows questions about the archive, and never a score', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/gaps`);

    await expect(page.getByRole('heading', { name: 'Say more', level: 1 })).toBeVisible();
    await expect(page.getByText('This is not a checklist')).toBeVisible();
    await firstQuestion(page);

    // No measure of any kind: no percentage, no fraction, no "N remaining",
    // no streak. Asserted on the whole page, because a score in the navigation
    // or a badge would be exactly as bad as one in the list.
    const text = (await page.locator('main').innerText()).toLowerCase();
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/\d+\s+of\s+\d+/);
    expect(text).not.toMatch(/\d+\s+(?:remaining|left|to go|answered|unanswered)/);
    expect(text).not.toMatch(/streak/);

    // The words themselves are allowed only where the page is denying them —
    // "there is no score here" is the promise, and matching the bare word
    // would forbid making it. So they must not appear on a question card.
    const cards = await page.locator('.card').allInnerTexts();
    for (const card of cards) {
      expect(card.toLowerCase()).not.toMatch(/complete|progress|score|remaining/);
    }
  });

  test('offers “never ask again” at the same weight as answering', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/gaps`);

    const card = await firstQuestion(page);
    await expect(card.getByRole('button', { name: 'Say more' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Not now' })).toBeVisible();
    const never = card.getByRole('button', { name: 'Never ask again' });
    await expect(never).toBeVisible();

    // Same class, so the same visual weight: a "no" that is styled quieter
    // than the "yes" beside it is not really being offered.
    const [yes, no] = await Promise.all([
      card.getByRole('button', { name: 'Say more' }).getAttribute('class'),
      never.getAttribute('class'),
    ]);
    expect(no).not.toBe(null);
    expect(yes).not.toBe(no);
    expect(no).toContain('btn');
  });

  test('a question put away for good does not come back', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/gaps`);

    const card = await firstQuestion(page);
    const prompt = (await card.getByRole('heading').first().innerText()).trim();
    await card.getByRole('button', { name: 'Never ask again' }).click();

    await expect(page.getByRole('heading', { name: prompt })).toBeHidden({ timeout: 15000 });

    // And it stays gone across a reload, where detection runs again.
    await page.reload();
    await expect(page.getByRole('heading', { name: prompt })).toBeHidden();
  });

  test('answering keeps the words and adds nothing without a decision', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/gaps`);

    const card = await firstQuestion(page);
    await card.getByRole('button', { name: 'Say more' }).click();

    const box = card.getByLabel('Your answer');
    await expect(box).toBeVisible();
    // Said at the point of the decision, not in a help page somewhere.
    await expect(card.getByText(/nothing is added until you approve it/i)).toBeVisible();

    await box.fill('That was Shanta, who ran the shop below us. She kept the key for years.');
    await card.getByRole('button', { name: 'Save this' }).click();

    await expect(page.getByText('Saved as a source in your archive')).toBeVisible({
      timeout: 15000,
    });
  });
});

test.describe('what the radar is not', () => {
  test('nobody but the storyteller is offered it', async ({ browser }) => {
    // What an archive does not say about somebody is nobody else's business.
    // A family member who could read this list could use it to chase them.
    for (const account of ['family', 'contributor']) {
      const context = await browser.newContext({
        storageState: `tests/e2e/.auth/${account}.json`,
      });
      const page = await context.newPage();
      const archiveId = await openDemoArchive(page);

      await expect(page.getByRole('link', { name: 'Say more' })).toHaveCount(0);

      const response = await page.goto(`/archives/${archiveId}/gaps`);
      expect(response?.status()).toBeGreaterThanOrEqual(400);
      await context.close();
    }
  });
});
