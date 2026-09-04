import { z } from 'zod';
import { idSchema, timestampSchema } from './primitives';

/**
 * Hearing the actual recording.
 *
 * The shape carries one clip or none. Not an array: a response that could hold
 * two moments is a response somebody would eventually join, and two true
 * moments played as one are a sentence the person never said.
 */

export const voiceClipSchema = z.object({
  segmentId: idSchema,
  sourceAssetId: idSchema,
  /** A short-lived link to the original file. The bytes are never modified. */
  audioUrl: z.string(),
  audioExpiresAt: timestampSchema,
  /** Where playback begins, including lead-in, and where it ends. */
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  /** Her words, exactly as transcribed or as she corrected them. */
  text: z.string(),
  /** What she was talking about, read rather than played. */
  before: z.array(z.string()),
  after: z.array(z.string()),
  /**
   * When this recording entered the archive — not when it was spoken.
   *
   * The schema holds no recording date, and calling this one would invent a
   * fact about when somebody said something. The interface says "added" for
   * the same reason.
   */
  addedOn: timestampSchema.nullable(),
  sourceLabel: z.string(),
});
export type VoiceClip = z.infer<typeof voiceClipSchema>;

export const voiceAnswerSchema = z.object({
  /** Present only when a real recording answers the question. */
  clip: voiceClipSchema.nullable(),
  /**
   * What the archive says, in its own voice. Always present, always
   * attributable to the assistant and never to the person.
   */
  spokenByArchive: z.string(),
  /**
   * Why there is no clip, as a code. Absent when there is one.
   *
   * `audio_withheld` and `withheld_by_clause` are different answers and the
   * family is told which: "she asked us not to play this" is a fact about her,
   * and hiding it behind "nothing found" would misrepresent her.
   */
  reasonCode: z
    .enum([
      'played',
      'nothing_recorded',
      'audio_withheld',
      'withheld_by_clause',
      'withheld_by_default',
      'not_yet',
    ])
    .nullable(),
  /** Words that survive when the recording may not be played. */
  quotedText: z.string().nullable(),
});
export type VoiceAnswer = z.infer<typeof voiceAnswerSchema>;

export const askVoiceRequestSchema = z.object({
  question: z.string().min(1).max(2000),
});
