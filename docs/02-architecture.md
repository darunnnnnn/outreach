# System Architecture

## 1. Shape of the system

A TypeScript monorepo with three deployables: a React SPA, an Express API, and a
BullMQ worker process that shares the API's code. State lives in PostgreSQL; Redis
carries queues, scheduling and rate-limit counters. Everything that talks to a third
party (Gemini, Gmail, Graph, data vendors, Stripe) sits behind an adapter so the
core domain never imports a vendor SDK directly.

```
                    ┌──────────────────────────┐
  browser  ───────► │  web (React + Vite SPA)  │
                    └───────────┬──────────────┘
                                │ HTTPS, Bearer access token
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  api (Express + TypeScript)                                          │
│  http layer: helmet, cors, requestId, rate limit, zod validate       │
│  ─────────────────────────────────────────────────────────────────── │
│  modules: auth · organizations · leads · audience · providers        │
│           ai · channels(email|linkedin|instagram) · campaigns        │
│           inbox · analytics · billing · audit                        │
│  ─────────────────────────────────────────────────────────────────── │
│  services (domain)  →  adapters (vendor)  →  prisma (data)           │
└──────┬───────────────────────┬──────────────────────┬────────────────┘
       │ enqueue               │ outbound HTTP        │ SQL
       ▼                       ▼                      ▼
┌─────────────┐   ┌──────────────────────────┐   ┌──────────────┐
│ Redis       │   │ Gemini · Gmail · Graph   │   │ PostgreSQL   │
│ BullMQ      │   │ ESP · data vendors       │   │              │
└──────┬──────┘   └──────────────────────────┘   └──────────────┘
       │ consume
       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  worker (same image, different entrypoint)                           │
│  queues: lead.import · lead.enrich · ai.generate · campaign.tick     │
│          outreach.send · inbox.sync · analytics.rollup · retention   │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. Why this shape

- **One image, two entrypoints.** API and worker share the service layer, so a
  campaign can be advanced by an HTTP call or a scheduled job with identical rules.
  No duplicated business logic, no drift.
- **Modules, not microservices.** Each module owns its routes, services and Prisma
  access and exposes a small interface to the others. The boundaries are where
  services would later be split, but a four-person team should not pay for network
  calls between them yet.
- **Adapters at every integration edge.** `LeadProvider`, `OutreachChannel`,
  `MailboxProvider` and `AiProvider` are interfaces. Swapping Gemini for another
  model, or adding a second data vendor, touches one file plus a registry entry.
- **Queue-first for anything slow or rate-limited.** AI generation, provider
  searches, sends and inbox syncs are all jobs. The HTTP layer only ever enqueues
  and reports status, which keeps p95 latency honest.

## 3. Request lifecycle (API)

1. `requestId` middleware assigns a correlation id, logged on every line.
2. `helmet`, `cors` (allow-list), body size limit.
3. Rate limiter: global per-IP, plus a stricter bucket on auth routes.
4. `authenticate`: verifies the `Bearer` access token (JWT, HS256, 15 min).
   Attaches `req.auth = { userId, sessionId }`.
5. `withOrg`: resolves the active organisation from the `X-Org-Id` header or the
   user's single membership, loads the membership, and attaches
   `req.ctx = { userId, organizationId, role }`. A missing membership is a 403.
6. `requireRole(...)`: RBAC check against the route's minimum role.
7. `validate({ body, query, params })`: Zod parse; failures become a 422 with a
   field-keyed error object.
8. Controller calls a service. Services receive `ctx` explicitly — they never read
   request-scoped globals — and every Prisma call includes `organizationId`.
9. Errors funnel through one handler that maps `AppError` subclasses to status codes
   and emits a safe JSON body. Unknown errors log the stack and return a generic 500.
10. Mutations that matter write an `AuditLog` row in the same transaction.

## 4. Data flow: ICP to sent email (target state, Phases 2–4)

```
Audience builder ──POST /audiences──► audience row (filters + natural-language text)
      │
      └─ Gemini parse  ──► normalised filter JSON (user confirms before use)

Discovery  ──POST /leads/search──► provider adapter ──► preview (count, cost)
      └─ confirm ──► queue lead.import ──► normalise ──► dedupe ──► Lead rows
                                                         (+ provenance)

