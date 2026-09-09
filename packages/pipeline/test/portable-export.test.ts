import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildIndexHtml,
  createZip,
  keyFingerprint,
  readZip,
  signManifest,
  type IndexData,
} from '../src/index';

const VERIFIER = fileURLToPath(new URL('../src/export/verify.mjs', import.meta.url));

const key = () =>
  generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('signing a manifest', () => {
  it('produces a signature the manifest verifies against', () => {
    const manifest = Buffer.from('{"format":"everecho-export/2"}', 'utf8');
    const signature = signManifest(manifest, key())!;

    expect(signature.algorithm).toBe('ed25519');
    expect(
      verify(
        null,
        manifest,
        createPublicKey(signature.publicKey),
        Buffer.from(signature.signature, 'base64'),
      ),
    ).toBe(true);
  });

  it('does not verify against a manifest that changed by one byte', () => {
    const manifest = Buffer.from('{"format":"everecho-export/2"}', 'utf8');
    const signature = signManifest(manifest, key())!;

    expect(
      verify(
        null,
        Buffer.from('{"format":"everecho-export/3"}', 'utf8'),
        createPublicKey(signature.publicKey),
        Buffer.from(signature.signature, 'base64'),
      ),
    ).toBe(false);
  });

  it('says the export is unsigned rather than inventing a key', () => {
    expect(signManifest(Buffer.from('{}'), undefined)).toBeNull();
  });

  it('refuses a key of the wrong kind, rather than signing with it', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expect(() => signManifest(Buffer.from('{}'), rsa)).toThrow(/Ed25519/);
  });

  it('fingerprints the key so it can be compared with one published elsewhere', () => {
    const first = signManifest(Buffer.from('{}'), key())!;
    const second = signManifest(Buffer.from('{}'), key())!;

    expect(first.fingerprint).toMatch(/^([0-9A-F]{4}-){7}[0-9A-F]{4}$/);
    expect(first.fingerprint).not.toBe(second.fingerprint);
    expect(keyFingerprint(first.publicKey)).toBe(first.fingerprint);
  });
});

const DATA: IndexData = {
  subject: 'Kamala Sharma',
  archiveName: 'Kamala’s stories',
  exportedAt: '2026-09-06T00:00:00.000Z',
  producedBy: 'EverEcho',
  originalsIncluded: true,
  memories: [
    {
      id: 'm1',
      title: 'The move to Pune',
      body: 'We moved in 1962.',
      occurredOn: '1962',
      topics: ['childhood'],
      claims: [
        {
          id: 'c1',
          text: 'We moved to Pune in 1962.',
          evidence: [
            {
              sourceId: 's1',
              quotedText: 'We moved to Pune in 1962.',
              locator: { kind: 'timestamp', segmentId: 'g1', startMs: 4000, endMs: 9000 },
            },
          ],
        },
      ],
    },
  ],
  sources: {
    s1: { filename: 'interview.wav', mime: 'audio/wav', kind: 'audio', path: 'originals/s1/i.wav' },
  },
  segments: { g1: { sourceId: 's1', idx: 0, startMs: 4000, endMs: 9000, text: 'We moved…' } },
};

describe('the browsable index', () => {
  it('carries its own data, because a file:// page cannot fetch the json beside it', () => {
    const html = buildIndexHtml(DATA);
    expect(html).toContain('The move to Pune');
    expect(html).not.toContain('fetch(');
  });

  it('needs no network at all', () => {
    const html = buildIndexHtml(DATA);
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)=["']https?:/);
  });

  it('plays a range of the original file rather than a cut of it', () => {
    const html = buildIndexHtml(DATA);
    // Seek to the start, stop at the end. The same rule the product enforces
    // in its type system has to survive the export.
    expect(html).toContain('audio.currentTime = startMs / 1000');
    expect(html).toContain('audio.pause()');
  });

  it('cannot be closed early by a memory containing a script tag', () => {
    const body = 'She wrote </script><script>alert(1)</script> in her diary.';
    const html = buildIndexHtml({
      ...DATA,
      memories: [{ ...DATA.memories[0]!, body }],
    });

    // Read exactly what a browser would: everything up to the first literal
    // </script>. If the escaping failed, this is truncated JSON and the parse
    // throws — and the page after it would be running somebody's markup.
    const start = html.indexOf('id="data">') + 'id="data">'.length;
    const block = html.slice(start, html.indexOf('</script>', start));
    expect(JSON.parse(block).memories[0].body).toBe(body);
  });
});

