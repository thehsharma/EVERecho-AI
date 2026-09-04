import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openDemoArchive } from './helpers';

/**
 * WCAG 2.2 AA is the floor for this product. The people using it are often
 * elderly, sometimes unwell, and frequently on a tablet they were given rather
 * than one they chose.
 */
const STANDARD = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function scan(page: Page, url: string) {
  await page.goto(url);
  return new AxeBuilder({ page }).withTags(STANDARD).analyze();
}

function describeViolations(
  violations: { id: string; impact?: string | null; nodes: unknown[] }[],
) {
  return violations
    .map((v) => `${v.impact ?? 'unknown'}: ${v.id} (${v.nodes.length} element(s))`)
    .join('\n');
}

test.describe('public pages meet WCAG 2.2 AA', () => {
  for (const path of [
    '/',
    '/how-it-works',
    '/trust',
    '/pricing',
    '/support',
    '/sign-in',
    '/sign-up',
    '/demo',
  ]) {
    test(`no violations on ${path}`, async ({ page }) => {
      const results = await scan(page, path);
      expect(describeViolations(results.violations)).toBe('');
    });
  }
});

test.describe('the storyteller’s own screens meet WCAG 2.2 AA', () => {
  test.use({ storageState: 'tests/e2e/.auth/storyteller.json' });

  test('every archive screen a storyteller uses', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    const paths = [
      '',
      '/consent',
      '/consent/history',
      '/members',
      '/memories',
      '/memories?status=approved',
      '/timeline',
      '/biography',
      '/people',
      '/ask',
      '/sources',
      '/interview',
      '/audit',
      '/export',
      '/delete',
      '/succession',
    ];

    const failures: string[] = [];
    for (const path of paths) {
      const results = await scan(page, `/archives/${archiveId}${path}`);
      if (results.violations.length > 0) {
        failures.push(`${path || '/(overview)'}\n${describeViolations(results.violations)}`);
      }
    }
    expect(failures.join('\n\n')).toBe('');
  });
});

