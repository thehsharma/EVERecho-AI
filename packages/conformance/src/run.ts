import { CASES } from './cases';
import type { Adapter, Report, CaseResult } from './types';

/** Bumped when a case is added, changed or removed. Reports carry it. */
export const SUITE_VERSION = '1.0.0';

/**
 * Runs the suite against one system.
 *
 * A case that throws counts as a failure with the error attached, not as a
 * crash: a system that errors on a persona request has still failed to refuse
 * it politely, and the report should say so rather than stopping.
 */
export async function runConformance(
  adapter: Adapter,
  options: { language?: string } = {},
): Promise<Report> {
  const capabilities = await adapter.describe();
  const language = options.language ?? capabilities.languages[0] ?? 'en';

  const results: Report['results'] = [];
  for (const testCase of CASES) {
    const missing =
      (testCase.requires === 'audio' && !capabilities.audio) ||
      (testCase.requires === 'news' && !capabilities.news);

    let result: CaseResult;
    if (missing) {
      result = {
        id: testCase.id,
        outcome: 'skipped',
        detail: `system does not declare "${testCase.requires}"`,
      };
    } else {
      try {
        result = await testCase.run(adapter, language);
      } catch (error) {
        result = {
          id: testCase.id,
          outcome: 'fail',
          detail: 'the case threw',
          response: error instanceof Error ? error.message : String(error),
        };
      }
    }
    results.push({ ...result, title: testCase.title, severity: testCase.severity });
  }

  const failed = results.filter((r) => r.outcome === 'fail');
  const criticalFailures = failed.filter((r) => r.severity === 'critical').length;

  return {
    system: capabilities.system,
    version: capabilities.version,
    language,
    generatedAt: new Date().toISOString(),
    suiteVersion: SUITE_VERSION,
    passed: results.filter((r) => r.outcome === 'pass').length,
    failed: failed.length,
    skipped: results.filter((r) => r.outcome === 'skipped').length,
    criticalFailures,
    // A skipped case is not a pass. A system is conformant when nothing it
    // actually ran failed, and no critical case failed.
    conformant: failed.length === 0,
    results,
  };
}

/** The report as something a person reads, rather than parses. */
export function formatReport(report: Report): string {
  const lines: string[] = [];
  const ran = report.passed + report.failed;

  lines.push('');
  lines.push(`EverEcho conformance ${report.suiteVersion} — ${report.system}`);
  lines.push('');
  lines.push(
    `  ${report.passed} of ${ran} passed` + (report.skipped ? `, ${report.skipped} skipped` : ''),
  );
  lines.push('');

  for (const result of report.results) {
    const mark =
      result.outcome === 'pass' ? 'PASS' : result.outcome === 'skipped' ? 'SKIP' : 'FAIL';
    lines.push(`  ${mark}  ${result.title}`);
    lines.push(`        ${result.detail}`);
    if (result.response) {
      // The exact text, so a failure is actionable rather than a score.
      const shown =
        result.response.length > 300 ? `${result.response.slice(0, 300)}…` : result.response;
      lines.push(`        response: ${shown.replace(/\n/g, ' ')}`);
    }
  }

  lines.push('');
  lines.push(
    report.conformant
      ? '  Conformant.'
      : `  NOT conformant — ${report.failed} failure(s), ${report.criticalFailures} critical.`,
  );
  lines.push('');
  return lines.join('\n');
}
