# Razorpay family plan

The /account/plan page reads the price and billing frequency from your Razorpay plan.
The application does not invent a price. Users review recurring-payment terms at
Razorpay before authorizing payment. Card details never reach EverEcho.

Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET and
RAZORPAY_FAMILY_PLAN_ID in the ignored server .env. Start with Razorpay test keys.
RAZORPAY_SUBSCRIPTION_CYCLES defaults to 12; check that this matches your offer.
Configure subscription webhooks to POST /v1/webhooks/razorpay on your public API.
The exact raw bytes are authenticated with SHA-256 HMAC. Event IDs are deduplicated
in the same transaction as the update. Current provider state is fetched under a
row lock so old webhook deliveries cannot replay old subscription states.

An active subscription raises the account's daily memorial-request allowance only
until the provider's current_end date. It does not grant access to another person's
archive, a family member's private profile, or otherwise bypass consent.
This version bills one account; pooled household allowances are not implemented.

Checkout timeouts can leave a subscription created remotely. The local record is
marked reconciliation_required and automatic retries are blocked. Search Razorpay
for notes.everecho_reference matching that local subscription UUID; reconcile its
provider_id and current status before allowing another checkout. Do not simply
delete the local row and retry. Refunds and disputes are handled in Razorpay.

Mock tests do not verify real checkout, webhook delivery, taxes, mandate eligibility
or cancellation settlement. These require configured test credentials and a staged
payment journey before any live launch. No customer payment was taken in this build.

Sources: [Subscriptions](https://razorpay.com/docs/api/payments/subscriptions/) and
[Webhook validation](https://razorpay.com/docs/webhooks/validate-test/).
