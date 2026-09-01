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

function describeViolations(violations: { id: string; impact?: string | null; nodes: unknown[] }[]) {
  return violations
    .map((v) => `${v.impact ?? 'unknown'}: ${v.id} (${v.nodes.length} element(s))`)
    .join('\n');
}

test.describe('public pages meet WCAG 2.2 AA', () => {
  for (const path of ['/', '/how-it-works', '/trust', '/pricing', '/support', '/sign-in', '/sign-up', '/demo']) {
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
    await page.getByRole('button', { name: /source/ }).first().click();

    const results = await new AxeBuilder({ page }).withTags(STANDARD).analyze();
    expect(describeViolations(results.violations)).toBe('');
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
