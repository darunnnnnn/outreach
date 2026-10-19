# Product Requirements Document — OutreachOS

**Status:** draft v1.0 · **Date:** 2026-10-19 · **Owner:** product/eng

## 1. Problem

Outbound sales teams at small exporters, agencies and B2B SaaS companies run their
pipeline across five disconnected tools: a data vendor for lists, a spreadsheet for
the list itself, a chatbot for copy, a sequencer for email, and LinkedIn by hand.
Nothing shares lead state, so the same prospect gets contacted twice, follow-ups
fire after a reply, and nobody can attribute a booked meeting to a channel or to a
message variant.

## 2. Product

OutreachOS is a multi-tenant web application that takes a user from an ideal
customer profile (ICP) expressed in plain language to a tracked, multichannel
outreach campaign with AI-personalised messaging and one shared lead state machine.

Workflow covered end to end:

```
ICP definition -> lead discovery -> qualification -> contact enrichment ->
AI personalisation -> campaign creation -> execution -> follow-ups ->
reply management -> conversion analytics
```

### 2.1 Channel strategy

| Channel | Phase | Sending model |
|---------|-------|---------------|
| Email | 4 | Automated, via user-authorised Gmail API / Microsoft Graph, or an ESP (Postmark/SES) sending from the org's own verified domain |
| LinkedIn | 5 | Human-in-the-loop: drafts, a send queue, "mark as sent". Automated sending only where an official partner API grants it |
| Instagram | 8 | Meta Graph API, business accounts, inside permitted entry points and the messaging window only |

This is a product constraint, not an obstacle to engineer around. We do not ship
cookie extraction, headless-browser automation of LinkedIn or Instagram, or any
mechanism that evades platform rate limits. See `07-risks.md`.

## 3. Users and roles

| Role | Capabilities |
|------|--------------|
| OWNER | Everything, including billing, org deletion, ownership transfer |
| ADMIN | Members, integrations, campaigns, leads, settings (no billing, no org deletion) |
| MEMBER | Create and run campaigns, read/write leads, generate AI messages |
| VIEWER | Read-only on leads, campaigns, analytics |

Tenancy: `User` and `Organization` are many-to-many through `Membership`. Every
business row carries `organizationId`, and every query is scoped by it.

## 4. Functional requirements

### FR-1 Accounts and organisations (Phase 1)

- Email + password signup that creates the user, their organisation and an OWNER
  membership in one transaction.
- Login issuing a short-lived access token and a rotating refresh token; logout
  revokes; refresh-token reuse revokes the whole token family.
- Invite by email with a role; accepting creates or links the user and the
  membership. Invitations expire.
- Role changes and member removal, with the last OWNER protected.
- Profile and organisation settings, including org timezone.
- Audit log for every security- and data-relevant action.

### FR-2 Audience and lead discovery (Phase 2)

- ICP builder: free-text description plus structured filters — industry/niche,
  country/region/city, employee-count band, revenue band, job titles, seniority,
  company type, has-website, has-business-email, has-LinkedIn, lead source,
  verification status.
- A pluggable `LeadProvider` interface. Phase 2 ships CSV import plus one or two
  licensed providers behind that same interface.
- Search preview with an estimated result count and credit cost before committing.
- CSV import with column mapping, per-row validation, a dry-run report, and a
  persisted import job.
- Deterministic deduplication (see `04-database-schema.md` §5) on normalised email,
  normalised LinkedIn URL, and name + company-domain.
- Provenance is mandatory on every lead: `source`, `sourceRecordId`, `collectedAt`,
  `verificationStatus`, `consentBasis`, `retentionUntil`. A missing email is `null`,
  never a guess, and never a pattern-generated address presented as verified.

### FR-3 AI layer (Phase 3)

- A Gemini-backed service for: ICP parsing, lead qualification score with written
  rationale, message drafting (email and LinkedIn), follow-up variants, reply
  classification, and next-action suggestion.
