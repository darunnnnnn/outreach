# Risk Assessment

Scored as likelihood × impact on a 1–5 scale. Anything ≥ 12 has a named owner and a
mitigation that is scheduled, not aspirational.

## 1. Legal and compliance

| # | Risk | L | I | Score | Mitigation |
|---|------|---|---|-------|------------|
| L1 | **GDPR / ePrivacy exposure.** The brief's own example targets Germany and the Netherlands. Cold B2B email there relies on a narrow legitimate-interest reading, and Germany's UWG is stricter than most: unsolicited commercial email to a business can require prior consent in practice. | 4 | 5 | 20 | Per-lead `consentBasis` and `retentionUntil` columns; mandatory sender identity and one-click unsubscribe in every message; per-country guidance surfaced in the campaign builder; data-processing agreement and privacy policy before the first paying customer; legal review of EU templates before Phase 4 GA. We provide the controls; the customer remains the controller and must confirm their basis. |
| L2 | **CAN-SPAM / CASL non-compliance** in US/CA sending. | 3 | 4 | 12 | Unsubscribe link + physical address fields required on a campaign before activation; suppression enforced at send; opt-outs honoured org-wide immediately. |
| L3 | **Data-provider licence breach** (retaining or re-exporting records beyond licence). | 3 | 4 | 12 | Provenance columns, retention job, export warnings, per-provider terms recorded in the adapter registry. |
| L4 | **Platform ToS breach on LinkedIn/Instagram.** The single biggest existential risk if built the "easy" way. | 2 | 5 | 10 | No scraping, no cookie extraction, no browser automation. `canSendAutomatically()` gates automated sending on real partner credentials, with a test that fails the build if an unauthorised client is instantiated. Human-in-the-loop is the shipped design. |
| L5 | **Customer misuse** — a user uploads a purchased consumer list and blasts it. | 4 | 4 | 16 | Acceptable-use terms; import requires asserting a lawful basis; volume and complaint-rate monitoring per org; suspension workflow; no "unlimited send" option in the UI. |

## 2. Deliverability and reputation

| # | Risk | L | I | Score | Mitigation |
|---|------|---|---|-------|------------|
| D1 | Customer mailbox gets rate-limited or suspended by Google/Microsoft. | 4 | 4 | 16 | Conservative default `dailyCap` (50), sending windows, randomised delays, per-mailbox rate limiting, hard stop on bounce-rate thresholds, warm-up guidance in the UI. |
| D2 | Shared ESP IP reputation damaged by one bad tenant. | 3 | 4 | 12 | Transactional and outreach traffic separated; per-org complaint/bounce thresholds with automatic pause; dedicated domains for outreach. |
| D3 | Bounce/complaint feedback not ingested, so suppression lags. | 3 | 5 | 15 | Webhook + inbox sync both feed suppression; suppression checked again at send time, not only at enqueue; alert on suppression-write failures. |

## 3. Technical

| # | Risk | L | I | Score | Mitigation |
|---|------|---|---|-------|------------|
| T1 | **Cross-tenant data leak** from a query missing `organizationId`. | 3 | 5 | 15 | `organizationId` required in every repository signature; a cross-tenant integration suite per resource; Prisma access confined to the module's service layer; Postgres RLS in Phase 9 as defence in depth. |
| T2 | **Duplicate or post-opt-out sends** from a scheduler race. | 3 | 5 | 15 | Unique `(campaignId, leadId, stepIndex)`; deterministic job ids; suppression re-check inside the send transaction; invariant monitors that alert on any occurrence. |
| T3 | AI hallucinates facts about a prospect, damaging the customer's credibility. | 4 | 4 | 16 | Grounded-facts-only prompts; the draft UI shows which fields were used; approval queue on by default; golden-set review each time a prompt version changes. |
| T4 | Gemini output shape drift breaks parsing. | 3 | 3 | 9 | Structured output + Zod validation + bounded retries; typed `INVALID_OUTPUT` failure; prompt versions pinned and A/B-able. |
| T5 | Worker backlog during a large campaign delays sends past their window. | 3 | 3 | 9 | Queue-depth alerting, horizontal worker scaling, per-org fair-share concurrency. |
| T6 | OAuth token leak. | 2 | 5 | 10 | AES-256-GCM at rest with a key from a managed secret store; decryption only inside the adapter; tokens never logged; log redaction test. |
| T7 | Prisma migration failure on production data. | 2 | 4 | 8 | Expand/contract migrations, no destructive step in the same release as the code change, staging rehearsal on a production-sized snapshot, tested restore path. |
| T8 | Secret committed to the repo. | 3 | 4 | 12 | `.env` git-ignored, `.env.example` only, secret scanning in CI, pre-commit hook. |

## 4. Product and commercial

| # | Risk | L | I | Score | Mitigation |
|---|------|---|---|-------|------------|
| P1 | EU niche data coverage is too thin for the target segment, so leads are poor. | 4 | 4 | 16 | Validate with a real search in Phase 2 week 1 before committing to a vendor; always support CSV and manual research; set expectations in onboarding. |
| P2 | Gmail verification/CASA delay pushes the beta. | 3 | 4 | 12 | Begin verification at Phase 4 kickoff; ship ESP sending and a test-user cohort meanwhile. |
| P3 | Crowded market (Instantly, Lemlist, Apollo, Smartlead) commoditises email sending. | 4 | 3 | 12 | Differentiate on ICP-to-campaign automation and cross-channel shared state rather than on raw send volume. |
| P4 | AI cost per customer exceeds plan price at scale. | 3 | 3 | 9 | Per-org metering from day one of Phase 3, flash-tier default, caching, hard budget ceilings, usage-based pricing tier. |
| P5 | Scope creep across nine phases stalls the release. | 4 | 3 | 12 | Phase gates with written acceptance criteria; Instagram and billing explicitly non-blocking. |

## 5. Decisions this risk picture forces

1. **Human-in-the-loop is the LinkedIn product**, not a stopgap. The architecture
   treats automated sending as a capability flag, so no rewrite is needed if partner
   access arrives — and no illegal path exists if it does not.
2. **Approval-before-send defaults to on.** It is the cheapest control against both
   hallucination (T3) and compliance incidents (L1, L5).
3. **Suppression is enforced twice** — at enqueue and inside the send transaction —
   because the single most reputation-damaging bug class is sending after an opt-out.
4. **Email ships before every other channel**, since it is the only channel with
   fully authorised automated sending.
5. **Provenance is schema, not policy.** Columns, with a nightly retention job, are
   the only version of data hygiene that survives contact with a deadline.
