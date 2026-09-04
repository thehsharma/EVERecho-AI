import { expect, test } from '@playwright/test';
import { openDemoArchive } from './helpers';

/**
 * What should happen after.
 *
 * The screen asks somebody to think about their own death, and the tests are
 * mostly about tone: that refusing is offered at the same weight as
 * permitting, that nothing implies anything happens now, and that the one
 * question the product cannot answer for them is asked rather than assumed.
 */

test.describe('the storyteller decides what happens after', () => {
  test.use({ storageState: 'tests/e2e/.auth/storyteller.json' });

  test('asks the question it cannot answer, and offers both answers equally', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/remembrance`);

    await expect(page.getByRole('heading', { name: 'After', level: 1 })).toBeVisible();
    await expect(page.getByText('Nothing here happens while you are alive')).toBeVisible();

    // Both answers are buttons of the same kind, in the same row. A product
    // that styles "keep it closed" as the quiet option is not really offering it.
    const permit = page.getByRole('button', { name: 'Let them have it' });
    const withhold = page.getByRole('button', { name: 'Keep it closed' });
    await expect(permit).toBeVisible();
    await expect(withhold).toBeVisible();

    // And it says outright that it will not choose.
    await expect(page.getByText(/we will not choose one for you/i)).toBeVisible();
  });

  test('records a decision and lets it be changed again', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/remembrance`);

    await page.getByRole('button', { name: 'Keep it closed' }).click();
    await expect(page.getByRole('button', { name: 'Add something specific' })).toBeVisible({
      timeout: 15000,
    });

    // Changing your mind is a click, not a support request.
    await page.getByRole('button', { name: 'Let them have it' }).click();
    await expect(page.getByRole('button', { name: 'Add something specific' })).toBeVisible({
      timeout: 15000,
    });
  });

  test('takes a refusal about one subject, and shows it as a refusal', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/remembrance`);
    await page.getByRole('button', { name: 'Let them have it' }).click();
    await page.getByRole('button', { name: 'Add something specific' }).click();

    await expect(page.getByRole('group', { name: /want them to have/i })).toBeVisible();
    await page.getByLabel('Keep this closed').check();
    await page.getByLabel('A subject').check();
    await page.getByLabel('Which subject?').fill(`money ${Date.now()}`);
    await page.getByRole('button', { name: 'Add this' }).click();

    await expect(page.getByText('kept closed').first()).toBeVisible({ timeout: 15000 });
  });

  test('a refusal cannot be given an end date', async ({ page }) => {
    // "Not before" appears only for a permission. A refusal that opens later
    // is a permission wearing a refusal's clothes, and the interface must not
    // even offer the shape.
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/remembrance`);
    await page.getByRole('button', { name: 'Add something specific' }).click();

    await page.getByLabel('They may have it').check();
    await expect(page.getByLabel('Not before (optional)')).toBeVisible();

    await page.getByLabel('Keep this closed').check();
    await expect(page.getByLabel('Not before (optional)')).toHaveCount(0);
    await expect(page.getByText(/stays closed/i)).toBeVisible();
  });

  test('offers the recording and the words as two separate choices', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/remembrance`);
    await page.getByRole('button', { name: 'Add something specific' }).click();
    await page.getByLabel('They may have it').check();

    await expect(
      page.getByLabel('They may hear the recording, not only read the words'),
    ).toBeVisible();
    await expect(page.getByText(/happy to be quoted and would rather their voice/i)).toBeVisible();
  });
});

test.describe('what the family sees', () => {
  test.use({ storageState: 'tests/e2e/.auth/family.json' });

  test('can read what was decided, and cannot change any of it', async ({ page }) => {
    // Being refused without being told a decision exists is how people
    // conclude the software is hiding something.
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/remembrance`);

    await expect(page.getByRole('heading', { name: 'After', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add something specific' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Let them have it' })).toBeDisabled();
  });
});

