/**
 * A circuit breaker for a live conversation.
 *
 * The failure this exists for is not a single provider error — that shows as
 * one turn the assistant could not answer. It is a provider that is down for
 * ten minutes while somebody keeps talking to it: every turn waits for a
 * timeout, every turn costs a request, and the person is left wondering what
 * they did wrong. Opening the circuit turns that into an immediate, honest
 * "not right now".
 *
 * Deliberately per-process and in memory. It is a latency and cost guard, not
 * a correctness one: two API instances disagreeing about whether a provider is
 * healthy costs one extra probe, and coordinating them through the database
 * would put a write on the path of every turn to solve a problem that does not
 * exist.
 */

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface BreakerOptions {
  /** Consecutive failures before it opens. */
  threshold: number;
  /** How long it stays open before one request is allowed through. */
  cooldownMs: number;
  now?: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  /** Set while a half-open probe is in flight, so only one gets through. */
  private probing = false;

  constructor(
    readonly name: string,
    private readonly options: BreakerOptions,
  ) {}

  private get clock(): () => number {
    return this.options.now ?? (() => Date.now());
  }

  get state(): BreakerState {
    if (this.openedAt === null) return 'closed';
    if (this.clock() - this.openedAt < this.options.cooldownMs) return 'open';
    return 'half_open';
  }

  /**
   * Whether a request may go to the provider now.
   *
   * A half-open circuit admits exactly one, because the point of the probe is
   * to find out whether the provider has recovered — sending a hundred to find
   * that out is the stampede the breaker was opened to prevent.
   */
  allows(): boolean {
    const state = this.state;
    if (state === 'closed') return true;
    if (state === 'open') return false;
    if (this.probing) return false;
    this.probing = true;
    return true;
  }

  succeeded(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probing = false;
  }

  failed(): void {
    this.probing = false;
    this.failures += 1;
    if (this.failures >= this.options.threshold) this.openedAt = this.clock();
  }

  /** Milliseconds until the next probe is allowed, or 0 when one is. */
  retryAfterMs(): number {
    if (this.openedAt === null) return 0;
    return Math.max(0, this.options.cooldownMs - (this.clock() - this.openedAt));
  }
}

/**
 * One breaker per provider, kept for the life of the process.
 *
 * Keyed by provider name rather than by session: a provider that is down is
 * down for everybody, and a per-session breaker would learn that fact once per
 * conversation.
 */
export class BreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly options: BreakerOptions) {}

  for(name: string): CircuitBreaker {
    const existing = this.breakers.get(name);
    if (existing) return existing;
    const created = new CircuitBreaker(name, this.options);
    this.breakers.set(name, created);
    return created;
  }

  /** What an operator needs to see, with no conversation content in it. */
  snapshot(): { name: string; state: BreakerState; retryAfterMs: number }[] {
    return [...this.breakers.values()].map((breaker) => ({
      name: breaker.name,
      state: breaker.state,
      retryAfterMs: breaker.retryAfterMs(),
    }));
  }
}
