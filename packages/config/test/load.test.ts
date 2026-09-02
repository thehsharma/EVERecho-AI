import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/load';
import { branding, features } from '../src/branding';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://everecho:everecho@localhost:5432/everecho_test',
};

describe('loadConfig', () => {
  it('applies safe defaults in test', () => {
    const cfg = loadConfig(base);
    expect(cfg.isTest).toBe(true);
    expect(cfg.env.STORAGE_DRIVER).toBe('local');
    expect(cfg.env.LLM_DRIVER).toBe('local');
    expect(cfg.uploadAllowedMime).toContain('image/jpeg');
  });

  it('refuses to enable perform mode in any environment', () => {
    expect(() => loadConfig({ ...base, FEATURE_PERFORM_MODE: 'true' })).toThrow(ConfigError);
  });

  it('refuses to execute succession transitions', () => {
    expect(() => loadConfig({ ...base, FEATURE_SUCCESSION_EXECUTION: 'true' })).toThrow(
      ConfigError,
    );
  });

  it('rejects development defaults in production', () => {
    let error: unknown;
    try {
      loadConfig({ ...base, NODE_ENV: 'production' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const issues = (error as ConfigError).issues.join('\n');
    expect(issues).toMatch(/SESSION_SECRET/);
    expect(issues).toMatch(/COOKIE_SECURE/);
    expect(issues).toMatch(/AUTH_DRIVER=local/);
    expect(issues).toMatch(/STORAGE_DRIVER=local/);
  });

  it('requires provider credentials when a hosted driver is selected', () => {
    expect(() => loadConfig({ ...base, LLM_DRIVER: 'anthropic' })).toThrow(/LLM_API_KEY/);
  });

  it('requires bucket configuration when storage is s3', () => {
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
  });

  it('rejects short secrets outright', () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'short' })).toThrow(ConfigError);
  });

  it('sends nothing anywhere unless a deployment asks it to', () => {
    // The default has to be local, not "local unless someone forgot". A
    // deployment that configures nothing must not put live microphone audio on
    // somebody else's network.
    const cfg = loadConfig(base);
    expect(cfg.env.REALTIME_STT_DRIVER).toBe('local');
    expect(cfg.env.REALTIME_LLM_DRIVER).toBe('local');
    expect(cfg.env.REALTIME_TTS_DRIVER).toBe('local');
  });

  it('requires credentials for each hosted real-time provider', () => {
    expect(() => loadConfig({ ...base, REALTIME_STT_DRIVER: 'deepgram' })).toThrow(
      /DEEPGRAM_API_KEY/,
    );
    expect(() => loadConfig({ ...base, REALTIME_TTS_DRIVER: 'deepgram' })).toThrow(
      /DEEPGRAM_API_KEY/,
    );
    expect(() => loadConfig({ ...base, REALTIME_LLM_DRIVER: 'anthropic' })).toThrow(/LLM_API_KEY/);
  });

  it('refuses a hosted real-time provider that may train on what it is sent', () => {
    // Refused in every environment, not only production: a developer pointing
    // a real microphone at such a provider is exactly the case this is for.
    expect(() =>
      loadConfig({
        ...base,
        REALTIME_STT_DRIVER: 'deepgram',
        DEEPGRAM_API_KEY: 'k',
        AI_PROVIDER_NO_TRAINING: 'false',
      }),
    ).toThrow(/AI_PROVIDER_NO_TRAINING must remain true/);
  });

  it('accepts a fully configured hosted real-time deployment', () => {
    const cfg = loadConfig({
      ...base,
      REALTIME_STT_DRIVER: 'deepgram',
      REALTIME_TTS_DRIVER: 'deepgram',
      REALTIME_LLM_DRIVER: 'anthropic',
      DEEPGRAM_API_KEY: 'dg-key',
      LLM_API_KEY: 'llm-key',
    });
    expect(cfg.env.DEEPGRAM_STT_MODEL).toBe('nova-3');
    expect(cfg.env.REALTIME_VOICE_ID).toBe('assistant-neutral-en-v1');
  });

  it('exposes branding and hard-disabled feature flags', () => {
    const cfg = loadConfig(base);
    expect(branding(cfg).trademarkStatus).toBe('working-codename-pending-clearance');
    expect(features(cfg).performMode).toBe(false);
    expect(features(cfg).successionExecution).toBe(false);
  });
});
