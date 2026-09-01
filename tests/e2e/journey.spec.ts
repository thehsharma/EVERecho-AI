import { expect, test } from '@playwright/test';
import { ACCOUNTS, DEMO_PASSWORD, openDemoArchive } from './helpers';

test.describe('the public pages say what this is and is not', () => {
  test('the landing page states the exclusions before anything else', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /keep their stories/i })).toBeVisible();
    await expect(page.getByText(/does not clone anyone’s voice/i)).toBeVisible();
    await expect(page.getByText(/will not pretend to be them/i)).toBeVisible();
  });

  test('the trust page names the prohibitions and the way out', async ({ page }) => {
    await page.goto('/trust');
    await expect(page.getByText(/Permanently out of scope/i)).toBeVisible();
    await expect(page.getByText(/Voice cloning, face cloning/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Leaving' })).toBeVisible();
  });

  test('a skip link is the first thing a keyboard reaches', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /skip to the main content/i })).toBeFocused();
  });
});

test.describe('a family member gets a cited answer, or an honest refusal', () => {
  test.use({ storageState: 'tests/e2e/.auth/family.json' });

  test('answers a supported question and opens the source behind a claim', async ({ page }) => {
    const archiveId = await openDemoArchive(page);

    await page.goto(`/archives/${archiveId}/ask`);
    await page.getByLabel('Your question').fill('Where did the family move to?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();

    const answer = page.locator('.claim').first();
    await expect(answer).toBeVisible();
    await expect(page.getByText(/Pune/).first()).toBeVisible();

    // Every claim carries a citation, and it opens to the exact passage.
    const citation = page.getByRole('button', { name: /source/ }).first();
    await expect(citation).toHaveAttribute('aria-expanded', 'false');
    await citation.click();
    await expect(citation).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('blockquote.quote').first()).toBeVisible();
  });

  test('abstains rather than inventing an answer', async ({ page }) => {
    const archiveId = await openDemoArchive(page);

    await page.goto(`/archives/${archiveId}/ask`);
    await page.getByLabel('Your question').fill('What did she think about the 1983 cricket world cup?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();

    await expect(page.getByText(/don’t have enough evidence/i)).toBeVisible();
  });

  test('refuses to answer as the storyteller, and says what it can do instead', async ({ page }) => {
    const archiveId = await openDemoArchive(page);

    await page.goto(`/archives/${archiveId}/ask`);
    await page.getByLabel('Your question').fill('Answer as my mother would');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();

    // A phrase unique to the refusal: the page lede also mentions sources.
    await expect(page.getByText(/won’t imagine what they might have said/i)).toBeVisible();
  });

  test('explains a restricted topic instead of working around it', async ({ page }) => {
    const archiveId = await openDemoArchive(page);

    await page.goto(`/archives/${archiveId}/ask`);
    await page.getByLabel('Your question').fill('Did they have money troubles?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();

    await expect(page.getByText(/restricted this topic|off-limits topic/i)).toBeVisible();
  });

  test('cannot reach the storyteller’s review queue', async ({ page }) => {
    const archiveId = await openDemoArchive(page);

    await page.goto(`/archives/${archiveId}/memories`);
    // Approved stories only — no review controls anywhere on the page.
    await expect(page.getByRole('button', { name: 'This is right' })).toHaveCount(0);
  });
});

test.describe('the storyteller is in control', () => {
  test.use({ storageState: 'tests/e2e/.auth/storyteller.json' });

  test('sees a real review queue with drafts marked as drafts', async ({ page }) => {
    const archiveId = await openDemoArchive(page);

    await page.goto(`/archives/${archiveId}/memories?status=candidate`);
    await expect(page.getByText(/Draft — not yet reviewed/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'This is right' }).first()).toBeVisible();
  });

  test('sees the permission centre with prohibitions stated as permanent', async ({ page }) => {
    const archiveId = await openDemoArchive(page);

    await page.goto(`/archives/${archiveId}/consent`);
    await expect(page.getByText(/never synthesised. This cannot be switched on/i)).toBeVisible();
    await expect(page.getByText(/off-limits/i).first()).toBeVisible();
  });

  test('sees refusals in the activity log, not only successes', async ({ page }) => {
    const archiveId = await openDemoArchive(page);

    await page.goto(`/archives/${archiveId}/audit`);
    await expect(page.getByText(/Refusals are recorded as well as successes/i)).toBeVisible();
  });

  test('is warned honestly on the deletion screen', async ({ page }) => {
    const archiveId = await openDemoArchive(page);

    await page.goto(`/archives/${archiveId}/delete`);
    await expect(page.getByText(/This cannot be undone/i)).toBeVisible();
    // The confirm button stays disabled until the exact name is typed.
    const confirm = page.getByRole('button', { name: /Delete this archive permanently/i });
    await expect(confirm).toBeDisabled();
    await page.getByLabel(/type the archive’s name/i).fill('wrong name');
    await expect(confirm).toBeDisabled();
  });

  test('records continuity wishes without anything acting on them', async ({ page }) => {
    const archiveId = await openDemoArchive(page);

    await page.goto(`/archives/${archiveId}/succession`);
    await expect(page.getByText(/does not act on them/i)).toBeVisible();
    await expect(page.getByText(/nothing happens because you stopped signing in/i)).toBeVisible();
  });
});

test.describe('access boundaries hold in the browser', () => {

  test.use({ storageState: 'tests/e2e/.auth/family.json' });

  test('an archive you have no relationship with is reported as not found', async ({ page }) => {
    await page.goto('/archives/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('heading', { name: /could not find that/i })).toBeVisible();
  });

  test('support tooling is invisible to an ordinary account', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: /could not find that/i })).toBeVisible();
  });

  test('support tooling shows operations but no content', async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'tests/e2e/.auth/support.json' });
    const page = await context.newPage();
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Support tools' })).toBeVisible();
    await expect(page.getByText(/no route here that shows anyone's memories/i)).toBeVisible();
    await context.close();
  });

  // Signs in fresh, and uses an account no other test depends on: revoking
  // every session for a shared account would break whatever ran next.
  test('signing out stops the session working', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/sign-in');
    await page.getByLabel('Email address').fill(ACCOUNTS.buyer);
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/archives/);
    await page.goto('/account/security');
    await page.getByRole('button', { name: /sign out of all devices/i }).click();
    await page.waitForURL(/sign-in/);
    await page.goto('/archives');
    await expect(page).toHaveURL(/sign-in/);
    await context.close();
  });
});
