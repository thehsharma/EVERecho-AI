import { z } from 'zod';
import { idSchema, timestampSchema } from './primitives';

export const createReservationRequestSchema = z.object({
  currency: z.enum(['INR', 'USD']),
  archiveId: idSchema.optional(),
  idempotencyKey: z.string().min(8).max(200),
});

export const reservationSchema = z.object({
  id: idSchema,
  /**
   * `released` is not `refunded`. A refund is something the buyer asked for; a
   * release is what happens when the person the archive was bought for
   * declines. Same movement of money, different event, and collapsing them
   * would lose the only signal that says how often a gift is turned down.
   */
  status: z.enum(['pending', 'paid', 'refunded', 'failed', 'cancelled', 'released']),
  currency: z.enum(['INR', 'USD']),
  amountMinor: z.number().int(),
  /** Refundable by design: a deposit is a signal of intent, not a lock-in. */
  refundable: z.literal(true),
  checkoutUrl: z.string().nullable(),
  providerRef: z.string().nullable(),
  createdAt: timestampSchema,
  paidAt: timestampSchema.nullable(),
  refundedAt: timestampSchema.nullable(),
  releasedAt: timestampSchema.nullable(),
  /** Why it was released. A reason code, never the storyteller's own words. */
  releaseReasonCode: z.string().nullable(),
});
export type Reservation = z.infer<typeof reservationSchema>;

export const subscriptionSchema = z.object({
  id: idSchema,
  plan: z.string(),
  status: z.enum(['active', 'past_due', 'cancelled', 'none']),
  currentPeriodEnd: timestampSchema.nullable(),
});

export const billingSummarySchema = z.object({
  provider: z.string(),
  testMode: z.boolean(),
  currency: z.enum(['INR', 'USD']),
  reservationAmountMinor: z.number().int(),
  reservations: z.array(reservationSchema),
  subscription: subscriptionSchema.nullable(),
});
