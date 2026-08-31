import type { AppConfig } from '@everecho/config';
import { AnthropicLlmAdapter } from './anthropic';
import { LocalLlmAdapter } from './local';
import type { LlmAdapter } from './types';

export * from './types';
export { LocalLlmAdapter } from './local';
export { AnthropicLlmAdapter } from './anthropic';

export function createLlm(cfg: AppConfig): LlmAdapter {
  return cfg.env.LLM_DRIVER === 'anthropic' ? new AnthropicLlmAdapter(cfg) : new LocalLlmAdapter(cfg);
}
