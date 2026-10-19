# Third-Party Integrations, Restrictions and Operating Costs

> All prices below are planning estimates and must be re-checked against each
> vendor's current pricing page before procurement or before being quoted to a
> customer. Treat them as orders of magnitude for budgeting, not as quotes.

## 1. Google Gemini (Phase 3)

- **SDK:** `@google/genai`. Server-side only; the key never reaches the browser.
- **Usage pattern:** short prompts (one lead's grounded facts, 300–1500 tokens in)
  and short outputs (150–600 tokens). Qualification and drafting are the volume
  drivers.
- **Restrictions that affect design:** per-project rate limits and token quotas
  (so all generation is queued and rate-limited per org), content filters (a blocked
  response must be a typed failure, not a crash), and no guarantee of valid JSON
  without structured-output constraints plus validation.
- **Cost model:** per input/output token, cheaper on the small/flash tier. Budget
  with a flash-tier model for qualification and a pro-tier model only for first-touch
  drafting.
- **Rough budget:** at ~1.2k in / 0.4k out tokens per draft, a flash-tier model lands
  in the fractions-of-a-cent range per draft; 50k drafts/month is a low-tens-of-dollars
  line item. Pro-tier is roughly an order of magnitude more. Metering is in
  `AiUsageDaily`, so real numbers replace the estimate in week one of Phase 3.
- **Mitigations:** cache ICP parses; reuse a lead's qualification until its facts
  change; template-first personalisation with AI only on the variable block;
  hard per-org monthly ceiling checked before each call.

## 2. Gmail API (Phase 4)

- **Scopes:** `gmail.send` plus `gmail.readonly` (or `gmail.modify`) for reply
  detection. These are restricted scopes.
- **Restrictions:** Google OAuth verification and a **CASA security assessment** are
  required for restricted scopes in production; budget 4–8 weeks and an annual
  assessment fee (typically low thousands of USD, higher for the deeper tiers).
  Until verified, the app is limited to test users — plan the Phase 4 beta around
  that cap.
- **Quotas:** per-user daily send limits apply (Workspace accounts send more than
  consumer ones) and the API has its own per-second quota. Our per-mailbox
  `dailyCap` must default below the account's limit, and sends are rate-limited per
  mailbox, not globally.
- **Cost:** no API fee; cost is the assessment plus engineering time.

## 3. Microsoft Graph (Phase 4)

- **Scopes:** `Mail.Send`, `Mail.Read`, `offline_access`.
- **Restrictions:** Azure app registration, admin consent for tenant-wide use,
  publisher verification for a good consent screen. Throttling is aggressive and
  returns `429` with `Retry-After` — the adapter must honour it.
- **Cost:** no API fee.

## 4. Email delivery provider (Phase 4, for org-owned domains)

- **Candidates:** Postmark, SendGrid, Amazon SES.
- **Why also needed:** mailbox APIs are right for 1:1 outreach from a human's
  inbox; a provider is right for transactional mail (invites, password resets,
  unsubscribe confirmations) and for orgs that want to send from a dedicated domain.
- **Restrictions:** domain authentication (SPF, DKIM, DMARC) required; dedicated IP
  needs warm-up; providers suspend accounts on complaint-rate spikes — our bounce
  and complaint handling feeds the suppression list automatically.
- **Rough budget:** transactional volume for a small SaaS is typically a free tier
  or ~$15–50/month. SES is the cheapest per message but requires more setup and
  reputation management.

## 5. Lead data providers (Phase 2)

- **Candidates:** Apollo, Lusha, Cognism, Clearbit/HubSpot Breeze, PDL, and
  regional/trade-association sources for niche segments such as textile exporters.
- **Restrictions that materially affect the product:**
  - Licences are typically per-seat with monthly credit caps, and most **prohibit
    storing or re-exporting** enriched records beyond the licensed seat or term.
    Our `Lead` table therefore records `source`, `sourceRecordId`, `consentBasis`
    and `retentionUntil`, and the retention job enforces the licence term.
  - Coverage and accuracy vary sharply by region. EU contact data is thinner and
    more legally constrained than US data; the German/Dutch textile segment in the
    brief's example is likely to need a trade-directory source plus manual research,
    not a single API.
  - Email verification is a separate service in most stacks (NeverBounce, ZeroBounce,
    Bouncer) priced per check.
- **Rough budget:** entry B2B data plans commonly start around $50–150/seat/month
  for a few hundred to a few thousand credits; serious volume is four figures a
  month. Verification runs roughly $0.003–0.01 per email.
- **Design consequence:** the `LeadProvider` interface and the credit-preview step
  exist precisely so a vendor can be swapped when pricing or coverage disappoints,
  and so a user sees cost before spending credits.

## 6. LinkedIn (Phase 5)

- **What is actually available:** LinkedIn's messaging and Sales Navigator surfaces
  are not open APIs. Programmatic messaging requires membership in a LinkedIn
  partner programme (e.g. Sales Navigator Application Platform), which is approved
  per company, is not self-serve, and carries commercial terms.
- **What we will not build:** cookie/`li_at` session extraction, headless-browser
  automation, connection-request bots, or anything that circumvents rate limits.
  These breach the User Agreement, risk the customer's account being restricted,
  and would make the product unsellable to the mid-market buyers we target.
- **Therefore:** Phase 5 ships drafts, sequencing, a human send queue and
  conversation tracking. `OutreachChannel.canSendAutomatically()` returns `false`
  for LinkedIn unless partner credentials are configured, and a test asserts no
  unauthorised client can be constructed.
- **Cost:** Sales Navigator seats are the customer's expense (roughly $100+/seat/month);
  partner API access is negotiated.

## 7. Instagram / Meta (Phase 8)

- **APIs:** Instagram Messaging via the Messenger Platform, on an Instagram
  **professional** account linked to a Facebook Page, with
  `instagram_manage_messages` and related permissions.
- **Hard restrictions:** businesses may message a user only after that user initiates
  contact, and generally only within a 24-hour window (plus narrow human-agent
  exceptions). Cold outbound DMs to arbitrary accounts are not available. App Review
  and Business Verification are required.
- **Design consequence:** Instagram is positioned as reply management and
  conversation handling, plus profile discovery for research, not cold outreach. The
  adapter marks ineligible prospects `NOT_REACHABLE` with a reason instead of
  attempting a send.

## 8. Supporting services

| Service | Phase | Purpose | Rough monthly |
|---------|-------|---------|---------------|
| Managed Postgres | 1 | Primary store | $20–60 to start |
| Managed Redis | 1 | Queues, rate limits | $10–30 |
| App hosting (API + worker + web) | 1 | 2–3 small instances | $25–75 |
| Object storage | 2 | CSV uploads, exports | < $5 |
| Error tracking (Sentry) | 1 | Exceptions | $0–29 |
| Metrics/traces (Grafana Cloud free tier or similar) | 9 | Observability | $0–50 |
| Stripe | 9 | Billing | ~2.9% + 30¢ per charge |
| Email verification | 2 | Per-check | usage-based |

**Early-stage infrastructure baseline: roughly $100–250/month**, before data-provider
licences and AI usage, which are the two variable costs that dominate at scale.

## 9. Dependency risk register (integration-specific)

| Dependency | Risk | Mitigation |
|------------|------|------------|
| Gemini | Quota or policy change; JSON drift | `AiProvider` interface, schema validation, retries, a second model configurable per org |
| Gmail restricted scopes | Verification delay blocks launch | Start verification at the beginning of Phase 4; ship ESP-based sending and test-user mode first |
| Graph throttling | Send backlog | Honour `Retry-After`, per-mailbox rate limit, DLQ |
| Data provider licence terms | Storage/retention limits, price changes | Provenance + retention columns, provider abstraction, CSV path always available |
| LinkedIn partner access | May never be granted | Human-in-the-loop is the default design, not a fallback |
| Meta app review | Rejection or scope removal | Instagram is additive and non-blocking by design |
