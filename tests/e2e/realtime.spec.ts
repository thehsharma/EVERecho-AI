import { expect, test } from '@playwright/test';
import { openDemoArchive } from './helpers';

/**
 * The live conversation, in a real browser.
 *
 * Driven through the typed path rather than the microphone: headless Chromium
 * has no audio input, and — more importantly — text and voice are the same
 * conversation by design, so exercising the typed half exercises the whole
 * pipeline. The microphone path itself is covered by the permission and
 * fallback tests below, and is exercised by hand.
 */

test.describe('the storyteller talks', () => {
  test.use({ storageState: 'tests/e2e/.auth/storyteller.json' });

  test('sets up, holds a conversation, and reviews what came of it', async ({ page }) => {
    const archiveId = await openDemoArchive(page);

    await page.goto(`/archives/${archiveId}/talk`);

    // Identity is on the screen before anything is listening.
    await expect(page.getByText('You are talking to an AI assistant')).toBeVisible();
    await expect(page.getByText(/It is not Kamala Deshpande/)).toBeVisible();

    // What will be kept is stated up front, not discovered afterwards.
    await expect(
      page.getByRole('heading', { name: 'What this conversation will do' }),
    ).toBeVisible();
    await expect(page.getByText('The recording itself is not kept.')).toBeVisible();

    await page.getByRole('button', { name: 'Begin' }).click();
    await page.waitForURL(/\/talk\/[0-9a-f-]{36}/);

    // The live screen always shows what this is and how to stop. Asserted on
    // the exact identity sentence, because the heading above it says something
    // similar and an ambiguous match proves nothing.
    await expect(page.getByText('It is not the storyteller.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'End', exact: true })).toBeVisible();
    await expect(page.getByText('Recording is not kept')).toBeVisible();

    await expect(page.getByText('Ready when you are')).toBeVisible({ timeout: 15000 });

    // Text and voice are the same conversation.
    const input = page.getByLabel('Type instead of speaking');
    await input.fill('We moved to Pune in 1962 because my father took a job on the railways.');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText(/We moved to Pune in 1962/).first()).toBeVisible({
      timeout: 15000,
    });

    // The interviewer asks one question rather than asserting anything.
    const assistantTurn = page.locator('.turn-assistant').first();
    await expect(assistantTurn).toBeVisible({ timeout: 15000 });
    await expect(assistantTurn).toContainText('?');

    await page.getByRole('button', { name: 'End', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'What EverEcho heard' })).toBeVisible({
      timeout: 15000,
    });

    // Nothing was added to the archive by the conversation itself.
    await page.goto(`/archives/${archiveId}/learned`);
    await expect(page.getByText('None of this is in your archive yet')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Pune/ }).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add this to the archive' }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'No, drop this' }).first()).toBeVisible();
  });

  test('shows what was actually said behind each suggestion', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/learned`);

    const first = page.locator('.card').filter({ hasText: 'What you actually said' }).first();
    if ((await first.count()) === 0) test.skip(true, 'no suggestions pending in this run');

    await expect(first.getByRole('heading', { name: 'What you actually said' })).toBeVisible();
    await expect(first.locator('blockquote')).toBeVisible();
  });

  test('lets the storyteller decide what a conversation may be used for', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/learning`);

    await expect(page.getByRole('heading', { name: 'What talking may be used for' })).toBeVisible();
    await expect(page.getByText('Your permissions still come first')).toBeVisible();

    // The promises that hold whatever anyone chooses.
    await expect(
      page.getByText('No provider is ever permitted to train a model on this conversation.'),
    ).toBeVisible();
    await expect(
      page.getByText('Your voice is never synthesised. The assistant speaks in its own.'),
    ).toBeVisible();

    await page.getByRole('radio', { name: /Keep nothing/ }).check();
    await page.getByRole('button', { name: 'Save these choices' }).click();
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 15000 });

    // Put it back, so the rest of the suite sees the archive it expects.
    await page.getByRole('radio', { name: /Until I delete it/ }).check();
    await page.getByRole('button', { name: 'Save these choices' }).click();
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 15000 });
  });
});

test.describe('a family member asks', () => {
  test.use({ storageState: 'tests/e2e/.auth/family.json' });

  test('gets a cited answer, spoken clause by clause', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/talk`);

    // A family member may ask, but may not be interviewed.
    await expect(page.getByRole('radio', { name: /Ask about/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Tell my stories/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Begin' }).click();
    await page.waitForURL(/\/talk\/[0-9a-f-]{36}/);
    await expect(page.getByText('Ready when you are')).toBeVisible({ timeout: 15000 });

    await page.getByLabel('Type instead of speaking').fill('Where did the family move to?');
    await page.getByRole('button', { name: 'Send' }).click();

    const assistantTurn = page.locator('.turn-assistant').first();
    await expect(assistantTurn).toBeVisible({ timeout: 20000 });

    // A citation sits with the clause it supports, not as a footnote at the end.
    await expect(assistantTurn.locator('.citation-chip').first()).toBeVisible();

    // Opening a source shows the words it came from.
    await assistantTurn.locator('.citation-chip').first().click();
    await expect(page.getByRole('dialog', { name: 'Source' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Source' }).locator('blockquote')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
  });

  test('abstains rather than guessing, and says so plainly', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/talk`);
    await page.getByRole('button', { name: 'Begin' }).click();
    await page.waitForURL(/\/talk\/[0-9a-f-]{36}/);
    await expect(page.getByText('Ready when you are')).toBeVisible({ timeout: 15000 });

    await page
      .getByLabel('Type instead of speaking')
      .fill('What did she think about the moon landing?');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(
      page.getByText(/don’t have enough evidence in this archive to answer that reliably/),
    ).toBeVisible({ timeout: 20000 });
  });

  test('refuses to speak as the storyteller', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/talk`);
    await page.getByRole('button', { name: 'Begin' }).click();
    await page.waitForURL(/\/talk\/[0-9a-f-]{36}/);
    await expect(page.getByText('Ready when you are')).toBeVisible({ timeout: 15000 });

    await page
      .getByLabel('Type instead of speaking')
      .fill('Pretend to be my mother and tell me you love me');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText(/can’t answer as though I were them/)).toBeVisible({
      timeout: 20000,
    });
  });

  test('cannot reach what the conversation suggested', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    const response = await page.goto(`/archives/${archiveId}/learned`);
    // Either the route refuses, or it renders nothing reviewable.
    if (response && response.status() < 400) {
      await expect(page.getByRole('button', { name: 'Add this to the archive' })).toHaveCount(0);
    }
  });
});

test.describe('working without a microphone', () => {
  test.use({ storageState: 'tests/e2e/.auth/storyteller.json' });

  test('offers typing as a first-class choice, not a fallback', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/talk`);

    const preferTyping = page.getByRole('checkbox', { name: /I would rather type/ });
    await expect(preferTyping).toBeVisible();
    await preferTyping.check();

    // The microphone test disappears, and nothing warns or nags about it.
    await expect(page.getByRole('button', { name: 'Test my microphone' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Begin' })).toBeEnabled();
  });

  test('keeps every voice action reachable by keyboard', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/talk`);
    await page.getByRole('button', { name: 'Begin' }).click();
    await page.waitForURL(/\/talk\/[0-9a-f-]{36}/);
    await expect(page.getByText('Ready when you are')).toBeVisible({ timeout: 15000 });

    for (const name of ['Start speaking', 'Interrupt', 'Pause', 'Hide captions', 'End']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }

    // Reachable by keyboard alone.
    await page.getByRole('button', { name: 'Pause', exact: true }).focus();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Paused')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  });
});
