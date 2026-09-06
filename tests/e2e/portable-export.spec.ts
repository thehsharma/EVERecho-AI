import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, expect } from '@playwright/test';
import { readZip } from '../../packages/pipeline/src/zip';
import { ACCOUNTS, signIn, openDemoArchive } from './helpers';

/**
 * The claim this slice exists to make: the archive survives us.
 *
 * Every other test in this suite drives the product. This one takes what the
 * product hands over, deletes the product from the picture entirely, and opens
 * the result off the filesystem in a real browser — which is what a family
 * would be doing, years from now, with nothing running.
 */
test.describe('the export opens without EverEcho', () => {
  let folder: string;

  test.afterAll(() => {
    if (folder) rmSync(folder, { recursive: true, force: true });
  });

  test('downloads, verifies itself, and browses offline', async ({ page }) => {
    await signIn(page, ACCOUNTS.storyteller);
    const archiveId = await openDemoArchive(page);

    await page.goto(`/archives/${archiveId}/export`);
    await page
      .getByRole('button', { name: /export/i })
      .first()
      .click();

    // The worker runs it. Poll the page rather than the API: what matters is
    // that the person waiting sees it become downloadable.
    const download = page.getByRole('link', { name: 'Download' }).first();
    await expect(async () => {
      await page.reload();
      await expect(download).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });

    const saved = await Promise.all([page.waitForEvent('download'), download.click()]);
    const zip = readFileSync((await saved[0].path())!);

    folder = mkdtempSync(join(tmpdir(), 'everecho-export-'));
    for (const [path, data] of readZip(zip)) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), data);
    }

    // 1. It checks itself, with nothing installed.
    const report = execFileSync('node', ['verify.mjs'], { cwd: folder, encoding: 'utf8' });
    expect(report).toContain('Intact.');
    const [, resolved, total] = report.match(/(\d+) of (\d+) citations resolve/)!;
    expect(Number(total)).toBeGreaterThan(0);
    expect(resolved).toBe(total);

    // 2. It opens off the filesystem. No server, no network, no us.
    await page.context().setOffline(true);
    await page.goto(`file://${join(folder, 'index.html')}`);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const memories = page.locator('nav button');
    expect(await memories.count()).toBeGreaterThan(0);

    // 3. A citation still reaches the recording it came from.
    await memories.first().click();
    const citation = page.getByRole('group').first();
    await expect(citation).toBeVisible();
    await citation.click();
    await expect(citation.locator('blockquote').first()).toBeVisible();

    // 4. And it speaks as nobody. There is no reply on this page, in any
    //    state, because there is no code in the file capable of producing one.
    const html = readFileSync(join(folder, 'index.html'), 'utf8');
    expect(html).toContain('nothing on this page can speak as');
    expect(html).not.toMatch(/would (be|have been) (so )?proud/i);

    await page.context().setOffline(false);
  });
});
