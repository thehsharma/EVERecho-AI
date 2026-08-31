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
    expect(() => loadConfig({ ...base, FEATURE_SUCCESSION_EXECUTION: 'true' })).toThrow(ConfigError);
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

  it('exposes branding and hard-disabled feature flags', () => {
    const cfg = loadConfig(base);
    expect(branding(cfg).trademarkStatus).toBe('working-codename-pending-clearance');
    expect(features(cfg).performMode).toBe(false);
    expect(features(cfg).successionExecution).toBe(false);
  });
});
