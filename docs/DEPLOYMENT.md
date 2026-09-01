# Deployment

Vendor-neutral. Anything that can run three Node processes, a PostgreSQL
database and an S3-compatible bucket will do.

> **Nothing in this document was executed** in the session that produced it. No
> Docker daemon, S3 endpoint, Redis, SMTP server or provider key was reachable.
> The code paths are complete and type-checked; treat the first deployment as
> something to watch closely.

## What you need

| | Minimum | Notes |
|---|---|---|
| Node | 22 LTS | The API and worker run TypeScript through `tsx` |
| PostgreSQL | 16 | `pgvector` optional — without it the portable path is used automatically |
| Object storage | Any S3-compatible | Bucket must be **private**; the app issues its own expiring links |
| Redis | 7, optional | Cache and distributed rate limiting only; the queue lives in PostgreSQL |
| TLS | Required | Terminate at the edge; set `COOKIE_SECURE=true` |

## The three processes

```bash
pnpm --filter @everecho/api start      # HTTP, default :4000
pnpm --filter @everecho/worker start   # background processing, no port
pnpm --filter @everecho/web start      # Next.js, default :3000
```

Run at least two workers. They coordinate through `SELECT … FOR UPDATE SKIP
LOCKED`, so adding one needs no configuration, and a crashed worker's lock
expires rather than stranding the job.

## Configuration that must change from the defaults

`loadConfig` refuses to start in production otherwise, and names each problem:

```bash
NODE_ENV=production
SESSION_SECRET=<32+ random bytes>          # openssl rand -base64 48
STORAGE_SIGNING_SECRET=<32+ random bytes>  # different from the above
COOKIE_SECURE=true
AUTH_DRIVER=oidc                           # local is a dev-only credential store
OIDC_ISSUER=... OIDC_CLIENT_ID=... OIDC_CLIENT_SECRET=...
STORAGE_DRIVER=s3
S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
API_PUBLIC_URL=https://api.example.com
WEB_PUBLIC_URL=https://app.example.com
DATABASE_URL=postgres://...
```

`NEXT_PUBLIC_API_URL` is baked into the browser bundle **at build time**, so it
must be a URL a browser can reach — not an internal service name.

## Deploying

```bash
pnpm install --frozen-lockfile
pnpm db:migrate          # additive and idempotent; run before the new version starts
pnpm --filter @everecho/web build
# then restart api, worker and web
```

Migrations are forward-only and additive, so the old version keeps working
against the new schema during a rolling deploy. There is no `down` migration by
design: a rollback that drops a column drops memories.

If a migration checksum has changed, the runner **stops**. Migrations are
immutable once applied; add a new one rather than editing.

## Database roles

Give the application a role that owns its tables but is **not** superuser.
Row-level security uses `FORCE`, so the owner is subject to it — but a superuser
bypasses RLS entirely, which throws away a whole layer of isolation.

```sql
CREATE ROLE everecho_app LOGIN PASSWORD '...';
GRANT ALL ON SCHEMA public TO everecho_app;
-- and specifically NOT: ALTER ROLE everecho_app SUPERUSER / BYPASSRLS
```

## Object storage

The bucket must be private with no public read policy. The application issues
short-lived presigned URLs after `authorize()` has permitted the access; a
publicly readable bucket makes every one of those checks decorative.

Enable server-side encryption, versioning (so a bad deploy cannot destroy
originals) and a lifecycle rule expiring `archives/*/export/*` after 7 days to
match the application's own expiry.

## Enabling hosted providers

Each is a configuration change with no code change. All are **unverified** here.

| Provider | Set | Notes |
|---|---|---|
| Composition | `LLM_DRIVER=anthropic`, `LLM_API_KEY`, `ANTHROPIC_MODEL` | Uses the official SDK with forced strict tool use for structured output. Verification still drops unsupported claims — a hosted model does not relax that |
| Embeddings | `EMBEDDINGS_DRIVER=openai`, `EMBEDDINGS_API_KEY`, `EMBEDDINGS_DIM` | **Changing the dimension invalidates every stored embedding.** Re-embed approved memories after switching |
| Speech | `STT_DRIVER=whisper`, `STT_API_KEY` | Until then the local adapter reports honestly that it cannot recognise speech |
| OCR | `OCR_DRIVER=tesseract`, `OCR_API_KEY` | Local reads plain text and PDFs with a text layer; scans need a real engine |
| Email | `EMAIL_DRIVER=smtp`, `SMTP_URL` | Local writes to `EMAIL_OUTBOX_DIR` |
| Billing | `BILLING_DRIVER=stripe`, `BILLING_API_KEY`, `BILLING_WEBHOOK_SECRET` | Stripe's `verifyWebhook` returns `null` until wired — it fails **closed**, refusing events rather than trusting them. Complete it before enabling |
| Scanning | `SCAN_DRIVER=clamav`, `CLAMAV_HOST`, `CLAMAV_PORT` | Strongly recommended in production |
| Cache | `CACHE_DRIVER=redis`, `REDIS_URL` | Needed for rate limiting to be shared across API instances |

Whatever is configured, `AI_PROVIDER_NO_TRAINING` must remain true;
`loadConfig` refuses production otherwise.

## Health and monitoring

| Endpoint | Use |
|---|---|
| `GET /healthz` | Liveness. No dependencies, no detail |
| `GET /readyz` | Readiness, with per-dependency status. `degraded` on `vector_index` is not an outage |
| `GET /v1/operations/worker` | Queue depth, failures, oldest waiting job (support accounts only) |

Alert on: queue depth rising steadily, any `dead_lettered` job, `readyz`
reporting `down`, and any `deny` audit event with reason `restricted_topic` or
`sensitivity_above_grant` spiking — the last of those usually means a copy or
permissions problem rather than an attack.

Logs are structured JSON with a request id on every line and no memory content
by construction. `OTEL_EXPORTER_OTLP_ENDPOINT` is read from configuration;
instrumentation is **not** wired up in v0.1.

## Scaling

- **API and web** are stateless. Scale horizontally; sessions live in PostgreSQL.
- **Workers** scale horizontally with no coordination.
- **PostgreSQL** is the bottleneck, and it holds both the data and the queue.
  Watch `processing_job` bloat, and autovacuum it more aggressively than default.
- **Retrieval** without pgvector computes cosine distance in PL/pgSQL, which is
  fine at v0.1 scale (thousands of memories per archive, always filtered to one
  archive first). Install pgvector before that stops being true.

## Reverse proxy

Terminate TLS, set `TRUST_PROXY=true` **only** if the proxy is yours — otherwise
client addresses can be spoofed and rate limiting keyed by address becomes
useless. Forward `/v1/*` to the API and everything else to the web app, or serve
them on separate hostnames and set `WEB_PUBLIC_URL` accordingly for CORS.
