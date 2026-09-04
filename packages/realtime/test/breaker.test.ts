import { describe, expect, it } from 'vitest';
import { BreakerRegistry, CircuitBreaker } from '../src/index';

/**
 * The breaker exists for a provider that is down for ten minutes while
 * somebody keeps talking to it — not for a single failed turn.
 */

describe('the provider circuit breaker', () => {
  it('lets everything through while the provider is healthy', () => {
    const breaker = new CircuitBreaker('tts', { threshold: 3, cooldownMs: 1000 });
    for (let i = 0; i < 10; i += 1) {
      expect(breaker.allows()).toBe(true);
      breaker.succeeded();
    }
    expect(breaker.state).toBe('closed');
  });

  it('opens only after the threshold, not on one bad turn', () => {
    const breaker = new CircuitBreaker('tts', { threshold: 3, cooldownMs: 1000 });
    breaker.failed();
    breaker.failed();
    expect(breaker.state).toBe('closed');
    breaker.failed();
    expect(breaker.state).toBe('open');
    expect(breaker.allows()).toBe(false);
  });

  it('forgets failures that a success came after', () => {
    // Two failures an hour apart are not a provider that is down.
    const breaker = new CircuitBreaker('tts', { threshold: 2, cooldownMs: 1000 });
    breaker.failed();
    breaker.succeeded();
    breaker.failed();
    expect(breaker.state).toBe('closed');
  });

  it('admits exactly one probe once the cooldown has passed', () => {
    let clock = 0;
    const breaker = new CircuitBreaker('tts', {
      threshold: 1,
      cooldownMs: 1000,
      now: () => clock,
    });
    breaker.failed();
    expect(breaker.state).toBe('open');
    clock = 2000;
    // Cooldown elapsed: half-open, and the *first* caller gets through.
    expect(breaker.allows()).toBe(true);
    // The point of a probe is to find out whether it recovered. Sending a
    // hundred to find that out is the stampede the breaker was opened for.
    expect(breaker.allows()).toBe(false);
  });

  it('closes again when the probe succeeds', () => {
    let clock = 0;
    const breaker = new CircuitBreaker('tts', {
      threshold: 1,
      cooldownMs: 1000,
      now: () => clock,
    });
    breaker.failed();
    clock = 2000;
    breaker.allows();
    breaker.succeeded();
    expect(breaker.state).toBe('closed');
    expect(breaker.allows()).toBe(true);
  });

  it('reopens when the probe fails', () => {
    let clock = 0;
    const breaker = new CircuitBreaker('tts', {
      threshold: 1,
      cooldownMs: 1000,
      now: () => clock,
    });
    breaker.failed();
    clock = 2000;
    expect(breaker.allows()).toBe(true);
    breaker.failed();
    expect(breaker.state).toBe('open');
    expect(breaker.retryAfterMs()).toBe(1000);
  });

  it('keeps one breaker per provider, not one per conversation', () => {
    // A provider that is down is down for everybody. A per-session breaker
    // would learn that once per conversation.
    const registry = new BreakerRegistry({ threshold: 1, cooldownMs: 1000 });
    registry.for('deepgram-speak-streaming').failed();
    expect(registry.for('deepgram-speak-streaming').state).toBe('open');
    expect(registry.for('anthropic-messages-streaming').state).toBe('closed');
  });

  it('reports state with no conversation content in it', () => {
    const registry = new BreakerRegistry({ threshold: 1, cooldownMs: 1000 });
    registry.for('deepgram-speak-streaming').failed();
    expect(registry.snapshot()).toEqual([
      { name: 'deepgram-speak-streaming', state: 'open', retryAfterMs: expect.any(Number) },
    ]);
  });
});
