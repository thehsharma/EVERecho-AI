import { z } from 'zod';

/** Stable opaque identifier. UUIDv4 in storage; opaque to every consumer. */
export const idSchema = z.uuid();
export type Id = z.infer<typeof idSchema>;

/** All timestamps are UTC ISO-8601 strings on the wire. */
export const timestampSchema = z.iso.datetime();

/** A calendar date whose precision the storyteller may not remember exactly. */
export const datePrecisionSchema = z.enum(['day', 'month', 'year', 'decade', 'unknown']);
export type DatePrecision = z.infer<typeof datePrecisionSchema>;

export const approximateDateSchema = z.object({
  value: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'expected YYYY, YYYY-MM or YYYY-MM-DD'),
  precision: datePrecisionSchema,
});
export type ApproximateDate = z.infer<typeof approximateDateSchema>;

export const paginationSchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type Pagination = z.infer<typeof paginationSchema>;

export function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    /** Total is deliberately optional: exact counts leak archive size to unauthorised probes. */
    hasMore: z.boolean(),
  });
}

/** Locates a claim inside its source: a transcript span, a PDF page, an image region. */
export const locatorSchema = z.object({
  kind: z.enum(['transcript_segment', 'page', 'timestamp', 'text_range', 'whole_asset']),
  segmentId: idSchema.optional(),
  page: z.number().int().min(1).optional(),
  startMs: z.number().int().min(0).optional(),
  endMs: z.number().int().min(0).optional(),
  startChar: z.number().int().min(0).optional(),
  endChar: z.number().int().min(0).optional(),
});
export type Locator = z.infer<typeof locatorSchema>;

export const checksumSchema = z.object({
  algorithm: z.literal('sha256'),
  value: z.string().regex(/^[0-9a-f]{64}$/),
});
export type Checksum = z.infer<typeof checksumSchema>;
