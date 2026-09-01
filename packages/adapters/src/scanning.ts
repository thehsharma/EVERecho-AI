import type { AppConfig } from '@everecho/config';

export interface ScanResult {
  verdict: 'clean' | 'infected' | 'unsupported' | 'error';
  detail: string | null;
  scanner: string;
}

/** Uploads are quarantined until a scanner clears them. */
export interface ScanAdapter {
  readonly name: string;
  scan(body: Buffer, meta: { filename: string; mimeType: string }): Promise<ScanResult>;
}

/**
 * Deterministic local scanner. It is not an antivirus and never claims to be:
 * it recognises the EICAR test string, rejects declared types we do not accept,
 * and checks that the bytes actually look like the type that was declared.
 * That last check is the one that catches a real attack in development —
 * "holiday.jpg" that is in fact a script.
 */
export class LocalScanAdapter implements ScanAdapter {
  readonly name = 'local-deterministic';
  private readonly allowed: readonly string[];

  constructor(cfg: AppConfig) {
    this.allowed = cfg.uploadAllowedMime;
  }

  async scan(body: Buffer, meta: { filename: string; mimeType: string }): Promise<ScanResult> {
    const head = body.subarray(0, 4096).toString('latin1');

    if (head.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) {
      return { verdict: 'infected', detail: 'EICAR test signature', scanner: this.name };
    }
    if (!this.allowed.includes(meta.mimeType)) {
      return { verdict: 'unsupported', detail: `MIME type ${meta.mimeType} is not accepted`, scanner: this.name };
    }
    const sniffed = sniffType(body);
    if (sniffed && !typesAgree(sniffed, meta.mimeType)) {
      return {
        verdict: 'infected',
        detail: `Declared ${meta.mimeType} but the bytes are ${sniffed}`,
        scanner: this.name,
      };
    }
    // Images, PDFs, audio and video always begin with a recognisable signature.
    // Bytes that carry none, under one of those declared types, are not what
    // the upload claims — the "shell script called holiday.jpg" case.
    if (!sniffed && REQUIRES_SIGNATURE.some((prefix) => meta.mimeType.startsWith(prefix))) {
      return {
        verdict: 'infected',
        detail: `Declared ${meta.mimeType} but the bytes carry no matching signature`,
        scanner: this.name,
      };
    }
    return { verdict: 'clean', detail: null, scanner: this.name };
  }
}

/** Declared types that must begin with a recognisable signature. */
const REQUIRES_SIGNATURE = ['image/', 'audio/', 'video/', 'application/pdf'];

/** Magic-number sniffing for the formats EverEcho accepts. */
export function sniffType(body: Buffer): string | null {
  const b = body;
  const startsWith = (...bytes: number[]) => bytes.every((x, i) => b[i] === x);

  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
  if (startsWith(0x49, 0x49, 0x2a, 0x00) || startsWith(0x4d, 0x4d, 0x00, 0x2a)) return 'image/tiff';
  if (startsWith(0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm';
  if (startsWith(0x4f, 0x67, 0x67, 0x53)) return 'audio/ogg';
  if (startsWith(0x52, 0x49, 0x46, 0x46) && b.subarray(8, 12).toString('latin1') === 'WAVE') return 'audio/wav';
  if (startsWith(0x49, 0x44, 0x33) || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.subarray(8, 12).toString('latin1');
    return brand.startsWith('M4A') ? 'audio/mp4' : 'video/mp4';
  }
  if (startsWith(0x52, 0x49, 0x46, 0x46) && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** WebM and Ogg carry both audio and video; a container mismatch is not an attack. */
function typesAgree(sniffed: string, declared: string): boolean {
  if (sniffed === declared) return true;
  const container = ['video/webm', 'audio/webm', 'audio/ogg', 'video/ogg', 'video/mp4', 'audio/mp4', 'video/quicktime'];
  return container.includes(sniffed) && container.includes(declared);
}

/**
 * ClamAV over its TCP protocol. UNVERIFIED in this build: no ClamAV daemon was
 * reachable. Set SCAN_DRIVER=clamav with CLAMAV_HOST and CLAMAV_PORT to use it.
 */
export class ClamAvScanAdapter implements ScanAdapter {
  readonly name = 'clamav';
  constructor(private readonly cfg: AppConfig) {}

  async scan(body: Buffer): Promise<ScanResult> {
    const host = this.cfg.env.CLAMAV_HOST;
    const port = this.cfg.env.CLAMAV_PORT;
    if (!host || !port) throw new Error('CLAMAV_HOST and CLAMAV_PORT are required');

    const net = await import('node:net');
    return new Promise<ScanResult>((resolvePromise, reject) => {
      const socket = net.createConnection({ host, port }, () => {
        socket.write('zINSTREAM\0');
        const size = Buffer.alloc(4);
        size.writeUInt32BE(body.byteLength);
        socket.write(size);
        socket.write(body);
        socket.write(Buffer.from([0, 0, 0, 0]));
      });
      let response = '';
      socket.on('data', (chunk) => (response += chunk.toString('utf8')));
      socket.on('error', reject);
      socket.on('end', () => {
        if (response.includes('OK') && !response.includes('FOUND')) {
          resolvePromise({ verdict: 'clean', detail: null, scanner: this.name });
        } else if (response.includes('FOUND')) {
          resolvePromise({ verdict: 'infected', detail: response.trim(), scanner: this.name });
        } else {
          resolvePromise({ verdict: 'error', detail: response.trim(), scanner: this.name });
        }
      });
    });
  }
}

export function createScanner(cfg: AppConfig): ScanAdapter {
  return cfg.env.SCAN_DRIVER === 'clamav' ? new ClamAvScanAdapter(cfg) : new LocalScanAdapter(cfg);
}
