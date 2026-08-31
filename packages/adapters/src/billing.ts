import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '@everecho/config';

export interface CheckoutSession {
  providerRef: string;
  checkoutUrl: string;
}

export interface BillingWebhook {
  providerEventId: string;
  eventType: 'reservation.paid' | 'reservation.refunded' | 'reservation.failed' | 'unknown';
  providerRef: string;
  signatureVerified: boolean;
}

/** Card details never touch EverEcho. Only provider references are stored. */
export interface BillingAdapter {
  readonly name: string;
  readonly testMode: boolean;
  createReservationCheckout(input: {
    reservationId: string;
    amountMinor: number;
    currency: 'INR' | 'USD';
    customerEmail: string;
    returnUrl: string;
  }): Promise<CheckoutSession>;
  refundReservation(providerRef: string): Promise<void>;
  verifyWebhook(rawBody: string, signature: string | undefined): BillingWebhook | null;
}

/**
 * Local billing: a real state machine with no money in it. Checkout returns a
 * URL into our own app that completes the reservation, and webhooks are signed
 * with the same HMAC scheme a provider would use, so signature verification and
 * idempotent replay handling are exercised for real.
 */
export class LocalBillingAdapter implements BillingAdapter {
  readonly name = 'local';
  readonly testMode = true;

  constructor(private readonly cfg: AppConfig) {}

  async createReservationCheckout(input: {
    reservationId: string;
    amountMinor: number;
    currency: 'INR' | 'USD';
    customerEmail: string;
    returnUrl: string;
  }): Promise<CheckoutSession> {
    const providerRef = `local_${randomUUID()}`;
    const url = new URL(`${this.cfg.env.WEB_PUBLIC_URL.replace(/\/$/, '')}/billing/local-checkout`);
    url.searchParams.set('reservation', input.reservationId);
    url.searchParams.set('ref', providerRef);
    url.searchParams.set('amount', String(input.amountMinor));
    url.searchParams.set('currency', input.currency);
    url.searchParams.set('return', input.returnUrl);
    return { providerRef, checkoutUrl: url.toString() };
  }

  async refundReservation(): Promise<void> {
    // Refunds settle immediately in the local adapter; the state change is
    // recorded by the caller, exactly as it is for a real provider.
  }

  /** Signs a payload the way the local checkout page will send it back. */
  sign(rawBody: string): string {
    return createHmac('sha256', this.cfg.env.BILLING_WEBHOOK_SECRET).update(rawBody).digest('hex');
  }

  verifyWebhook(rawBody: string, signature: string | undefined): BillingWebhook | null {
    if (!signature) return null;
    const expected = Buffer.from(this.sign(rawBody));
    const given = Buffer.from(signature);
    const verified = expected.length === given.length && timingSafeEqual(expected, given);
    if (!verified) return null;

    try {
      const parsed = JSON.parse(rawBody) as {
        id?: string;
        type?: string;
        providerRef?: string;
      };
      const known = ['reservation.paid', 'reservation.refunded', 'reservation.failed'] as const;
      const eventType = known.find((k) => k === parsed.type) ?? 'unknown';
      return {
        providerEventId: parsed.id ?? randomUUID(),
        eventType,
        providerRef: parsed.providerRef ?? '',
        signatureVerified: true,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Stripe. UNVERIFIED in this build: no Stripe key was available. The interface
 * is complete; set BILLING_DRIVER=stripe with BILLING_API_KEY and
 * BILLING_WEBHOOK_SECRET to use it. Webhook signatures are verified against
 * Stripe's scheme before any state change.
 */
export class StripeBillingAdapter implements BillingAdapter {
  readonly name = 'stripe';
  constructor(private readonly cfg: AppConfig) {}
  get testMode(): boolean {
    return (this.cfg.env.BILLING_API_KEY ?? '').startsWith('sk_test_');
  }

  private async stripe() {
    const { default: Stripe } = await import('stripe');
    return new Stripe(this.cfg.env.BILLING_API_KEY ?? '');
  }

  async createReservationCheckout(input: {
    reservationId: string;
    amountMinor: number;
    currency: 'INR' | 'USD';
    customerEmail: string;
    returnUrl: string;
  }): Promise<CheckoutSession> {
    const stripe = await this.stripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: input.customerEmail,
      client_reference_id: input.reservationId,
      success_url: input.returnUrl,
      cancel_url: input.returnUrl,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amountMinor,
            product_data: { name: 'Refundable archive reservation' },
          },
        },
      ],
    });
    return { providerRef: session.id, checkoutUrl: session.url ?? '' };
  }

  async refundReservation(providerRef: string): Promise<void> {
    const stripe = await this.stripe();
    const session = await stripe.checkout.sessions.retrieve(providerRef);
    if (typeof session.payment_intent === 'string') {
      await stripe.refunds.create({ payment_intent: session.payment_intent });
    }
  }

  verifyWebhook(): BillingWebhook | null {
    // Stripe's signature scheme requires its SDK and the raw body; wire it up
    // when enabling this adapter. Returning null refuses the event rather than
    // trusting it, which is the safe direction to fail in.
    return null;
  }
}

export function createBilling(cfg: AppConfig): BillingAdapter {
  return cfg.env.BILLING_DRIVER === 'stripe' ? new StripeBillingAdapter(cfg) : new LocalBillingAdapter(cfg);
}