- Every call goes through one gateway providing: versioned prompt templates,
  schema-constrained JSON output, Zod validation, bounded retries with backoff,
  timeouts, per-org token and cost metering, and a persisted `AiGeneration` row for
  audit and reuse.
- Grounding rule: the prompt receives only stored, sourced facts about the prospect.
  Any claim in the output not traceable to a provided field is a defect; the draft UI
  shows which fields were used.
- Model, temperature and spend ceiling configurable per organisation; the ceiling is
  checked before the call, not after.

### FR-4 Email outreach (Phase 4)

- Connect a mailbox through Google OAuth or Microsoft OAuth (send + read-own scopes),
  or configure an ESP for the org's verified domain.
- Campaign builder: audience filter or explicit lead list, template with variables,
  AI personalisation step, review/approve queue, follow-up steps with delays,
  per-mailbox daily caps and sending windows, schedule.
- Execution by BullMQ workers: one job per (campaign, lead, step) with idempotency
  key `campaignId:leadId:stepIndex`, per-mailbox rate limiting, retries, and a
  dead-letter queue.
- Status tracking: queued, sent, delivered, bounced, replied, failed, skipped — as
  far as the provider reports it.
- Reply and bounce ingestion stops the sequence for that lead. Unsubscribe link and
  suppression list enforced both at enqueue time and again at send time.
- Pause, resume and stop a campaign; stop takes effect immediately for jobs that
  have not yet been sent.

### FR-5 LinkedIn workspace (Phase 5)

- Prospect list, AI connection-note and message drafts (respecting the 300-character
  connection-note limit), a follow-up plan, a human send queue with copy-to-clipboard
  and "mark as sent", conversation notes, and per-day activity caps that mirror
  platform norms.

### FR-6 Unified campaign engine (Phase 6)

- One orchestration service and one lead state machine shared by all channels:
  `NEW -> QUALIFIED -> READY -> CONTACTED -> FOLLOW_UP_DUE -> REPLIED ->
  MEETING_BOOKED -> CONVERTED`, plus the side and terminal states
  `NOT_INTERESTED, BOUNCED, UNSUBSCRIBED, PAUSED, FAILED`.
- Cross-channel rules: a reply or opt-out on any channel suppresses every channel;
  one active campaign per lead per channel unless explicitly overridden.

### FR-7 Analytics and CRM (Phase 7)

- Dashboard counters: total leads, qualified leads, active campaigns, messages sent,
  replies, positive replies, meetings booked, bounce rate, opt-out rate, conversion
  rate.
- Per-campaign and per-variant breakdown, funnel view, time series, CSV export.
  Notes, tasks and an owner on each lead.

### FR-8 Platform (Phase 9)

- Plan-based usage limits, metered AI spend, Stripe billing, monitoring and alerting,
  a backup/restore runbook, and data export and deletion workflows (GDPR Art. 15/17).

## 5. Non-functional requirements

| Area | Target |
|------|--------|
| p95 API latency | < 300 ms reads, < 800 ms writes, excluding AI and provider calls |
| AI call latency | < 8 s p95; always asynchronous for bulk operations |
| Availability | 99.5% for the API; worker backlog drained within 15 min of schedule |
| Tenancy | No business query without an `organizationId` predicate, asserted by integration tests |
| Secrets | Env or managed secret store only; OAuth tokens encrypted at rest with AES-256-GCM |
| Auditability | Every auth event, permission change, send and AI generation logged |
| Retention | Per-org configurable; default purge of unconverted provider-sourced leads after 24 months |
| Accessibility | Keyboard navigable, labelled controls, visible focus, AA contrast |

## 6. Out of scope for v1

Dialler, SMS and WhatsApp channels; a public customer-facing API; white-labelling;
on-prem deployment; inbox warm-up as a service; any form of unauthorised scraping.

## 7. Success metrics

- Signup to first campaign sent in under 30 minutes.
- At least 60% of AI drafts sent with no or light edits.
- Reply rate reported per campaign within 2% of mailbox ground truth.
- Zero duplicate sends and zero post-opt-out sends. Hard invariant, alerted on.
