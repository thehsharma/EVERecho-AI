import { z } from 'zod';
import { evidenceClassSchema } from './enums';
import { approximateDateSchema, idSchema, timestampSchema } from './primitives';

export const timelineEntrySchema = z.object({
  id: idSchema,
  kind: z.enum(['event', 'memory']),
  title: z.string(),
  summary: z.string(),
  date: approximateDateSchema.nullable(),
  /** Entries with no date are surfaced separately, never invented into a year. */
  placeName: z.string().nullable(),
  evidenceClass: evidenceClassSchema,
  sourceIds: z.array(idSchema),
  memoryId: idSchema.nullable(),
});
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const timelineSchema = z.object({
  archiveId: idSchema,
  entries: z.array(timelineEntrySchema),
  undatedEntries: z.array(timelineEntrySchema),
  generatedAt: timestampSchema,
  coverage: z.object({
    earliestYear: z.number().int().nullable(),
    latestYear: z.number().int().nullable(),
    decadesCovered: z.array(z.number().int()),
    /** Honest gaps drive the next interview, instead of being papered over. */
    decadeGaps: z.array(z.number().int()),
  }),
});
export type Timeline = z.infer<typeof timelineSchema>;

export const biographySchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  /** Third person, always. First-person composition is rejected in code. */
  sections: z.array(
    z.object({
      id: z.string(),
      heading: z.string(),
      text: z.string(),
      sourceIds: z.array(idSchema),
      claimIds: z.array(idSchema),
      edited: z.boolean(),
    }),
  ),
  status: z.enum(['draft', 'edited', 'approved']),
  modelVersion: z.string(),
  promptVersion: z.string(),
  policyVersion: z.string(),
  generatedAt: timestampSchema,
  wordCount: z.number().int(),
  aiAssisted: z.literal(true),
});
export type Biography = z.infer<typeof biographySchema>;

export const updateBiographySectionRequestSchema = z.object({
  heading: z.string().min(1).max(200).optional(),
  text: z.string().min(1).max(20_000).optional(),
});
