import { expect, test, type Browser } from '@playwright/test';
import { openDemoArchive } from './helpers';

/**
 * The family growth loop, in a real browser.
 *
 * A relative asks, the storyteller decides, the relative sees what they were
 * given — and what they were not. The parts that matter most here are the
 * refusals: a declined question that says nothing, and an inbox that a family
 * member cannot open.
 */

/**
 * Asks a question as the family member, in their own browser.
 *
 * Each storyteller test creates the question it needs rather than relying on
 * one being left over. A test that only checks something when earlier tests
 * happen to leave the right state behind is a test that silently stops
 * checking — and `test.skip` on an empty inbox hides exactly that.
 */
async function askAs(browser: Browser, archiveId: string, body: string): Promise<void> {
  const context = await browser.newContext({ storageState: 'tests/e2e/.auth/family.json' });
  const page = await context.newPage();
  await page.goto(`/archives/${archiveId}/questions`);
  await page.getByLabel('What would you like to ask?').fill(body);
  await page.getByRole('button', { name: 'Send this question' }).click();
  await expect(page.getByText('Sent. It is in their own time now.')).toBeVisible({
    timeout: 15000,
  });
  await context.close();
}

test.describe('a family member asks the storyteller', () => {
  test.use({ storageState: 'tests/e2e/.auth/family.json' });

  test('sends a question and sees it waiting', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/questions`);

    // Who this reaches, and who decides, before the box.
    await expect(page.getByText(/decides what happens to this/)).toBeVisible();
    await expect(page.getByText(/Nobody else in the family can see it/)).toBeVisible();

    const question = `What was the courtyard like in the mornings? ${Date.now()}`;
    await page.getByLabel('What would you like to ask?').fill(question);
    await page.getByRole('button', { name: 'Send this question' }).click();

    await expect(page.getByText('Sent. It is in their own time now.')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(question)).toBeVisible();
    await expect(page.getByText('waiting').first()).toBeVisible();
  });

  test('cannot open the storyteller’s inbox', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    const response = await page.goto(`/archives/${archiveId}/inbox`);
    // Either the route refuses outright, or it renders nothing answerable.
    if (response && response.status() < 400) {
      await expect(page.getByRole('button', { name: 'Answer this' })).toHaveCount(0);
    }
  });

  test('is not offered the inbox in the navigation', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}`);
    await expect(page.getByRole('link', { name: 'Questions for you' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Ask the storyteller' })).toBeVisible();
  });
});

test.describe('the storyteller decides', () => {
  test.use({ storageState: 'tests/e2e/.auth/storyteller.json' });

  test('sees what was asked, and that answering adds nothing on its own', async ({
    page,
    browser,
  }) => {
    const archiveId = await openDemoArchive(page);
    await askAs(browser, archiveId, `Where did you buy the vegetables? ${Date.now()}`);
    await page.goto(`/archives/${archiveId}/inbox`);

    await expect(page.getByText('These are yours to answer or not')).toBeVisible();
    await expect(page.getByText(/adds nothing to your archive on its own/)).toBeVisible();

    // Saying no is offered at the same weight as saying yes.
    const first = page.locator('.card').filter({ hasText: 'Asked by' }).first();
    await expect(first.getByRole('button', { name: 'Answer this' })).toBeVisible();
    await expect(first.getByRole('button', { name: 'Not now' })).toBeVisible();
    await expect(first.getByRole('button', { name: 'I would rather not' })).toBeVisible();
  });

  test('answers one, chooses who sees it, and is shown what it suggested', async ({
    page,
    browser,
  }) => {
    const archiveId = await openDemoArchive(page);
    await askAs(browser, archiveId, `What was the courtyard like? ${Date.now()}`);
    await page.goto(`/archives/${archiveId}/inbox`);

    const first = page.locator('.card').filter({ hasText: 'Asked by' }).first();
    await first.getByRole('button', { name: 'Answer this' }).click();
    await expect(page.getByRole('group', { name: 'Who should see this?' })).toBeVisible();
    await page.getByRole('radio', { name: /Just .*, who asked/ }).check();

    await page
      .getByLabel('Your answer')
      .fill(
        'The courtyard had a neem tree my mother planted the year we arrived in Pune, and the ' +
          'mornings smelled of cardamom from the kitchen window.',
      );
    await page.getByRole('button', { name: 'Send this answer' }).click();

    // It moves to decided, and the suggestions it produced are offered for
    // review rather than added.
    await expect(page.getByRole('heading', { name: 'Already decided' })).toBeVisible();
    await expect(page.getByRole('link', { name: /suggestion.* to review/ }).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('keeps a private note private to this screen', async ({ page, browser }) => {
    const archiveId = await openDemoArchive(page);
    await askAs(browser, archiveId, `Did you keep in touch with anyone? ${Date.now()}`);
    await page.goto(`/archives/${archiveId}/inbox`);

    const first = page.locator('.card').filter({ hasText: 'Asked by' }).first();
    await first.getByText('Add a private note about why (optional)').click();
    await expect(first.getByText(/never sent to/)).toBeVisible();
    await first.locator('textarea').last().fill('Not something I want to go into.');
    await first.getByRole('button', { name: 'I would rather not' }).click();

    // `.first()` because repeated runs accumulate declined questions in the
    // demonstration archive, and each carries the same note.
    await expect(
      page.getByText('Your private note: Not something I want to go into.').first(),
    ).toBeVisible({ timeout: 15000 });
  });
});

test.describe('what the asker is told about a refusal', () => {
  test.use({ storageState: 'tests/e2e/.auth/family.json' });

  test('sees that it was closed, and never why', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/questions`);

    const closed = page.locator('.card').filter({ hasText: 'closed' }).first();
    await expect(closed).toBeVisible();
    await expect(closed.getByText(/That is theirs to decide/)).toBeVisible();
    // The storyteller's private note reaches this page in no form at all.
    await expect(page.getByText('Not something I want to go into.')).toHaveCount(0);
    await expect(page.getByText(/private note/i)).toHaveCount(0);
  });
});
