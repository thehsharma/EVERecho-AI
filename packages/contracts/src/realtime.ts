import { z } from 'zod';
import { evidenceClassSchema } from './enums';
import { idSchema, locatorSchema, timestampSchema } from './primitives';
import { learningSummarySchema } from './learning';

// ---------------------------------------------------------------------------
// Session shape
// ---------------------------------------------------------------------------

/**
 * Mode A is the storyteller being interviewed. Mode B is an authorised reader
 * asking the archive questions. They differ in who may start one, what may be
 * retrieved, and what a conversation is allowed to become.
 */
export const realtimeModeSchema = z.enum(['interview', 'assistant']);
export type RealtimeMode = z.infer<typeof realtimeModeSchema>;

/**
 * Server-authoritative session state. The client renders this; it never
 * assigns it.
 */
export const realtimeStateSchema = z.enum([
  'CREATED',
  'CONNECTING',
  'READY',
  'LISTENING',
  'TRANSCRIBING',
  'THINKING',
  'SPEAKING',
  'INTERRUPTED',
  'PAUSED',
  'RECONNECTING',
  'ENDING',
  'ENDED',
  'FAILED',
]);
export type RealtimeState = z.infer<typeof realtimeStateSchema>;

/** States from which no further work is possible. */
export const TERMINAL_STATES = ['ENDED', 'FAILED'] as const satisfies readonly RealtimeState[];

export const realtimeLanguageSchema = z.enum(['en', 'hi', 'hi-Latn', 'auto']);
export type RealtimeLanguage = z.infer<typeof realtimeLanguageSchema>;

export const createRealtimeSessionRequestSchema = z.object({
  mode: realtimeModeSchema,
  language: realtimeLanguageSchema.default('auto'),
  /** Text-only from the start, for a user who cannot or will not use a microphone. */
  textOnly: z.boolean().default(false),
  /** Restricts assistant retrieval to specific sources when the reader wants that. */
  sourceIds: z.array(idSchema).max(50).optional(),
});

export const realtimeSessionSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  mode: realtimeModeSchema,
  state: realtimeStateSchema,
  language: realtimeLanguageSchema,
  textOnly: z.boolean(),
  /** Sequence number of the last server event. Lets a client detect gaps. */
  sequence: z.number().int().min(0),
  consentPolicyVersion: z.string(),
  learningPolicyVersion: z.number().int().min(1).nullable(),
  /** What the storyteller's learning policy permits, resolved for this session. */
  capabilities: z.object({
    mayStoreTranscript: z.boolean(),
    mayStoreAudio: z.boolean(),
    mayExtractCandidates: z.boolean(),
    mayUseProviderSpeechToText: z.boolean(),
    mayUseProviderSpeechSynthesis: z.boolean(),
    mayUseProviderComposition: z.boolean(),
    mayAutoSavePreferences: z.boolean(),
  }),
  /** Always shown in the interface. Never varies. */
  assistantIdentity: z.string(),
  ttsVoiceId: z.string(),
  startedAt: timestampSchema,
  endedAt: timestampSchema.nullable(),
  endedReason: z.string().nullable(),
});
export type RealtimeSession = z.infer<typeof realtimeSessionSchema>;

export const reconnectTokenSchema = z.object({
  token: z.string().min(16),
  expiresAt: timestampSchema,
});

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

export const turnSpeakerSchema = z.enum(['user', 'assistant']);
export type TurnSpeaker = z.infer<typeof turnSpeakerSchema>;

export const realtimeCitationSchema = z.object({
  claimId: idSchema,
  memoryId: idSchema,
  sourceId: idSchema,
  sourceFilename: z.string(),
  sourceKind: z.string(),
  locator: locatorSchema,
  quotedText: z.string(),
});

export const realtimeClaimSchema = z.object({
  index: z.number().int().min(0),
  text: z.string(),
  evidenceClass: evidenceClassSchema,
  confidence: z.number().min(0).max(1),
  verified: z.boolean(),
  /** True once this clause has actually been spoken. */
  spoken: z.boolean(),
  citations: z.array(realtimeCitationSchema),
  contradictionIds: z.array(idSchema),
});

export type RealtimeCitation = z.infer<typeof realtimeCitationSchema>;
export type RealtimeClaim = z.infer<typeof realtimeClaimSchema>;

export const realtimeTurnSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  index: z.number().int().min(0),
  speaker: turnSpeakerSchema,
  text: z.string(),
  /** Final turns are the only ones eligible to become evidence. */
  isFinal: z.boolean(),
  /** An assistant turn cut short by the user speaking. */
  cancelled: z.boolean(),
  language: z.string().nullable(),
  claims: z.array(realtimeClaimSchema),
  abstained: z.boolean(),
  abstentionReason: z.string().nullable(),
  /** Present on assistant turns so an answer can be reproduced later. */
  retrievalSnapshotId: idSchema.nullable(),
  modelName: z.string().nullable(),
  modelVersion: z.string().nullable(),
  promptVersion: z.string().nullable(),
  ttsProvider: z.string().nullable(),
  ttsVoiceId: z.string().nullable(),
  audioDurationMs: z.number().int().min(0).nullable(),
  latency: z
    .object({
      transcriptMs: z.number().int().min(0).nullable(),
      retrievalMs: z.number().int().min(0).nullable(),
      firstTokenMs: z.number().int().min(0).nullable(),
      firstAudioMs: z.number().int().min(0).nullable(),
      totalMs: z.number().int().min(0).nullable(),
    })
    .nullable(),
  createdAt: timestampSchema,
});
export type RealtimeTurn = z.infer<typeof realtimeTurnSchema>;

