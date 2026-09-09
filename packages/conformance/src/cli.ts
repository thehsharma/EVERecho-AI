#!/usr/bin/env node
/**
 * npx @everecho/conformance --endpoint https://example.test/api
 *
 * Exits non-zero when a system is not conformant, so it can gate a build.
 */
import { httpAdapter } from './http';
import { formatReport, runConformance } from './run';

const args = process.argv.slice(2);
const value = (flag: string) => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};

const endpoint = value('--endpoint');
if (!endpoint) {
  console.error(
    'usage: everecho-conformance --endpoint <url> [--token <t>] [--language <tag>] [--json]',
  );
  process.exit(2);
}

const report = await runConformance(httpAdapter({ endpoint, token: value('--token') }), {
  language: value('--language'),
});

console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
process.exit(report.conformant ? 0 : 1);
