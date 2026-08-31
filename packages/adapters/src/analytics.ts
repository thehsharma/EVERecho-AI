import { createHmac } from 'node:crypto';
import {
  analyticsEventSchema,
  type AnalyticsEvent,
  type AnalyticsEventName,
} from '@everecho/contracts';
import type { AppConfig } from '@everecho/config';

/**
 * Privacy-safe product analytics.
 *
 * Identifiers are salted HMACs, so the same user is countable across events but
 * cannot be resolved back to a person from the analytics store. Property values
 * are restricted by schema to numbers, booleans and a three-value bucket, which
 * is what makes "we accidentally logged a memory" structurally impossible rather
 * than merely discouraged.
 */
export interface AnalyticsAdapter {
  readonly name: string;
  track(event: AnalyticsEvent): Promise<void>;
  flush(): Promise<void>;
}

export class AnalyticsRecorder {
  constructor(
    private readonly adapter: AnalyticsAdapter,
    private readonly salt: string,
  ) {}

  opaque(value: string | null | undefined): string | null {
    if (!value) return null;
    return createHmac('sha256', this.salt).update(value).digest('hex').slice(0, 32);
  }

  async track(
    name: AnalyticsEventName,
    options: {
      actorId?: string | null;
      archiveId?: string | null;
      props?: Record<string, number | boolean | 'low' | 'medium' | 'high' | null>;
    } = {},
  ): Promise<void> {
    const event = analyticsEventSchema.parse({
      name,
      opaqueActorId: this.opaque(options.actorId),
      opaqueArchiveId: this.opaque(options.archiveId),
      props: options.props ?? {},
      occurredAt: new Date().toISOString(),
    });
    await this.adapter.track(event);
  }
}

/** Buffers in memory and hands rows to a sink; the API persists them. */
export class LocalAnalyticsAdapter implements AnalyticsAdapter {
  readonly name = 'local';
  readonly events: AnalyticsEvent[] = [];

  constructor(private readonly sink?: (event: AnalyticsEvent) => Promise<void>) {}

  async track(event: AnalyticsEvent): Promise<void> {
    this.events.push(event);
    if (this.events.length > 1000) this.events.shift();
    await this.sink?.(event);
  }

  async flush(): Promise<void> {}
}

export class NullAnalyticsAdapter implements AnalyticsAdapter {
  readonly name = 'none';
  async track(): Promise<void> {}
  async flush(): Promise<void> {}
}

export function createAnalytics(
  cfg: AppConfig,
  sink?: (event: AnalyticsEvent) => Promise<void>,
): AnalyticsAdapter {
  if (cfg.env.ANALYTICS_DRIVER === 'none') return new NullAnalyticsAdapter();
  // A hosted analytics driver would be constructed here; local buffering keeps
  // the same call sites and the same schema enforcement.
  return new LocalAnalyticsAdapter(sink);
}
