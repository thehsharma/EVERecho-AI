import { z } from 'zod';
import { idSchema, timestampSchema } from './primitives';

export const createReservationRequestSchema = z.object({
  currency: z.enum(['INR', 'USD']),
  archiveId: idSchema.optional(),
  idempotencyKey: z.string().min(8).max(200),
});

export const reservationSchema = z.object({
  id: idSchema,
  status: z.enum(['pending', 'paid', 'refunded', 'failed', 'cancelled']),
  currency: z.enum(['INR', 'USD']),
  amountMinor: z.number().int(),
  /** Refundable by design: a deposit is a signal of intent, not a lock-in. */
  refundable: z.literal(true),
  checkoutUrl: z.string().nullable(),
  providerRef: z.string().nullable(),
  createdAt: timestampSchema,
  paidAt: timestampSchema.nullable(),
  refundedAt: timestampSchema.nullable(),
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
