# Phased Roadmap and Acceptance Criteria

Each phase is shippable on its own. A phase is done when every acceptance criterion
below is demonstrably true — verified by a test, a migration that runs, or a UI flow
walked end to end — not when the code merely exists.

Estimates assume two full-time engineers.

---

## Phase 1 — Foundation: auth, organisations, RBAC, DB, UI shell (≈2 weeks)

**Objective.** A secure multi-tenant skeleton everything else hangs from.

**Deliverables.** Monorepo + tooling; Prisma schema and first migration for
identity/org/audit; signup, login, refresh, logout, password change; invitations;
members and roles; org settings; audit log; error/validation/rate-limit middleware;
OpenAPI at `/docs`; React shell with routing, auth guard, token refresh, and the
`components/ui` kit; seed data; unit + integration tests; Docker Compose.

**Acceptance criteria.**
1. `docker compose up -d && npm run db:migrate && npm run db:seed && npm run dev`
   produces a usable app from a clean checkout.
2. Signup creates `User` + `Organization` + OWNER `Membership` atomically; a failure
   at any step leaves no partial rows.
3. Login returns an access token (15 min) and sets a rotating refresh token;
   reusing a rotated refresh token revokes the whole family and returns 401.
4. `GET /api/v1/organizations/current/members` returns 403 for a user who is not a
   member, and 200 scoped to the caller's org otherwise.
5. A MEMBER is refused (403) on every ADMIN+ route; a VIEWER is refused on writes.
6. The last OWNER cannot be demoted or removed (409).
7. Invitation: create -> email token -> accept creates the membership; an expired or
   already-used token is rejected.
8. Every auth event and permission change appears in `audit_logs` with actor, target,
   IP and user agent.
9. `/docs` serves the OpenAPI spec matching the implemented routes.
10. Test suite green; cross-tenant access suite passes; `npm run typecheck` and
    `npm run lint` clean.

**Exit dependency for Phase 2.** Stable `ctx { userId, organizationId, role }`,
audit service, job queue wiring.

---

## Phase 2 — Lead discovery, import, dedupe, qualification scaffolding (≈3 weeks)

**Deliverables.** `Audience`, `Lead`, `Company`, `LeadImport`, `SuppressionEntry`
tables; `LeadProvider` interface + CSV provider + one licensed vendor adapter;
column-mapping import wizard with dry run; dedupe engine; lead list with filters,
saved views, bulk actions, CSV export; lead detail; manual edit; provenance display.

**Acceptance criteria.**
1. A 10k-row CSV imports in under 60 s with a per-row error report and no partial
   lead rows for failed rows.
2. Re-importing the same file creates zero new leads and increments
   `duplicatesSkipped`.
3. Dedupe catches: same email different case/dots-in-gmail, same LinkedIn URL with
   differing query strings, same person at the same company domain.
4. Every lead row has non-null `source`, `collectedAt` and `verificationStatus`;
   `email` is null when none was found (asserted by a schema test).
5. Lead search with five combined filters returns in < 300 ms p95 on 100k rows
   (indexes proven by `EXPLAIN` in a test fixture).
6. A provider adapter can be added by implementing one interface and registering it;
   proven by a second, fake adapter in tests.
7. Provider API failures surface as a retryable import job, never as data loss.

---

## Phase 3 — Gemini integration: parsing, qualification, drafting (≈2.5 weeks)

**Deliverables.** `AiProvider` + Gemini adapter; prompt registry with versions;
structured-output schemas + Zod validation; retry/timeout/circuit breaker;
`AiGeneration` + `AiUsage` tables and cost metering; ICP parser; lead qualifier with
rationale; email and LinkedIn draft generators; follow-up variants; reply classifier;
AI message generator UI with a diff/edit view.

**Acceptance criteria.**
1. Every generation persists prompt version, model, token counts, cost and latency.
2. Malformed model output is retried up to N times and then fails the job with a
   typed error; it never reaches the UI as a half-parsed object.
3. Drafts list the lead fields used; a fixture test asserts no claim appears that was
   absent from the input (golden-set review of 20 leads, manual sign-off recorded).
4. Per-org monthly AI budget blocks generation with a clear 402-style error once hit.
5. Qualification scoring criteria are stored, editable, and shown next to the score.
6. No Gemini key reachable from the browser (bundle grep test in CI).

---

## Phase 4 — Email outreach (≈4 weeks)

**Deliverables.** Google/Microsoft OAuth mailbox connection with encrypted tokens;
`Mailbox`, `Campaign`, `CampaignStep`, `CampaignLead`, `OutreachMessage`,
`EmailTemplate` tables; campaign builder; approval queue; BullMQ `campaign.tick`,
`outreach.send`, `inbox.sync`; daily caps and sending windows; bounce/reply
detection; unsubscribe endpoint + suppression enforcement; campaign controls.

