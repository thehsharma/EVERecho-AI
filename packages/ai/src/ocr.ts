import { inflateSync } from 'node:zlib';
import type { AppConfig } from '@everecho/config';

export interface OcrPage {
  page: number;
  text: string;
  confidence: number;
}

export type OcrResult =
  | { status: 'ready'; provider: string; modelVersion: string; pages: OcrPage[] }
  | { status: 'unavailable'; provider: string; reason: string };

export interface OcrAdapter {
  readonly name: string;
  readonly modelVersion: string;
  extract(input: { bytes: Buffer; mimeType: string }): Promise<OcrResult>;
}

/**
 * Extracts text from a PDF's content streams.
 *
 * This reads text that is genuinely *in* the file — it is not optical character
 * recognition and cannot read a scan. Flate-compressed and uncompressed streams
 * are both handled; anything else is reported as unreadable rather than guessed.
 */
export function extractPdfText(bytes: Buffer): { page: number; text: string }[] {
  const pages: { page: number; text: string }[] = [];
  const raw = bytes.toString('latin1');
  const streamPattern = /stream\r?\n?([\s\S]*?)endstream/g;

  let pageNumber = 0;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(raw)) !== null) {
    const body = match[1] ?? '';
    let content: string;
    try {
      // Flate streams start with a zlib header; try inflating, fall back to raw.
      const buffer = Buffer.from(body, 'latin1');
      content = looksDeflated(buffer) ? inflateSync(buffer).toString('latin1') : body;
    } catch {
      content = body;
    }
    const text = textFromContentStream(content);
    if (text.trim().length > 0) {
      pageNumber += 1;
      pages.push({ page: pageNumber, text });
    }
  }
  return pages;
}

function looksDeflated(buffer: Buffer): boolean {
  const first = buffer[0];
  return first === 0x78 || first === 0x68;
}

/** Reads Tj / TJ / ' / " text-showing operators out of a content stream. */
function textFromContentStream(content: string): string {
  const parts: string[] = [];

  // ( … ) Tj  and  ( … ) '  and  ( … ) "
  for (const m of content.matchAll(/\((?:\\.|[^\\()])*\)\s*(?:Tj|'|")/g)) {
    parts.push(decodePdfString(m[0].slice(m[0].indexOf('(') + 1, m[0].lastIndexOf(')'))));
  }
  // [ (a) -250 (b) ] TJ — kerned arrays; the numbers are spacing, not text.
  for (const m of content.matchAll(/\[((?:\\.|[^\]\\])*)\]\s*TJ/g)) {
    const inner = m[1] ?? '';
    const pieces = [...inner.matchAll(/\((?:\\.|[^\\()])*\)/g)].map((p) =>
      decodePdfString(p[0].slice(1, -1)),
    );
    if (pieces.length > 0) parts.push(pieces.join(''));
  }

  return parts
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function decodePdfString(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\(\d{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

/**
 * Local text extraction.
 *
 * Plain text and PDFs with embedded text are handled genuinely. Photographs and
 * scanned images need an OCR engine, and this adapter says so rather than
 * returning an empty result that looks like a document with nothing in it.
 */
export class LocalOcrAdapter implements OcrAdapter {
  readonly name = 'local-deterministic';
  readonly modelVersion: string;

  constructor(cfg: AppConfig) {
    this.modelVersion = cfg.env.OCR_MODEL;
  }

  async extract(input: { bytes: Buffer; mimeType: string }): Promise<OcrResult> {
    if (input.mimeType === 'text/plain') {
      const text = input.bytes.toString('utf8');
      // One page per blank-line-separated block keeps locators meaningful.
      const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
      return {
        status: 'ready',
        provider: this.name,
        modelVersion: this.modelVersion,
        pages: (blocks.length > 0 ? blocks : [text]).map((t, i) => ({
          page: i + 1,
          text: t,
          confidence: 1,
        })),
      };
    }

    if (input.mimeType === 'application/pdf') {
      const pages = extractPdfText(input.bytes);
      if (pages.length === 0) {
        return {
          status: 'unavailable',
          provider: this.name,
          reason:
            'This PDF has no text layer — it is most likely a scan. Reading it needs an OCR provider; configure OCR_DRIVER. The document is stored and unchanged.',
        };
      }
      return {
        status: 'ready',
        provider: this.name,
        modelVersion: this.modelVersion,
        pages: pages.map((p) => ({ ...p, confidence: 0.95 })),
      };
    }

    return {
      status: 'unavailable',
      provider: this.name,
      reason:
        'Reading text from images needs an OCR provider; configure OCR_DRIVER. The photograph is stored and can be captioned by hand in the meantime.',
    };
  }
}

/**
 * Hosted OCR. UNVERIFIED in this build: no provider credentials were available.
 */
export class HostedOcrAdapter implements OcrAdapter {
  readonly name: string;
  readonly modelVersion: string;

  constructor(private readonly cfg: AppConfig) {
    this.name = cfg.env.OCR_DRIVER;
    this.modelVersion = cfg.env.OCR_MODEL;
  }

  async extract(input: { bytes: Buffer; mimeType: string }): Promise<OcrResult> {
    const base = this.cfg.env.LLM_BASE_URL ?? 'https://api.ocr.example/v1';
    const response = await fetch(`${base}/ocr`, {
      method: 'POST',
      headers: {
        'content-type': input.mimeType,
        authorization: `Bearer ${this.cfg.env.OCR_API_KEY ?? ''}`,
      },
      body: new Uint8Array(input.bytes),
    });
    if (!response.ok) {
      return {
        status: 'unavailable',
        provider: this.name,
        reason: `The OCR provider returned ${response.status}. The document is stored and can be read again later.`,
      };
    }
    const payload = (await response.json()) as { pages?: { page: number; text: string }[] };
    return {
      status: 'ready',
      provider: this.name,
      modelVersion: this.modelVersion,
      pages: (payload.pages ?? []).map((p) => ({ ...p, confidence: 0.9 })),
    };
  }
}

export function createOcr(cfg: AppConfig): OcrAdapter {
  return cfg.env.OCR_DRIVER === 'local' ? new LocalOcrAdapter(cfg) : new HostedOcrAdapter(cfg);
}