Qualification ──queue ai.generate(kind=QUALIFY)──► score + rationale on Lead

Campaign ──POST /campaigns──► steps, delays, caps, schedule
      └─ activate ──► campaign.tick (repeatable job)
             ├─ selects leads due for step N, honouring suppression + state
             ├─ queue ai.generate(kind=EMAIL_DRAFT) if personalisation on
             ├─ drafts land in the approval queue when approval is required
             └─ queue outreach.send (idempotency key campaignId:leadId:stepIndex)
                     └─ channel adapter sends ──► OutreachMessage row + state move

inbox.sync ──► replies/bounces ──► classify (Gemini) ──► state move + suppression
                                                       ──► cancel pending steps
analytics.rollup ──► per-campaign daily aggregates for the dashboard
```

## 5. Cross-cutting concerns

**Tenancy.** `organizationId` is a required column on every business table and a
required argument in every repository function. Integration tests include a
"cross-tenant read" suite that creates two orgs and asserts 404/403 on every
resource route. Postgres row-level security is a Phase 9 hardening item, with the
application predicate as the primary control until then.

**Idempotency.** Jobs carry deterministic `jobId`s so a re-enqueue is a no-op.
Send jobs additionally insert an `OutreachMessage` row with a unique constraint on
`(campaignId, leadId, stepIndex)` before calling the provider; a duplicate insert
aborts the job. Mutating public endpoints accept an optional `Idempotency-Key`.

**Secrets and tokens.** No secret in the repo or in frontend code. OAuth refresh
tokens and provider API keys are encrypted with AES-256-GCM using a key from
`ENCRYPTION_KEY` (32-byte, base64), stored as `ciphertext:iv:tag`, and decrypted
only inside the adapter that needs them.

**Observability.** Pino JSON logs with request id, org id and user id; `/healthz`
(process) and `/readyz` (DB + Redis) endpoints; OpenTelemetry traces across
HTTP -> queue -> provider; queue depth, job failure rate, AI spend and send volume
as the four alerting signals.

**Compliance by construction.** Suppression is checked at enqueue and at send.
Every outbound email carries an unsubscribe header and link. Lead provenance and
retention dates are columns, not conventions, and a nightly `retention` job purges
what has expired.

## 6. Technology decisions

| Choice | Decision | Rationale |
|--------|----------|-----------|
| Frontend | React 18 + TypeScript + Vite | Fast dev loop, no SSR requirement for an authenticated dashboard |
| Styling | Tailwind CSS 3 + a local `components/ui` kit | Avoids a heavyweight component dependency while keeping consistency |
| Data fetching | TanStack Query | Cache, retries and background refresh for list-heavy screens |
| Backend | Node 22 + Express 4 + TypeScript | Team familiarity; Express is sufficient for a REST surface this size |
| ORM | Prisma 6 | Typed client, first-class migrations, good multi-tenant ergonomics |
| DB | PostgreSQL 16 | JSONB for provider payloads and filters, partial/unique indexes for dedupe |
| Queue | BullMQ on Redis 7 | Repeatable jobs, rate limiting per group, DLQ, mature Node API |
| AI | Google Gemini via `@google/genai` | Required by the brief; isolated behind `AiProvider` |
| Auth | Access JWT (15 min) + rotating refresh token in DB (30 d) | Revocable sessions without a session store on the hot path |
| Validation | Zod, shared with the frontend via `packages/shared` | One schema per payload, no drift between client and server |
| API docs | OpenAPI 3.1 + Swagger UI at `/docs` | Hand-maintained in Phase 1, generated from Zod from Phase 2 |
| Tests | Vitest + Supertest + Playwright | One runner for unit and integration; Playwright for the few critical flows |
| Deploy | Docker images; managed Postgres and Redis | Portable between Fly/Render/ECS without lock-in |

## 7. Environments

| Env | Purpose | Data |
|-----|---------|------|
| local | Docker Compose: postgres, redis; API and web run on the host | Seeded demo org |
| preview | Per-PR deploy, ephemeral DB | Seeded |
| staging | Mirrors production, real integrations in sandbox mode | Synthetic leads only |
| production | — | Real; sending caps enforced, backups hourly |
