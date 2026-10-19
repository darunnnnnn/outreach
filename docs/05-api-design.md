# API Design

Base path `/api/v1`. JSON only. Bearer access token in `Authorization`, active org
in `X-Org-Id` (optional when the user belongs to exactly one organisation).
The live spec is served at `/docs` and the raw document at `/openapi.json`.

## 1. Conventions

**Success envelope.** Single resources return the object directly. Collections
return `{ "data": [...], "meta": { "page", "pageSize", "total", "hasMore" } }`.

**Error envelope.**

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request body",
             "details": { "email": "Must be a valid email address" },
             "requestId": "req_01J..." } }
```

| Status | `code` | When |
|--------|--------|------|
| 400 | `BAD_REQUEST` | Malformed JSON, unusable parameters |
| 401 | `UNAUTHENTICATED` | Missing/expired/invalid access token, refresh reuse |
| 403 | `FORBIDDEN` | Authenticated but wrong role or not a member of the org |
| 404 | `NOT_FOUND` | Missing, or belonging to another tenant (we do not disclose existence) |
| 409 | `CONFLICT` | Unique violation, last-owner rule, illegal state transition |
| 422 | `VALIDATION_ERROR` | Zod failure, field-keyed `details` |
| 429 | `RATE_LIMITED` | Bucket exceeded; `Retry-After` set |
| 402 | `LIMIT_EXCEEDED` | Plan or AI budget exhausted (Phase 3+) |
| 500 | `INTERNAL_ERROR` | Unexpected; stack logged, never returned |
| 503 | `DEPENDENCY_UNAVAILABLE` | DB/Redis/provider down (readiness, adapters) |

**Pagination.** `?page=1&pageSize=25` (max 100) for stable lists; cursor
pagination (`?cursor=`) is added in Phase 2 for lead lists.
**Sorting/filtering.** `?sort=-createdAt&state=NEW&q=textile`.
**Idempotency.** Mutating endpoints accept `Idempotency-Key`; replays within 24 h
return the original response.
**Versioning.** The path carries the major version. Additive changes ship in place;
breaking changes open `/api/v2` with both served during a deprecation window.

## 2. Phase 1 endpoints (implemented)

### Auth — `/api/v1/auth`

| Method | Path | Auth | Role | Purpose |
|--------|------|------|------|---------|
| POST | `/register` | – | – | Create user + organisation + OWNER membership; returns tokens |
| POST | `/login` | – | – | Returns access token + rotating refresh token |
| POST | `/refresh` | refresh token | – | Rotates the refresh token; reuse revokes the family |
| POST | `/logout` | access | any | Revokes the presented refresh token |
| POST | `/logout-all` | access | any | Revokes every session for the user |
| GET | `/me` | access | any | User, memberships, active org and role |
| PATCH | `/me` | access | any | Update name |
| POST | `/change-password` | access | any | Requires current password; revokes other sessions |

Refresh tokens are delivered in an `httpOnly`, `sameSite=lax`, `secure` cookie
(`refresh_token`) and also accepted in the body for non-browser clients.

### Organisations — `/api/v1/organizations`

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/current` | VIEWER | Active organisation |
| PATCH | `/current` | ADMIN | Name, timezone, settings |
| GET | `/current/members` | VIEWER | Members with roles |
| PATCH | `/current/members/:userId` | ADMIN | Change role (last-OWNER protected) |
| DELETE | `/current/members/:userId` | ADMIN | Remove member (last-OWNER protected) |
| POST | `/current/transfer-ownership` | OWNER | Promote another member to OWNER |
| GET | `/current/audit-logs` | ADMIN | Paginated, filterable by action/date |

### Invitations — `/api/v1/invitations`

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/` | ADMIN | Invite an email with a role; returns the invite (token emailed) |
| GET | `/` | ADMIN | List invitations for the org |
| DELETE | `/:id` | ADMIN | Revoke a pending invitation |
| GET | `/accept/:token` | – | Inspect an invitation before accepting |
| POST | `/accept/:token` | – or access | Accept: creates the user if new, then the membership |

### Platform

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/healthz` | Liveness: process only |
| GET | `/readyz` | Readiness: Postgres and Redis reachable |
| GET | `/openapi.json`, `/docs` | Spec and Swagger UI |

## 3. Planned endpoints (Phases 2–9)

Listed now so the surface and module boundaries are fixed early.

