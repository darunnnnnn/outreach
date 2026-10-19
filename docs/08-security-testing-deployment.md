# Security, Testing and Deployment Strategy

## 1. Security

### 1.1 Authentication

- Passwords hashed with bcrypt, cost 12. Minimum 10 characters, checked against a
  small common-password list; no composition rules that push users to `Passw0rd!`.
- Access token: JWT HS256, 15-minute TTL, claims `{ sub, sid, iat, exp }`. No role
  or org in the token — authorisation is resolved from the database on every request
  so a revoked membership takes effect immediately.
- Refresh token: 64 bytes of CSPRNG randomness, stored only as a SHA-256 hash, 30-day
  TTL, rotated on every use. A reused token revokes the entire family and writes an
  `auth.refresh_reuse_detected` audit entry — the standard signal of a stolen token.
- Delivered as an `httpOnly; secure; sameSite=lax` cookie for browsers, accepted in
  the body for CLI/mobile clients.
- Login responses are uniform for unknown email and wrong password, and the handler
  performs a dummy hash comparison when the user does not exist so timing does not
  leak account existence.
- Password change revokes all other sessions.

### 1.2 Authorisation and tenancy

- `authenticate` -> `withOrg` -> `requireRole` on every protected route.
- Role order: `VIEWER < MEMBER < ADMIN < OWNER`; `requireRole(Role.ADMIN)` means
  "ADMIN or above".
- Services take `ctx { userId, organizationId, role }` as their first argument;
  no request-scoped globals, no implicit tenant.
- Cross-tenant resources return 404, not 403, so existence is not disclosed.
- Postgres row-level security is added in Phase 9 as defence in depth behind the
  application predicate.

### 1.3 Data protection

- Secrets only from the environment or a managed secret store; `.env` is git-ignored
  and CI runs secret scanning.
- OAuth tokens and provider keys encrypted with AES-256-GCM
  (`ENCRYPTION_KEY`, 32 bytes base64), stored as `iv:tag:ciphertext`, decrypted only
  inside the owning adapter.
- Logs are structured and redacted: `authorization`, `cookie`, `password`,
  `token`, `refreshToken`, `apiKey` are stripped by a Pino redaction list.
- TLS everywhere; HSTS in production; `helmet` defaults plus a CSP on the SPA.
- PII minimisation: we store what outreach needs, with a retention date on every
  provider-sourced lead.

### 1.4 Input and output

- Every request body, query and param parsed by a Zod schema; unknown keys stripped.
- Prisma parameterises all SQL; raw SQL is allowed only with tagged templates.
- Output is JSON; the SPA never renders untrusted HTML. AI-generated message bodies
  are rendered as text in the editor and sanitised (DOMPurify) if HTML email is
  enabled in Phase 4.
- Upload limits: 10 MB JSON, 25 MB CSV, content-type checked server-side.

### 1.5 Abuse prevention

Rate limits per `05-api-design.md` §5, backed by Redis in deployed environments.
Per-org invite caps. Lockout-free but exponentially delayed login on repeated
failures from the same IP/email pair. Alerting on auth-failure spikes.

### 1.6 Auditing

`AuditLog` rows are written in the same transaction as the change. Phase 1 actions:
`auth.registered`, `auth.login`, `auth.login_failed`, `auth.logout`,
`auth.refresh_reuse_detected`, `auth.password_changed`, `org.updated`,
`member.role_changed`, `member.removed`, `org.ownership_transferred`,
`invitation.created`, `invitation.accepted`, `invitation.revoked`.
Later phases add `lead.*`, `campaign.*`, `message.sent`, `ai.generated`,
`suppression.added`, `integration.connected`.

### 1.7 Dependency and supply chain

`npm audit` plus Dependabot on a weekly cadence; lockfile committed; CI fails on
high-severity advisories; Docker images built from pinned digests and run as a
non-root user.

## 2. Testing

| Layer | Tool | Scope | Gate |
|-------|------|-------|------|
| Unit | Vitest | Pure logic: password policy, token hashing, role comparison, Zod schemas, dedupe normalisation, state machine | Runs with no DB; required on every PR |
| Integration | Vitest + Supertest + a real Postgres | Route + service + DB, including auth flows, RBAC matrix, cross-tenant isolation, invitations, audit writes | Required on every PR in CI |
| Contract | Vitest + fake adapters | `LeadProvider`, `AiProvider`, `OutreachChannel` implementations must satisfy a shared conformance suite | Added with each adapter |
| E2E | Playwright | Signup -> invite -> import -> qualify -> campaign -> send -> reply | Nightly + pre-release |
| Load | k6 | Lead search at 100k rows, 10k-message campaign | Before each GA milestone |

Rules: integration tests run against a real Postgres (`DATABASE_URL` pointing at a
disposable database), never against mocks of Prisma. Each test file gets its own
schema or truncates in `beforeEach`. External vendors are always faked at the
adapter interface — no test makes a paid API call. Coverage target 80% on services,
with the RBAC and cross-tenant suites treated as non-negotiable rather than
coverage-counted.

When no `DATABASE_URL` is present, integration suites skip loudly (a console notice
plus a skipped-suite count) so a green local run is never mistaken for a full run.
CI always sets it.

## 3. Deployment

### 3.1 Local

```
docker compose up -d        # postgres:16, redis:7
npm install
npm run db:migrate
npm run db:seed
npm run dev                 # api :4000, web :5173
```

### 3.2 Images

Two images from one repo: `api` (multi-stage Node 22 Alpine, `dist/` only,
non-root) and `web` (built assets served by nginx with SPA fallback and cache
headers). The worker reuses the `api` image with `node dist/worker.js`.

### 3.3 Pipeline

```
PR:    install -> typecheck -> lint -> unit -> integration (ephemeral pg+redis)
       -> build -> secret scan -> npm audit
main:  above -> build and push images -> migrate staging -> deploy staging
       -> smoke tests -> manual approval -> migrate production -> deploy
       -> smoke -> notify
```

Migrations run as a separate job before the new code is released, and only
expand-compatible changes ship with the code that needs them. Rollback is
`deploy previous image`, which is safe because no migration in a release is
destructive.

### 3.4 Runtime

Managed Postgres (automated backups, PITR) and managed Redis (AOF on). API behind a
load balancer with 2+ replicas; the worker scales independently on queue depth.
`/healthz` for liveness, `/readyz` for readiness so a replica with a broken DB
connection leaves the pool. Graceful shutdown drains in-flight requests and lets
BullMQ finish or re-queue the active job.

### 3.5 Observability and operations

Pino JSON logs shipped to the platform's aggregator; Sentry for exceptions;
OpenTelemetry traces spanning HTTP -> queue -> provider. Alerts on: queue depth,
job failure rate, send failure spike, AI spend rate, auth-failure spike, p95
latency, and any occurrence of the duplicate-send or post-opt-out invariants.
Runbooks live in `docs/runbooks/` from Phase 4: backlog drain, mailbox re-auth,
provider outage, restore-from-backup, and tenant data deletion.