test.describe('a family member’s screens meet WCAG 2.2 AA', () => {
  test.use({ storageState: 'tests/e2e/.auth/family.json' });

  test('an answer with its citations open is still accessible', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/ask`);
    await page.getByLabel('Your question').fill('Where did the family move to?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await page
      .getByRole('button', { name: /source/ })
      .first()
      .click();

    const results = await new AxeBuilder({ page }).withTags(STANDARD).analyze();
    expect(describeViolations(results.violations)).toBe('');
  });
});

test.describe('the conversation screens meet WCAG 2.2 AA', () => {
  test.use({ storageState: 'tests/e2e/.auth/storyteller.json' });

  test('every screen the conversation added', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    const failures: string[] = [];
    for (const path of ['/talk', '/learning', '/learned']) {
      const results = await scan(page, `/archives/${archiveId}${path}`);
      if (results.violations.length > 0) {
        failures.push(`${path}\n${describeViolations(results.violations)}`);
      }
    }
    const results = await scan(page, '/account/preferences');
    if (results.violations.length > 0) {
      failures.push(`/account/preferences\n${describeViolations(results.violations)}`);
    }
    expect(failures.join('\n\n')).toBe('');
  });

  test('the live screen is accessible while a conversation is running', async ({ page }) => {
    // Scanned live rather than at rest: the state that matters is the one with
    // a transcript growing in it, a visualiser moving, and controls changing
    // label as the conversation moves between listening and speaking.
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/talk`);
    await page.getByRole('button', { name: 'Begin' }).click();
    await page.waitForURL(/\/talk\/[0-9a-f-]{36}/);
    await expect(page.getByText('Ready when you are')).toBeVisible({ timeout: 15000 });

    await page.getByLabel('Type instead of speaking').fill('We moved to Pune in 1962.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.turn-assistant').first()).toBeVisible({ timeout: 15000 });

    const results = await new AxeBuilder({ page }).withTags(STANDARD).analyze();
    expect(describeViolations(results.violations)).toBe('');
  });

  test('what is happening is announced, not only shown', async ({ page }) => {
    // Somebody using a screen reader has to know the assistant started
    // listening. A visualiser that only animates tells them nothing.
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/talk`);
    await page.getByRole('button', { name: 'Begin' }).click();
    await page.waitForURL(/\/talk\/[0-9a-f-]{36}/);
    await expect(page.getByText('Ready when you are')).toBeVisible({ timeout: 15000 });

    // The status region carries the state in words, so a screen reader
    // announces the change as it happens. Asserted on the region itself rather
    // than on any element with aria-live: the caption region is also live and
    // is empty until somebody speaks, which would make a loose match pass
    // while announcing nothing.
    // Scoped to the conversation's own status region: the identity notice is
    // also a status region, deliberately, so that what a person is talking to
    // is announced before anything else happens.
    const status = page.locator('.live-status');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toContainText('Ready when you are');
    await expect(status).toContainText('Connected');

    // And it keeps announcing as the conversation moves.
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(status).toContainText('Paused', { timeout: 10000 });
  });
});

test.describe('a family member’s conversation screens meet WCAG 2.2 AA', () => {
  test.use({ storageState: 'tests/e2e/.auth/family.json' });

  test('an answer with a source open is accessible mid-conversation', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/talk`);
    await page.getByRole('button', { name: 'Begin' }).click();
    await page.waitForURL(/\/talk\/[0-9a-f-]{36}/);
    await expect(page.getByText('Ready when you are')).toBeVisible({ timeout: 15000 });

    await page.getByLabel('Type instead of speaking').fill('Where did the family move to?');
    await page.getByRole('button', { name: 'Send' }).click();
    const turn = page.locator('.turn-assistant').first();
    await expect(turn).toBeVisible({ timeout: 20000 });
    await turn.locator('.citation-chip').first().click();
    await expect(page.getByRole('dialog', { name: 'Source' })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(STANDARD).analyze();
    expect(describeViolations(results.violations)).toBe('');
  });
});

test.describe('the family loop screens meet WCAG 2.2 AA', () => {
  test.use({ storageState: 'tests/e2e/.auth/storyteller.json' });

  test('the storyteller’s inbox, at rest and with an answer open', async ({ page, browser }) => {
    const archiveId = await openDemoArchive(page);

    // Asked here rather than relying on one being left over from another
    // spec. A test that only checks something when earlier tests happen to
    // leave the right state behind is a test that silently stops checking.
    const asker = await browser.newContext({ storageState: 'tests/e2e/.auth/family.json' });
    const askerPage = await asker.newPage();
    await askerPage.goto(`/archives/${archiveId}/questions`);
    await askerPage
      .getByLabel('What would you like to ask?')
      .fill(`What was the walk to school like? ${Date.now()}`);
    await askerPage.getByRole('button', { name: 'Send this question' }).click();
    await expect(askerPage.getByText('Sent. It is in their own time now.')).toBeVisible({
      timeout: 15000,
    });
    await asker.close();

    const atRest = await scan(page, `/archives/${archiveId}/inbox`);
    expect(describeViolations(atRest.violations)).toBe('');

    // The state that matters: a textarea, a radio group and three buttons that
    // all appeared after the page loaded.
    const first = page.locator('.card').filter({ hasText: 'Asked by' }).first();
    await first.getByRole('button', { name: 'Answer this' }).click();
    await expect(page.getByRole('group', { name: 'Who should see this?' })).toBeVisible();

    const open = await new AxeBuilder({ page }).withTags(STANDARD).analyze();
    expect(describeViolations(open.violations)).toBe('');
  });
});

