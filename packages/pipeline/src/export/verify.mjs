#!/usr/bin/env node
/**
 * Verify this export. Nothing to install.
 *
 *   node verify.mjs
 *
 * Run it from inside the unzipped folder. It uses only what ships with Node,
 * because the one artefact that has to keep working after the company is gone
 * cannot depend on a package registry still being there.
 *
 * It checks four things:
 *
 *   1. Every file the manifest lists is present and byte-for-byte unchanged.
 *   2. No file is present that the manifest does not list, so nothing can be
 *      added to an archive and pass as part of it.
 *   3. The signature over the manifest, if there is one.
 *   4. Every citation resolves — the source it names exists, and the exact
 *      place inside it exists too.
 *
 * The fourth is the one that matters for this particular product. A memory in
 * here is only worth anything if you can still get back to the recording it
 * came from, and that has to be true with EverEcho switched off forever.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const problems = [];
const notes = [];
let checked = 0;

const read = (path) => readFileSync(join(root, path));
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const readJson = (path) => JSON.parse(read(path).toString('utf8'));

// These two cannot appear in the manifest: the manifest cannot contain its own
// checksum, and the signature is made after the manifest exists.
const NOT_LISTED = new Set(['manifest.json', 'manifest.sig']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

// ---- 1 and 2: the files -----------------------------------------------------

let manifestBytes;
let manifest;
try {
  manifestBytes = read('manifest.json');
  manifest = JSON.parse(manifestBytes.toString('utf8'));
} catch {
  console.error('No manifest.json here. Run this from inside the unzipped folder.');
  process.exit(2);
}

const listed = new Map(manifest.files.map((f) => [f.path, f]));

for (const file of manifest.files) {
  let bytes;
  try {
    bytes = read(file.path);
  } catch {
    problems.push(`missing: ${file.path}`);
    continue;
  }
  checked += 1;
  if (bytes.length !== file.bytes) {
    problems.push(`wrong size: ${file.path} (${bytes.length}, expected ${file.bytes})`);
  } else if (sha256(bytes) !== file.sha256) {
    problems.push(`altered since export: ${file.path}`);
  }
}

for (const path of walk(root)) {
  if (NOT_LISTED.has(path) || listed.has(path)) continue;
  problems.push(`not part of this export: ${path}`);
}

// ---- 3: the signature -------------------------------------------------------

let signatureLine;
try {
  const sig = readJson('manifest.sig');
  const ok = verify(
    null,
    manifestBytes,
    createPublicKey(sig.publicKey),
    Buffer.from(sig.signature, 'base64'),
  );
  if (!ok) problems.push('the signature does not match the manifest');
  signatureLine = ok ? sig.fingerprint : null;
} catch (error) {
  if (error && error.code === 'ENOENT') {
    notes.push(
      'This export is not signed. The checksums above still prove nothing was\n' +
        '  altered after it was made, but not who made it.',
    );
  } else {
    problems.push(`the signature could not be read: ${error.message}`);
  }
}

// ---- 4: the citations -------------------------------------------------------

let citations = 0;
let resolvable = 0;
let originalsIncluded = false;

try {
  const sources = new Map(readJson('metadata/sources.json').map((s) => [s.id, s]));
  const segments = new Set();
  try {
    for (const transcript of readJson('metadata/transcripts.json')) {
      for (const segment of transcript.segments) if (segment.id) segments.add(segment.id);
    }
  } catch {
    notes.push('Transcripts were not included in this export, so spans were not checked.');
  }

  const present = new Set(
    walk(root)
      .filter((p) => p.startsWith('originals/'))
      .map((p) => p.split('/')[1]),
  );
  originalsIncluded = present.size > 0;

  for (const claim of readJson('metadata/claims-and-evidence.json')) {
    for (const evidence of claim.evidence ?? []) {
      citations += 1;
      const source = sources.get(evidence.sourceId);
      if (!source) {
        problems.push(`citation points at a source that is not here: claim ${claim.id}`);
        continue;
      }
      if (originalsIncluded && !present.has(evidence.sourceId)) {
        problems.push(`citation points at a file that is not here: ${source.original_filename}`);
        continue;
      }
      const segmentId = evidence.locator?.segmentId;
      if (segmentId && segments.size > 0 && !segments.has(segmentId)) {
        problems.push(`citation points at a place in the recording that is not here: ${claim.id}`);
        continue;
      }
      resolvable += 1;
    }
  }
} catch (error) {
  problems.push(`the citations could not be checked: ${error.message}`);
}

// ---- what it found ----------------------------------------------------------

const line = ''.padEnd(64, '-');
console.log(`\n${manifest.subject ?? 'This archive'} — export ${manifest.format}`);
console.log(line);
console.log(`  ${checked} files checked against their checksums`);
console.log(
  `  ${resolvable} of ${citations} citations resolve` +
    (originalsIncluded ? ' to the original recording' : ' (originals were not included)'),
);

if (signatureLine) {
  console.log(`\n  Signed by key ${signatureLine}`);
  console.log('  A key that travels with the files it vouches for proves they agree');
  console.log('  with each other, and nothing more. It proves this export came from');
  console.log('  EverEcho only if that fingerprint matches the one they published');
  console.log('  somewhere you did not get from this folder.');
}
for (const note of notes) console.log(`\n  ${note}`);

if (problems.length > 0) {
  console.log(`\n  ${problems.length} problems:`);
  for (const problem of problems.slice(0, 40)) console.log(`    - ${problem}`);
  if (problems.length > 40) console.log(`    … and ${problems.length - 40} more`);
  console.log('\n  This export is NOT intact.\n');
  process.exit(1);
}

console.log('\n  Intact. Every file is exactly as it was when this was made.\n');