test.describe('hearing their voice', () => {
  test.use({ storageState: 'tests/e2e/.auth/family.json' });

  test('says what it will and will not do before anybody asks', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/listen`);

    await expect(page.getByRole('heading', { name: 'Listen', level: 1 })).toBeVisible();
    // Nobody should be surprised by a refusal, so the boundary is on the page
    // before the first question rather than in the answer to it.
    await expect(page.getByText(/will not read anything aloud in their voice/i)).toBeVisible();
    await expect(page.getByText(/will not guess what they might have said/i)).toBeVisible();
  });

  test('refuses to speak as them, and offers what is actually there', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/listen`);

    await page.getByLabel(/What would you like to hear/i).fill('What would she say to me now?');
    await page.getByRole('button', { name: 'Find it' }).click();

    const archiveVoice = page.locator('.notice-info[role="status"]').last();
    await expect(archiveVoice).toContainText('can’t speak as them', { timeout: 15000 });
    // Not only a refusal: it names the thing that does exist.
    await expect(archiveVoice).toContainText('what they actually said');
  });

  test('says it has nothing rather than playing something adjacent', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/listen`);

    await page.getByLabel(/What would you like to hear/i).fill('What was her favourite food?');
    await page.getByRole('button', { name: 'Find it' }).click();

    await expect(page.getByText(/only play what they actually said/i)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('button', { name: 'Play their voice' })).toHaveCount(0);
  });

  test('never lets the archive’s voice look like theirs', async ({ page }) => {
    // A bereaved person must never have to work out who is talking. What the
    // archive says is interface text and labelled; what they said is a
    // quotation. The two are never rendered the same way.
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/listen`);

    await page.getByLabel(/What would you like to hear/i).fill('What was her favourite food?');
    await page.getByRole('button', { name: 'Find it' }).click();

    const archiveVoice = page.locator('.notice-info[role="status"]').last();
    await expect(archiveVoice).toBeVisible({ timeout: 15000 });
    await expect(archiveVoice.getByText('The archive')).toBeVisible();
    // And nothing on the page is presented as a quotation from them.
    await expect(page.locator('blockquote')).toHaveCount(0);
  });
});

test.describe('telling them something that has happened', () => {
  test.use({ storageState: 'tests/e2e/.auth/family.json' });

  test('says up front that nothing answers back', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/listen`);
    await page.getByLabel('Tell them something that has happened').check();

    // The expectation is set before the person types, not corrected afterwards.
    await expect(page.getByText(/Nothing here answers you back/i)).toBeVisible();
  });

  test('answers news about a job with what they said about their own', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/listen`);
    await page.getByLabel('Tell them something that has happened').check();

    await page.getByLabel(/What would you like to tell/i).fill('I got the job, Aai');
    await page.getByRole('button', { name: 'Tell them' }).click();

    const archiveVoice = page.locator('.notice-info[role="status"]').last();
    await expect(archiveVoice).toContainText('their own life', { timeout: 15000 });
  });

  test('never reacts to the news', async ({ page }) => {
    // The whole point. No congratulation, no pride, no presence.
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/listen`);
    await page.getByLabel('Tell them something that has happened').check();

    await page.getByLabel(/What would you like to tell/i).fill('I got the job, Aai');
    await page.getByRole('button', { name: 'Tell them' }).click();
    await expect(page.locator('.notice-info[role="status"]').last()).toBeVisible({
      timeout: 15000,
    });

    const text = (await page.locator('main').innerText()).toLowerCase();
    expect(text).not.toMatch(/proud|congratulations|happy for you|she would|watching over|smiling/);
  });

  test('says plainly when there is nothing, without implying it did not matter', async ({
    page,
  }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/listen`);
    await page.getByLabel('Tell them something that has happened').check();

    await page.getByLabel(/What would you like to tell/i).fill('I have taken up sailing');
    await page.getByRole('button', { name: 'Tell them' }).click();

    await expect(page.getByText(/wouldn’t have mattered to them/i)).toBeVisible({
      timeout: 15000,
    });
  });
});