/** Writes an unzipped export to disk and runs the shipped verifier over it. */
function run(files: Record<string, string | Buffer>): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'everecho-export-'));
  try {
    for (const [path, data] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), data);
    }
    try {
      return { code: 0, out: execFileSync('node', [VERIFIER], { cwd: dir, encoding: 'utf8' }) };
    } catch (error) {
      const failure = error as { status: number; stdout: string; stderr: string };
      return { code: failure.status, out: `${failure.stdout}${failure.stderr}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

import { createHash } from 'node:crypto';

function exportOf(files: Record<string, string>, privateKey?: string): Record<string, string> {
  const manifest = JSON.stringify(
    {
      format: 'everecho-export/2',
      subject: 'Kamala Sharma',
      files: Object.entries(files).map(([path, body]) => ({
        path,
        sha256: createHash('sha256').update(body).digest('hex'),
        bytes: Buffer.byteLength(body),
      })),
    },
    null,
    2,
  );
  const signature = signManifest(Buffer.from(manifest, 'utf8'), privateKey);
  return {
    ...files,
    'manifest.json': manifest,
    ...(signature ? { 'manifest.sig': JSON.stringify(signature, null, 2) } : {}),
  };
}

const SOURCES = JSON.stringify([{ id: 's1', original_filename: 'interview.wav' }]);
const TRANSCRIPTS = JSON.stringify([{ segments: [{ id: 'g1', startMs: 0, endMs: 9000 }] }]);
const CLAIMS = JSON.stringify([
  { id: 'c1', evidence: [{ sourceId: 's1', locator: { segmentId: 'g1' } }] },
]);

const intact = (): Record<string, string> => ({
  'metadata/sources.json': SOURCES,
  'metadata/transcripts.json': TRANSCRIPTS,
  'metadata/claims-and-evidence.json': CLAIMS,
  'originals/s1/interview.wav': 'RIFFpretend-audio',
});

describe('the verifier that ships inside the export', () => {
  it('passes an intact export, and says how much it checked', () => {
    const result = run(exportOf(intact()));
    expect(result.code).toBe(0);
    expect(result.out).toContain('4 files checked');
    expect(result.out).toContain('1 of 1 citations resolve');
    expect(result.out).toContain('Intact.');
  });

  it('catches a file altered after the export was made', () => {
    const files = exportOf(intact());
    // Exactly the same length as the original. A size check would miss this,
    // which is the whole reason the checksum is there.
    files['originals/s1/interview.wav'] = 'RIFFinvented-word';
    const result = run(files);
    expect(result.code).toBe(1);
    expect(result.out).toContain('altered since export: originals/s1/interview.wav');
  });

  it('catches a file truncated after the export was made', () => {
    const files = exportOf(intact());
    files['originals/s1/interview.wav'] = 'RIFF';
    const result = run(files);
    expect(result.code).toBe(1);
    expect(result.out).toContain('wrong size: originals/s1/interview.wav');
  });

  it('catches a file added to the folder afterwards', () => {
    const result = run({ ...exportOf(intact()), 'originals/s1/extra.wav': 'RIFFsmuggled' });
    expect(result.code).toBe(1);
    expect(result.out).toContain('not part of this export: originals/s1/extra.wav');
  });

  it('catches a file removed from the folder', () => {
    const files = exportOf(intact());
    delete files['originals/s1/interview.wav'];
    const result = run(files);
    expect(result.code).toBe(1);
    expect(result.out).toContain('missing: originals/s1/interview.wav');
  });

  it('catches a citation whose recording is not in the export', () => {
    const files = intact();
    files['metadata/claims-and-evidence.json'] = JSON.stringify([
      { id: 'c1', evidence: [{ sourceId: 's-gone', locator: {} }] },
    ]);
    const result = run(exportOf(files));
    expect(result.code).toBe(1);
    expect(result.out).toContain('citation points at a source that is not here');
  });

  it('catches a citation whose place in the recording is not in the export', () => {
    const files = intact();
    files['metadata/claims-and-evidence.json'] = JSON.stringify([
      { id: 'c1', evidence: [{ sourceId: 's1', locator: { segmentId: 'g-gone' } }] },
    ]);
    const result = run(exportOf(files));
    expect(result.code).toBe(1);
    expect(result.out).toContain('citation points at a place in the recording that is not here');
  });

  it('verifies a signature, and states the limit of what it proves', () => {
    const result = run(exportOf(intact(), key()));
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/Signed by key ([0-9A-F]{4}-){7}[0-9A-F]{4}/);
    expect(result.out).toContain('proves they agree');
    expect(result.out).toContain('somewhere you did not get from this folder');
  });

  it('rejects a manifest re-signed over different content', () => {
    const files = exportOf(intact(), key());
    // The attack a signature exists to stop: change the checksums, keep the
    // signature. Re-signing with another key is caught by the fingerprint, not
    // by this, which is why the verifier prints the fingerprint.
    const manifest = JSON.parse(files['manifest.json']!);
    manifest.files[0].sha256 = 'a'.repeat(64);
    files['manifest.json'] = JSON.stringify(manifest, null, 2);
    const result = run(files);
    expect(result.code).toBe(1);
    expect(result.out).toContain('the signature does not match the manifest');
  });

  it('says an unsigned export is unsigned rather than staying quiet about it', () => {
    const result = run(exportOf(intact()));
    expect(result.out).toContain('This export is not signed');
    expect(result.out).toContain('not who made it');
  });

  it('does not fail an export that deliberately left the originals out', () => {
    const files = intact();
    delete files['originals/s1/interview.wav'];
    const result = run(exportOf(files));
    expect(result.code).toBe(0);
    expect(result.out).toContain('originals were not included');
  });
});

describe('the zip the export is delivered in', () => {
  it('reads back exactly what was written, bytes and all', () => {
    const entries = [
      { path: 'README.txt', data: Buffer.from('Kamala’s stories — unicode in the name') },
      { path: 'originals/s1/interview.wav', data: Buffer.from([0, 255, 13, 10, 26, 0]) },
      { path: 'manifest.json', data: Buffer.from('{}') },
    ];
    const files = readZip(createZip(entries));

    expect([...files.keys()]).toEqual(entries.map((e) => e.path));
    for (const entry of entries) expect(files.get(entry.path)).toEqual(entry.data);
  });

  it('survives an empty file, which is where offset arithmetic usually breaks', () => {
    const files = readZip(
      createZip([
        { path: 'empty', data: Buffer.alloc(0) },
        { path: 'after', data: Buffer.from('still here') },
      ]),
    );
    expect(files.get('empty')!.length).toBe(0);
    expect(files.get('after')!.toString()).toBe('still here');
  });
});
