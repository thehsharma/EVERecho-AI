/**
 * The adversarial log cannot drift from the test suite.
 *
 * Every entry names the tests that pin it. This checks each one still exists,
 * by searching for its name in the file it claims to live in. An entry whose
 * test has been deleted or renamed is an entry that has quietly stopped being
 * a guarantee and gone back to being a story.
 *
 * Deliberately a string search rather than a test-runner integration: the
 * point is that the claim in the log is checkable by anybody, cheaply, without
 * running the suite.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

interface Entry {
  id: string;
  held: boolean;
  fix: string;
  fixedIn: string | null;
  pinnedBy: string[];
}

const log = JSON.parse(await readFile('docs/adversarial-log.json', 'utf8')) as {
  entries: Entry[];
};

const problems: string[] = [];

for (const entry of log.entries) {
  if (entry.pinnedBy.length === 0) {
    problems.push(`${entry.id}: no pinning test. An entry with no test is a story.`);
    continue;
  }

  for (const reference of entry.pinnedBy) {
    const [file, name] = reference.split(' :: ');
    if (!file) {
      problems.push(`${entry.id}: malformed reference "${reference}"`);
      continue;
    }
    if (!existsSync(file)) {
      problems.push(`${entry.id}: ${file} does not exist`);
      continue;
    }
    if (name) {
      const source = await readFile(file, 'utf8');
      if (!source.includes(name)) {
        problems.push(`${entry.id}: ${file} no longer contains "${name}"`);
      }
    }
  }

  // A fixed defect names the commit that fixed it; an open one says so, in its
  // own entry. This searched the whole file for an OPEN marker until v0.5,
  // which meant one open entry excused every other — the check passed while
  // checking nothing. Found by adding a second open entry and watching it not
  // complain.
  if (entry.fixedIn === null && entry.held === false && !entry.fix.startsWith('OPEN')) {
    problems.push(`${entry.id}: unfixed and not marked OPEN`);
  }
}

if (problems.length > 0) {
  console.error('\nThe adversarial log has drifted from the suite:\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('');
  process.exit(1);
}

const open = log.entries.filter((e) => e.fixedIn === null).length;
console.log(
  `adversarial log: ${log.entries.length} entries, every pinning test present` +
    (open > 0 ? `, ${open} still open` : ''),
);
