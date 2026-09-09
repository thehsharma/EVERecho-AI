import { createHash } from 'node:crypto';
import type { AppConfig } from '@everecho/config';
import { contentTokens } from './text';

export interface EmbeddingAdapter {
  readonly name: string;
  readonly model: string;
  readonly dim: number;
  embed(texts: readonly string[]): Promise<number[][]>;
}

/**
 * Deterministic hashed-bag-of-words embeddings.
 *
 * Each content token and each adjacent bigram is hashed into buckets with a
 * sub-linear term weight, then the vector is L2-normalised. It is not a
 * learned model and is never described as one: it is a stable, dependency-free
 * lexical embedding that makes semantic-ish retrieval work offline and makes
 * every test reproducible. Swap EMBEDDINGS_DRIVER to use a real model.
 */
export class LocalEmbeddingAdapter implements EmbeddingAdapter {
  readonly name = 'local-hashed';
  readonly model: string;
  readonly dim: number;

  constructor(cfg: AppConfig) {
    this.model = cfg.env.EMBEDDINGS_MODEL;
    this.dim = cfg.env.EMBEDDINGS_DIM;
  }

  private bucket(token: string): number {
    const digest = createHash('sha256').update(token).digest();
    return digest.readUInt32BE(0) % this.dim;
  }

  private sign(token: string): number {
    const digest = createHash('sha256').update(`sign:${token}`).digest();
    return (digest[0]! & 1) === 0 ? 1 : -1;
  }

  embedOne(text: string): number[] {
    const vector = new Array<number>(this.dim).fill(0);
    const tokens = contentTokens(text);
    const counts = new Map<string, number>();

    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    for (let i = 0; i < tokens.length - 1; i += 1) {
      const bigram = `${tokens[i]}_${tokens[i + 1]}`;
      counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
    }

    for (const [token, count] of counts) {
      // Sub-linear weighting: the tenth mention of "school" adds less than the first.
      const weight = 1 + Math.log(count);
      vector[this.bucket(token)]! += weight * this.sign(token);
    }

    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return norm === 0 ? vector : vector.map((v) => v / norm);
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }
}

/**
 * Hosted embeddings over an OpenAI-compatible endpoint.
 * UNVERIFIED in this build: no API key was available.
 */
export class HostedEmbeddingAdapter implements EmbeddingAdapter {
  readonly name: string;
  readonly model: string;
  readonly dim: number;

  constructor(private readonly cfg: AppConfig) {
    this.name = cfg.env.EMBEDDINGS_DRIVER;
    this.model = cfg.env.EMBEDDINGS_MODEL;
    this.dim = cfg.env.EMBEDDINGS_DIM;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const base = this.cfg.env.LLM_BASE_URL ?? 'https://api.openai.com/v1';
    const response = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.cfg.env.EMBEDDINGS_API_KEY ?? ''}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!response.ok) {
      throw new Error(`Embedding provider returned ${response.status}`);
    }
    const payload = (await response.json()) as { data: { embedding: number[] }[] };
    return payload.data.map((d) => d.embedding);
  }
}

export function createEmbeddings(cfg: AppConfig): EmbeddingAdapter {
  return cfg.env.EMBEDDINGS_DRIVER === 'local'
    ? new LocalEmbeddingAdapter(cfg)
    : new HostedEmbeddingAdapter(cfg);
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
