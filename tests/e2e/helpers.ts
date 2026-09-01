import type { Page } from '@playwright/test';

export const DEMO_PASSWORD = 'demo-passphrase-2026';

export const ACCOUNTS = {
  storyteller: 'kamala@everecho.example',
  buyer: 'anil@everecho.example',
  family: 'anjali@everecho.example',
  support: 'support@everecho.example',
} as const;

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/archives/);
}

export async function openDemoArchive(page: Page): Promise<string> {
  await page.goto('/archives');
  await page
    .getByRole('link', { name: /stories/i })
    .first()
    .click();
  await page.waitForURL(/\/archives\/[0-9a-f-]{36}/);
  const match = /\/archives\/([0-9a-f-]{36})/.exec(page.url());
  if (!match) throw new Error(`could not read an archive id from ${page.url()}`);
  return match[1]!;
}