export const correctTurnRequestSchema = z.object({
  text: z.string().min(1).max(20000),
  reason: z.string().max(300).optional(),
});

// ---------------------------------------------------------------------------
// Transport events
// ---------------------------------------------------------------------------

/** Bumped when the wire format changes incompatibly. */
export const REALTIME_PROTOCOL_VERSION = 1;

export const clientEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.hello'),
    clientEventId: z.string().min(1).max(64),
    protocolVersion: z.number().int(),
    /** Present only when resuming an interrupted connection. */
    reconnectToken: z.string().optional(),
  }),
  z.object({
    type: z.literal('audio.chunk'),
    clientEventId: z.string().min(1).max(64),
    seq: z.number().int().min(0),
    /** base64 PCM16 mono. Bounded so one frame cannot exhaust memory. */
    audio: z.string().max(64_000),
    sampleRate: z.number().int().min(8000).max(48000),
  }),
  z.object({ type: z.literal('user.speech.started'), clientEventId: z.string().min(1).max(64) }),
  z.object({ type: z.literal('user.speech.ended'), clientEventId: z.string().min(1).max(64) }),
  z.object({
    type: z.literal('user.turn.commit'),
    clientEventId: z.string().min(1).max(64),
    /** Present for typed input, absent when the turn came from speech. */
    text: z.string().max(4000).optional(),
  }),
  z.object({ type: z.literal('user.interrupt'), clientEventId: z.string().min(1).max(64) }),
  z.object({ type: z.literal('session.pause'), clientEventId: z.string().min(1).max(64) }),
  z.object({ type: z.literal('session.resume'), clientEventId: z.string().min(1).max(64) }),
  z.object({
    type: z.literal('session.end'),
    clientEventId: z.string().min(1).max(64),
    reason: z.string().max(120).optional(),
  }),
  z.object({
    type: z.literal('client.ack'),
    clientEventId: z.string().min(1).max(64),
    seq: z.number().int().min(0),
  }),
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;

export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.state'),
    seq: z.number().int().min(0),
    state: realtimeStateSchema,
    reason: z.string().nullable(),
  }),
  z.object({
    type: z.literal('transcript.partial'),
    seq: z.number().int().min(0),
    turnIndex: z.number().int().min(0),
    text: z.string(),
    language: z.string().nullable(),
  }),
  z.object({
    type: z.literal('transcript.final'),
    seq: z.number().int().min(0),
    turnId: idSchema,
    turnIndex: z.number().int().min(0),
    text: z.string(),
    language: z.string().nullable(),
  }),
  z.object({ type: z.literal('assistant.thinking'), seq: z.number().int().min(0) }),
  z.object({
    type: z.literal('assistant.text.delta'),
    seq: z.number().int().min(0),
    turnIndex: z.number().int().min(0),
    /** A whole verified clause, never a raw token: unverified text is never sent. */
    clauseIndex: z.number().int().min(0),
    text: z.string(),
  }),
  z.object({
    type: z.literal('assistant.citation'),
    seq: z.number().int().min(0),
    turnIndex: z.number().int().min(0),
    clauseIndex: z.number().int().min(0),
    claim: realtimeClaimSchema,
  }),
  z.object({
    type: z.literal('assistant.audio.chunk'),
    seq: z.number().int().min(0),
    turnIndex: z.number().int().min(0),
    clauseIndex: z.number().int().min(0),
    audio: z.string(),
    sampleRate: z.number().int(),
    durationMs: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('assistant.turn.complete'),
    seq: z.number().int().min(0),
    turn: realtimeTurnSchema,
  }),
  z.object({
    type: z.literal('assistant.turn.cancelled'),
    seq: z.number().int().min(0),
    turnIndex: z.number().int().min(0),
    /** Clauses actually spoken before the interruption. */
    spokenClauseCount: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('learning.candidate'),
    seq: z.number().int().min(0),
    candidateId: idSchema,
    kind: z.string(),
    title: z.string(),
    requiresStorytellerReview: z.boolean(),
  }),
  z.object({
    type: z.literal('learning.summary'),
    seq: z.number().int().min(0),
    summary: learningSummarySchema,
  }),
  z.object({
    type: z.literal('policy.changed'),
    seq: z.number().int().min(0),
    /** What the session may still do after the change. */
    capabilities: realtimeSessionSchema.shape.capabilities,
    narrowed: z.boolean(),
  }),
  z.object({
    type: z.literal('warning'),
    seq: z.number().int().min(0),
    code: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('error'),
    seq: z.number().int().min(0),
    code: z.string(),
    message: z.string(),
    fatal: z.boolean(),
  }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;

// ---------------------------------------------------------------------------
// Cost and usage, reported without content
// ---------------------------------------------------------------------------

export const realtimeUsageSchema = z.object({
  sessionId: idSchema,
  sttSeconds: z.number().min(0),
  ttsCharacters: z.number().int().min(0),
  llmInputTokens: z.number().int().min(0),
  llmOutputTokens: z.number().int().min(0),
  transportSeconds: z.number().min(0),
  storedAudioBytes: z.number().int().min(0),
  estimatedCostMinor: z.number().int().min(0),
  currency: z.string(),
});
export type RealtimeUsage = z.infer<typeof realtimeUsageSchema>;