test.describe('a family member’s question screen meets WCAG 2.2 AA', () => {
  test.use({ storageState: 'tests/e2e/.auth/family.json' });

  test('asking, and reading what came back', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    const results = await scan(page, `/archives/${archiveId}/questions`);
    expect(describeViolations(results.violations)).toBe('');
  });
});

test.describe('the contributor screens meet WCAG 2.2 AA', () => {
  test.use({ storageState: 'tests/e2e/.auth/contributor.json' });

  test('adding what you know', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    const results = await scan(page, `/archives/${archiveId}/contribute`);
    expect(describeViolations(results.violations)).toBe('');
  });
});

test.describe('the review queue meets WCAG 2.2 AA', () => {
  test.use({ storageState: 'tests/e2e/.auth/storyteller.json' });

  test('family suggestions, including a disagreement', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    const results = await scan(page, `/archives/${archiveId}/proposals`);
    expect(describeViolations(results.violations)).toBe('');
  });
});

test.describe('the capsule screens meet WCAG 2.2 AA', () => {
  test.use({ storageState: 'tests/e2e/.auth/storyteller.json' });

  test('the list, and the form with every option open', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    const list = await scan(page, `/archives/${archiveId}/capsules`);
    expect(describeViolations(list.violations)).toBe('');

    // Two checkbox groups, two date pickers and a warning that appears with
    // them — none of it on the page until the form opens.
    await page.getByRole('button', { name: 'Make a capsule' }).click();
    await expect(page.getByRole('group', { name: 'Which stories?' })).toBeVisible();
    const form = await new AxeBuilder({ page }).withTags(STANDARD).analyze();
    expect(describeViolations(form.violations)).toBe('');
  });
});

test.describe('the coverage radar meets WCAG 2.2 AA', () => {
  test.use({ storageState: 'tests/e2e/.auth/storyteller.json' });

  test('the questions, and one of them open to answer', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    const list = await scan(page, `/archives/${archiveId}/gaps`);
    expect(describeViolations(list.violations)).toBe('');

    // The textarea and its explanation are not on the page until somebody
    // chooses to say more, so the at-rest scan would never reach them.
    const card = page.locator('.card').first();
    await expect(
      card,
      'no coverage questions left in the demonstration archive — run pnpm db:seed',
    ).toBeVisible();
    await card.getByRole('button', { name: 'Say more' }).click();
    await expect(card.getByLabel('Your answer')).toBeVisible();

    const open = await new AxeBuilder({ page }).withTags(STANDARD).analyze();
    expect(describeViolations(open.violations)).toBe('');
  });
});

test.describe('the directive screen meets WCAG 2.2 AA', () => {
  test.use({ storageState: 'tests/e2e/.auth/storyteller.json' });

  test('the decision, and the form for a particular one', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    const atRest = await scan(page, `/archives/${archiveId}/remembrance`);
    expect(describeViolations(atRest.violations)).toBe('');

    // Two radio groups, a select, a date picker and a checkbox, none of which
    // are on the page until somebody chooses to add something.
    await page.getByRole('button', { name: 'Add something specific' }).click();
    await expect(page.getByRole('group', { name: /want them to have/i })).toBeVisible();

    const open = await new AxeBuilder({ page }).withTags(STANDARD).analyze();
    expect(describeViolations(open.violations)).toBe('');
  });
});

test.describe('keyboard and focus', () => {
  test.use({ storageState: 'tests/e2e/.auth/family.json' });

  test('the ask form is reachable and operable by keyboard alone', async ({ page }) => {
    const archiveId = await openDemoArchive(page);
    await page.goto(`/archives/${archiveId}/ask`);

    await page.getByLabel('Your question').focus();
    await page.keyboard.type('Where did the family move to?');
    // Ctrl+Enter submits, so a keyboard user never has to hunt for the button.
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('.claim').first()).toBeVisible();
  });

  test('a focused control always has a visible outline', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email address').focus();
    const outline = await page
      .getByLabel('Email address')
      .evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).not.toBe('none');
  });
});