```
# Phase 2 — audience, leads
POST   /audiences                      create ICP (text + filters)
POST   /audiences/:id/parse            Gemini -> normalised filters (user confirms)
GET    /audiences                      list
POST   /leads/search/preview           provider count + credit estimate
POST   /leads/search                   -> job: lead.import
POST   /leads/import                   multipart CSV -> job, dry-run supported
GET    /leads/import/:id               import job status + error report
GET    /leads                          filter, sort, cursor-paginate
POST   /leads                          manual create
GET    /leads/:id                      detail incl. provenance + history
PATCH  /leads/:id                      edit
DELETE /leads/:id                      soft delete
POST   /leads/bulk                     {action, leadIds|filter} tag/delete/add-to-campaign
GET    /leads/export                   CSV stream
GET    /suppression, POST /suppression, DELETE /suppression/:id

# Phase 3 — AI
POST   /ai/qualify                     {audienceId, leadIds|filter} -> job
POST   /ai/messages/draft              {leadId, channel, templateId?, tone?}
POST   /ai/messages/followups          {messageId, count}
POST   /ai/replies/classify            {inboxMessageId}
GET    /ai/usage                       tokens + cost by day/kind
GET    /ai/generations/:id             stored prompt, output, cost

# Phase 4 — email
GET    /integrations/email             connected mailboxes
GET    /integrations/email/:provider/authorize   -> OAuth redirect
GET    /integrations/email/:provider/callback    OAuth code exchange
DELETE /integrations/email/:id         disconnect
PATCH  /integrations/email/:id         caps, sending window
GET/POST /templates, PATCH/DELETE /templates/:id
POST   /campaigns                      create (channel=EMAIL)
GET    /campaigns                      list with metrics
GET    /campaigns/:id                  detail incl. steps
PATCH  /campaigns/:id                  edit while DRAFT/PAUSED
POST   /campaigns/:id/steps            add/replace steps
POST   /campaigns/:id/leads            attach by ids or filter
POST   /campaigns/:id/generate         produce drafts for pending leads
GET    /campaigns/:id/approvals        drafts awaiting approval
POST   /campaigns/:id/approvals/:mid   approve or reject with edits
POST   /campaigns/:id/activate|pause|resume|stop
GET    /campaigns/:id/messages         per-lead status
GET    /unsubscribe/:token             public, no auth; records opt-out
POST   /webhooks/email/:provider       public, signature-verified

# Phase 5 — LinkedIn
GET    /linkedin/queue                 approved drafts awaiting manual send
POST   /linkedin/queue/:id/sent        mark as sent -> advances state
POST   /linkedin/conversations/:leadId/notes

# Phase 6 — orchestration
GET    /campaigns/calendar             scheduled volume by day and channel
POST   /leads/:id/state                explicit transition, validated + audited

# Phase 7 — analytics, CRM
GET    /analytics/overview             dashboard counters
GET    /analytics/campaigns/:id        funnel, variants, time series
GET    /analytics/export               CSV
GET/POST /leads/:id/notes, /leads/:id/tasks
GET    /inbox                          threads, filter by status/assignee
POST   /inbox/:threadId/reply          send a reply through the mailbox
POST   /inbox/:threadId/assign

# Phase 9 — platform
GET    /billing/subscription, POST /billing/checkout, POST /billing/portal
GET    /usage                          plan limits vs consumption
POST   /privacy/export, POST /privacy/delete
```

## 4. Integration boundaries

Interfaces the modules depend on, so vendors stay replaceable:

```ts
interface LeadProvider {
  key: string;                                        // "csv" | "apollo" | ...
  preview(q: LeadQuery, ctx: Ctx): Promise<{ estimatedCount: number; creditCost: number }>;
  fetch(q: LeadQuery, page: Cursor, ctx: Ctx): Promise<{ records: RawLead[]; next?: Cursor }>;
  capabilities(): { supportsEmail: boolean; supportsLinkedIn: boolean; filters: FilterKey[] };
}

interface AiProvider {
  generate<T>(req: { promptKey: string; version: string; input: unknown;
                     schema: ZodSchema<T>; model?: string }): Promise<AiResult<T>>;
}

interface OutreachChannel {
  type: ChannelType;
  canSendAutomatically(): boolean;                    // false -> human-in-the-loop queue
  validateDraft(d: Draft): ValidationResult;          // e.g. 300-char connection notes
  send(d: ApprovedDraft, creds: ChannelCredentials): Promise<SendResult>;
}

interface MailboxProvider {                           // GMAIL | MS_GRAPH | SMTP | ESP
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<TokenSet>;
  refresh(tokens: TokenSet): Promise<TokenSet>;
  send(msg: OutboundEmail, tokens: TokenSet): Promise<SendResult>;
  listReplies(since: Date, tokens: TokenSet): Promise<InboundEmail[]>;
}
```

Rules: HTTP controllers never import an adapter; they call a service. Services
receive adapters from a registry keyed by provider name, which is how a fake
adapter is injected in tests.

## 5. Rate limits (Phase 1 defaults)

| Bucket | Limit |
|--------|-------|
| Global per IP | 300 requests / 5 min |
| `POST /auth/login`, `/auth/register` | 10 / 15 min per IP, plus 5 / 15 min per email |
| `POST /auth/refresh` | 60 / 15 min per IP |
| `POST /invitations` | 50 / day per org |

Backed by an in-memory store locally and Redis in deployed environments, so limits
hold across API replicas.
