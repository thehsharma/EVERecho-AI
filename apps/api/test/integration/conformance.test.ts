import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatReport, runConformance, type Adapter } from '@everecho/conformance';
import { seedDemoArchive, type PipelineContext } from '@everecho/pipeline';
import { TestClient, startHarness, type Harness } from '../helpers/harness';

/**
 * EverEcho, measured by its own published standard.
 *
 * This is the only thing that makes publishing the suite honest. A standard
 * its author does not meet is marketing, and a suite that only ever runs
 * against the system it was extracted from is a unit test with ambitions.
 *
 * It runs through the real HTTP routes against a real seeded archive, using
 * the same adapter shape a competitor would implement.
 */

let h: Harness;
let adapter: Adapter;
let archiveId: string;

beforeAll(async () => {
  h = await startHarness({ LOG_LEVEL: 'silent' });
  const seed = await seedDemoArchive(h.ctx as unknown as PipelineContext);
  archiveId = seed.archiveId;

  const family = new TestClient(h.app);
  const signedIn = await family.post('/v1/auth/sign-in', {
    email: 'anjali@everecho.example',
    password: 'demo-passphrase-2026',
  });
  expect(signedIn.status).toBe(200);

  // The adapter a competitor writes talks HTTP. This one talks to the same
  // routes in-process, which exercises identical handlers.
  adapter = {
    describe: async () =>
      (await family.get(`/v1/archives/${archiveId}/conformance/describe`)).body as never,
    ask: async (question) =>
      (await family.post(`/v1/archives/${archiveId}/conformance/ask`, { question })).body as never,
    listen: async (question) =>
      (await family.post(`/v1/archives/${archiveId}/conformance/listen`, { question }))
        .body as never,
    tell: async (news) =>
      (await family.post(`/v1/archives/${archiveId}/conformance/tell`, { news })).body as never,
  };
}, 300_000);

afterAll(async () => {
  await h?.close();
});

describe('EverEcho against its own standard', () => {
  it('conforms, with nothing skipped', async () => {
    const report = await runConformance(adapter);

    // Printed on failure so the reason is in the CI log rather than in a
    // number somebody has to go and reproduce.
    if (!report.conformant) console.log(formatReport(report));

    expect(report.failed, formatReport(report)).toBe(0);
    expect(report.criticalFailures).toBe(0);
    expect(report.conformant).toBe(true);

    // A skipped case is not a pass. If EverEcho ever stops declaring a
    // capability in order to skip the cases that test it, this fails.
    expect(report.skipped).toBe(0);
  }, 300_000);

  it('declares only capabilities it actually has', async () => {
    // Declaring a language the product does not serve would buy a skipped
    // case rather than a passed one, and would be a lie either way.
    const capabilities = await adapter.describe();
    expect(capabilities.languages).toEqual(['en']);
    expect(capabilities.audio).toBe(true);
    expect(capabilities.news).toBe(true);
  });

  it('reports which case failed, not merely that one did', async () => {
    // The suite's own contract: a failing system must be told what to fix.
    const lying: Adapter = {
      describe: async () => ({
        system: 'Fabricator',
        languages: ['en'],
        audio: false,
        news: false,
      }),
      ask: async () => ({
        text: 'I remember the kitchen so well, my child. I am at peace now.',
        abstained: false,
        citedClaims: 0,
      }),
      listen: async () => ({ text: '', clip: null }),
      tell: async () => ({ text: '', clip: null }),
    };
    const report = await runConformance(lying);

    expect(report.conformant).toBe(false);
    expect(report.criticalFailures).toBeGreaterThan(0);

    const failure = report.results.find((r) => r.id === 'persona-refused');
    expect(failure?.outcome).toBe('fail');
    // The actual response, so the failure is actionable.
    expect(failure?.response).toContain('my child');

    const rendered = formatReport(report);
    expect(rendered).toContain('NOT conformant');
    expect(rendered).toContain('my child');
  });

  it('counts a skipped case as skipped, never as passed', async () => {
    const textOnly: Adapter = {
      describe: async () => ({ system: 'Text only', languages: ['en'], audio: false, news: false }),
      ask: async () => ({ text: '', abstained: true, citedClaims: 0 }),
      listen: async () => ({ text: '', clip: null }),
      tell: async () => ({ text: '', clip: null }),
    };
    const report = await runConformance(textOnly);
    expect(report.skipped).toBeGreaterThan(0);
    expect(report.passed + report.failed + report.skipped).toBe(report.results.length);
  });
});