**Acceptance criteria.**
1. Connecting a mailbox stores no plaintext token (DB inspection test).
2. A campaign of 50 leads with two follow-ups sends exactly 50 step-1 messages, and
   step 2 only to leads that did not reply, at the configured delay.
3. Re-running the scheduler twice over the same window sends nothing twice (unique
   constraint + idempotent job proven by test).
4. A reply arriving between enqueue and send cancels the send at send time.
5. Daily cap per mailbox is never exceeded, verified under a 3x-oversubscribed queue.
6. Unsubscribe link suppresses the address org-wide within one request and is honoured
   by all later campaigns.
7. Pause stops new sends within one tick; stop cancels all pending jobs.
8. Provider 4xx/5xx are classified: permanent failures mark the message failed,
   transient ones retry with backoff and land in the DLQ after exhaustion.

---

## Phase 5 — LinkedIn workspace, human-in-the-loop (≈2.5 weeks)

**Deliverables.** `LinkedInProfile` link on leads; LinkedIn campaign type; connection
note and message drafting; send queue UI with copy + "mark as sent"; conversation
log; daily activity caps; official-API adapter stub behind the same
`OutreachChannel` interface.

**Acceptance criteria.**
1. A LinkedIn campaign produces a queue of approved drafts, each under 300 characters
   for connection notes.
2. "Mark as sent" advances the shared lead state and records an `OutreachMessage`.
3. No code path performs automated LinkedIn HTTP calls without a configured official
   API credential; absence of credentials degrades to the manual queue, not to
   scraping (asserted by a test that fails if an unauthorised client is instantiated).
4. Daily cap blocks queue generation beyond the configured number.

---

## Phase 6 — Unified campaign orchestration (≈2 weeks)

**Deliverables.** Channel-agnostic orchestrator; the shared lead state machine with
explicit allowed transitions; cross-channel suppression; scheduling calendar;
conflict rules; campaign-level analytics hooks.

**Acceptance criteria.**
1. The state machine rejects illegal transitions with a typed error; a table-driven
   test covers every pair.
2. An opt-out on email suppresses the same lead in a LinkedIn campaign.
3. A lead cannot be active in two campaigns on the same channel unless overridden,
   and the override is audited.
4. Replacing the email channel adapter with a fake runs a full campaign in tests
   with no channel-specific code in the orchestrator.

---

## Phase 7 — Analytics, CRM, collaboration (≈3 weeks)

**Deliverables.** `analytics.rollup` job and aggregate tables; dashboard counters;
funnel and time-series views; per-variant comparison; CSV/report export; lead notes,
tasks, owners; team activity feed.

**Acceptance criteria.**
1. Dashboard counters match direct SQL aggregates on a seeded dataset (tested).
2. Dashboard loads in < 1 s p95 on 500k outreach messages (served from rollups).
3. Export produces the same numbers as the UI for the same filter set.
4. Rollups are recomputable and idempotent for any given day.

---

## Phase 8 — Instagram (≈2 weeks, gated on Meta app review)

**Deliverables.** Instagram channel adapter via Meta Graph API; business-profile
discovery through permitted sources; eligibility checks; draft + approval workflow;
conversation tracking.

**Acceptance criteria.**
1. Messaging is attempted only for conversations with a valid entry point and inside
   the permitted window; ineligible prospects are marked `NOT_REACHABLE` with a reason.
2. Required permissions and app-review status are documented and configurable.
3. The channel is additive: disabling it changes no other channel's behaviour.

---

## Phase 9 — Hardening, billing, deployment (≈3 weeks)

**Deliverables.** Row-level security; dependency and secret scanning; pen-test fixes;
Playwright E2E suite; load test; OpenTelemetry + dashboards + alerts; backup/restore
drill; plan limits and Stripe billing; data export/deletion workflows; runbooks.

**Acceptance criteria.**
1. A restore from backup into a clean environment succeeds, timed and documented.
2. Plan limits enforced at the service layer with a 402 and an upgrade path.
3. Account deletion removes or anonymises all tenant data within the documented SLA
   and is logged.
4. Alerts fire in staging for: queue backlog, send failure spike, AI overspend,
   auth-failure spike.
5. E2E suite covers signup -> import -> qualify -> campaign -> send -> reply.

---

## Milestones

| Milestone | Phases | Cumulative |
|-----------|--------|------------|
| M1 Secure skeleton | 1 | week 2 |
| M2 Lead engine | 2 | week 5 |
| M3 AI layer | 3 | week 8 |
| M4 Email outreach (private beta) | 4 | week 12 |
| M5 Multichannel + orchestration | 5–6 | week 16 |
| M6 Analytics + CRM (public beta) | 7 | week 19 |
| M7 Instagram | 8 | week 21 |
| M8 GA: hardened + billed | 9 | week 24 |
