import { z } from 'zod';

export const memorialProfileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  relationship: z.string().trim().max(100),
  language: z.enum(['en', 'hi']),
  personality: z.string().trim().max(2000),
  memories: z.string().trim().min(1).max(8000),
  phrases: z.string().trim().max(1000),
  tone: z.enum(['gentle', 'warm', 'reflective', 'cheerful']),
});
export type MemorialProfile = z.infer<typeof memorialProfileSchema>;
export const memorialMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(1500),
});
export const memorialTurnSchema = z.object({
  profile: memorialProfileSchema,
  history: z.array(memorialMessageSchema).max(12),
  message: z.string().trim().min(1).max(1500),
  acknowledged: z.literal(true),
  allowCloud: z.boolean(),
  voiceToken: z.string().max(2000).nullable().default(null),
});
export const memorialReplySchema = z.object({
  text: z.string(),
  mode: z.enum(['local-preview', 'ai-simulation']),
  audio: z.string().nullable(),
  voiceError: z.string().nullable(),
});
export type MemorialReply = z.infer<typeof memorialReplySchema>;
export const memorialStatusSchema = z.object({
  available: z.boolean(),
  conversationReady: z.boolean(),
  voiceReady: z.boolean(),
});
export type MemorialStatus = z.infer<typeof memorialStatusSchema>;
