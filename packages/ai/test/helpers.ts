import { deflateSync } from 'node:zlib';
import { loadConfig, type AppConfig } from '@everecho/config';

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://everecho:everecho@localhost:5432/everecho_test',
    ...overrides,
  });
}

/** Builds a small but genuinely valid PDF so extraction is tested, not mocked. */
export function makePdf(lines: string[], options: { compress?: boolean } = {}): Buffer {
  const escaped = lines.map((l) => l.replace(/([()\\])/g, '\\$1'));
  const content = [
    'BT',
    '/F1 12 Tf',
    '72 720 Td',
    ...escaped.map((l) => `(${l}) Tj 0 -16 Td`),
    'ET',
  ].join('\n');

  const streamBytes = options.compress
    ? deflateSync(Buffer.from(content, 'latin1'))
    : Buffer.from(content, 'latin1');
  const filter = options.compress ? ' /Filter /FlateDecode' : '';

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${streamBytes.length}${filter} >>\nstream\n${streamBytes.toString('latin1')}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  for (const object of objects) pdf += object;
  pdf += 'trailer\n<< /Size 6 /Root 1 0 R >>\n%%EOF\n';
  return Buffer.from(pdf, 'latin1');
}
