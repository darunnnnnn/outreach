# Database Design

PostgreSQL 16, Prisma 6. Snake-case table names via `@@map`, camel-case in code.
Every business table carries `organizationId` with an index, and every repository
function takes it as a required argument.

Phase 1 migrates only the identity/org/audit tables (§2). Sections §3–§7 are the
designed target so the migrations arrive in a known order; they are not created yet.

## 1. Conventions

- Primary keys: `cuid()` text ids. Readable in logs, no sequence contention, no
  enumeration of tenants.
- Timestamps: `createdAt` / `updatedAt` on every table, `timestamptz`.
- Soft delete only where restore matters (`Lead.deletedAt`, `Campaign.archivedAt`).
  Everything else is a hard delete with cascade.
- Money as integer minor units (`costMicroUsd` for AI spend, `amountCents` for billing).
- Provider payloads in `jsonb` (`rawPayload`), never trusted as a source of truth;
  normalised columns are the contract.
- Enums as Postgres enums where the set is closed and small; text + check where the
  set will grow (e.g. `source`).

## 2. Phase 1: identity, organisation, audit

```prisma
enum Role            { OWNER ADMIN MEMBER VIEWER }
enum InvitationStatus{ PENDING ACCEPTED REVOKED EXPIRED }

model User {
  id              String    @id @default(cuid())
  email           String    @unique            // stored lower-cased
  passwordHash    String
  name            String
  emailVerifiedAt DateTime?
  lastLoginAt     DateTime?
  isActive        Boolean   @default(true)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  memberships     Membership[]
  sessions        Session[]
  invitesSent     Invitation[] @relation("invitedBy")
  auditLogs       AuditLog[]
}

model Organization {
  id            String   @id @default(cuid())
  name          String
  slug          String   @unique
  timezone      String   @default("UTC")
  plan          String   @default("free")      // free|starter|growth (Phase 9)
  aiMonthlyBudgetMicroUsd BigInt @default(0)   // 0 = unlimited for now
  settings      Json     @default("{}")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  memberships   Membership[]
  invitations   Invitation[]
  auditLogs     AuditLog[]
}

model Membership {
  id             String   @id @default(cuid())
  userId         String
  organizationId String
  role           Role     @default(MEMBER)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, organizationId])
  @@index([organizationId, role])
}

model Session {                                 // one row per refresh-token family member
  id             String   @id @default(cuid())
  userId         String
  familyId       String                         // rotation family; reuse revokes the family
  tokenHash      String   @unique               // sha256 of the refresh token
  userAgent      String?
  ip             String?
  expiresAt      DateTime
  revokedAt      DateTime?
  replacedById   String?  @unique
  createdAt      DateTime @default(now())

  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, revokedAt])
  @@index([familyId])
}

model Invitation {
  id             String           @id @default(cuid())
  organizationId String
  email          String                         // lower-cased
  role           Role             @default(MEMBER)
  tokenHash      String           @unique
  status         InvitationStatus @default(PENDING)
  invitedById    String
  expiresAt      DateTime
  acceptedAt     DateTime?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  invitedBy      User         @relation("invitedBy", fields: [invitedById], references: [id])

  @@unique([organizationId, email, status])     // one live invite per email per org
  @@index([organizationId, status])
}

model AuditLog {
  id             String   @id @default(cuid())
  organizationId String?                        // null for pre-org events (e.g. failed login)
  actorUserId    String?
  action         String                         // "auth.login", "member.role_changed", ...
  targetType     String?                        // "user" | "membership" | "campaign" | ...
  targetId       String?
  metadata       Json     @default("{}")
  ip             String?
  userAgent      String?
  createdAt      DateTime @default(now())

  organization   Organization? @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  actor          User?         @relation(fields: [actorUserId], references: [id], onDelete: SetNull)

  @@index([organizationId, createdAt])
  @@index([action, createdAt])
}
```

## 3. Phase 2: audience, companies, leads

```prisma
enum VerificationStatus { UNKNOWN UNVERIFIED VALID RISKY INVALID }
enum LeadState {
  NEW QUALIFIED READY CONTACTED FOLLOW_UP_DUE REPLIED MEETING_BOOKED CONVERTED
  NOT_INTERESTED BOUNCED UNSUBSCRIBED PAUSED FAILED NOT_REACHABLE
}

model Audience {          // the ICP
  id, organizationId, name
  description      String      // natural language as typed
  filters          Json        // normalised structured filters
  parsedByAiAt     DateTime?
  scoringCriteria  Json        // editable qualification rubric
  createdById, createdAt, updatedAt
  @@index([organizationId])
}

model Company {
  id, organizationId
  name             String
  domain           String?     // normalised, no scheme/www
  website          String?
  industry         String?
  employeeBand     String?     // "1-10" ... "5000+"
  revenueBand      String?
  country, region, city
  linkedinUrl      String?
  rawPayload       Json
  @@unique([organizationId, domain])
  @@index([organizationId, industry, country])
}

model Lead {
  id, organizationId
  companyId        String?
  firstName, lastName, fullName, jobTitle, seniority
  email            String?     // null when not found. Never guessed
  emailNormalized  String?     // lower-case, gmail dots stripped, for dedupe
  emailVerification VerificationStatus @default(UNKNOWN)
  linkedinUrl      String?
  linkedinKey      String?     // path segment only, for dedupe
  instagramHandle  String?
  phone            String?
  country, region, city, timezone
  state            LeadState   @default(NEW)
  score            Int?        // 0-100
  scoreRationale   String?
  ownerUserId      String?
  source           String      // "csv" | "<provider>" | "manual"
  sourceRecordId   String?
  collectedAt      DateTime
  consentBasis     String?     // "legitimate_interest" | "consent" | ...
  retentionUntil   DateTime?
  lastContactedAt  DateTime?
  repliedAt        DateTime?
  notes            String?
  customFields     Json
  rawPayload       Json
  deletedAt        DateTime?
  @@unique([organizationId, emailNormalized])
  @@unique([organizationId, linkedinKey])
  @@index([organizationId, state, score])
  @@index([organizationId, companyId])
}

model LeadImport {
  id, organizationId, createdById
  filename, status           // PENDING|RUNNING|DONE|FAILED
  columnMapping    Json
  totalRows, imported, duplicatesSkipped, failed  Int
  errorReport      Json      // [{row, field, message}]
  startedAt, finishedAt
}

model SuppressionEntry {
  id, organizationId
  value            String    // email (normalised) or domain
  kind             String    // "EMAIL" | "DOMAIN"
  reason           String    // "unsubscribe" | "bounce" | "manual" | "complaint"
  createdAt
  @@unique([organizationId, kind, value])
}
```

The two partial unique indexes on `Lead` are created with `WHERE ... IS NOT NULL`
in raw SQL inside the migration, so many leads may have a null email without
colliding.

## 4. Phase 3: AI

```prisma
model AiGeneration {
  id, organizationId, userId?
  kind             String    // ICP_PARSE|QUALIFY|EMAIL_DRAFT|LI_DRAFT|FOLLOWUP|REPLY_CLASSIFY
  leadId?, campaignId?
  promptKey, promptVersion
  model            String
  input            Json      // exact grounded facts passed in
  output           Json
  inputTokens, outputTokens Int
  costMicroUsd     Int
  latencyMs        Int
  status           String    // OK|INVALID_OUTPUT|ERROR|BUDGET_BLOCKED
  error            String?
  createdAt
  @@index([organizationId, kind, createdAt])
}

model AiUsageDaily {         // cheap budget checks
  organizationId, date, inputTokens, outputTokens, costMicroUsd, calls
  @@id([organizationId, date])
}
```

## 5. Deduplication rules

Applied in this order on every inbound lead (CSV row or provider record):

1. `emailNormalized` match -> merge into existing lead (fill null fields only,
   append to `rawPayload` history, never overwrite a verified value with an
   unverified one).
2. `linkedinKey` match -> merge as above.
3. `(companyId, lower(fullName))` match where both have a company domain -> flag as
   a probable duplicate for review rather than auto-merging.

Normalisation: email lower-cased, surrounding whitespace stripped, `+tag` kept,
dots removed only for `gmail.com`/`googlemail.com`; LinkedIn URL reduced to the
`/in/<slug>` segment, lower-cased, query and trailing slash removed.

## 6. Phase 4–6: channels and campaigns

```prisma
enum ChannelType     { EMAIL LINKEDIN INSTAGRAM }
enum CampaignStatus  { DRAFT SCHEDULED ACTIVE PAUSED STOPPED COMPLETED }
enum MessageStatus   { DRAFT PENDING_APPROVAL QUEUED SENT DELIVERED OPENED REPLIED BOUNCED FAILED SKIPPED CANCELLED }

model Mailbox {
  id, organizationId, userId
  provider         String    // GMAIL | MS_GRAPH | SMTP | ESP
  address          String
  displayName      String?
  accessTokenEnc, refreshTokenEnc String?   // AES-256-GCM
  tokenExpiresAt   DateTime?
  scopes           String[]
  dailyCap         Int       @default(50)
  sendWindowStart, sendWindowEnd Int        // minutes from midnight, org timezone
  status           String    // CONNECTED | NEEDS_REAUTH | DISABLED
  lastSyncedAt     DateTime?
  @@unique([organizationId, provider, address])
}

model Campaign {
  id, organizationId, createdById
  name, objective
  channel          ChannelType
  status           CampaignStatus @default(DRAFT)
  audienceId?      String
  mailboxId?       String
  personalizationMode String     // NONE | TEMPLATE | AI
  requiresApproval Boolean  @default(true)
  dailyCap         Int?
  scheduleStartAt, scheduleEndAt DateTime?
  timezone         String
  metrics          Json           // denormalised counters, rebuilt by rollup
  archivedAt       DateTime?
  @@index([organizationId, status])
}

model CampaignStep {
  id, campaignId, stepIndex Int
  delayHours       Int            // from previous step
  subjectTemplate  String?
  bodyTemplate     String
  variants         Json           // subject-line / body variants
  @@unique([campaignId, stepIndex])
}

model CampaignLead {
  id, campaignId, leadId, organizationId
  state            LeadState @default(READY)
  currentStepIndex Int       @default(0)
  nextActionAt     DateTime?
  stoppedReason    String?
  @@unique([campaignId, leadId])
  @@index([organizationId, nextActionAt])
}

model OutreachMessage {
  id, organizationId, campaignId?, leadId, stepIndex Int
  channel          ChannelType
  mailboxId?       String
  subject?, body   String
  status           MessageStatus
  providerMessageId String?
  threadId         String?
  aiGenerationId?  String
  approvedById?    String
  queuedAt, sentAt, deliveredAt, repliedAt, bouncedAt DateTime?
  failureReason    String?
  @@unique([campaignId, leadId, stepIndex])     // the duplicate-send guard
  @@index([organizationId, status, sentAt])
}

model InboxThread / InboxMessage   // replies, classification, assignment
model EmailTemplate                // reusable templates with variables
```

## 7. Phase 7–9

`CampaignDailyStat(organizationId, campaignId, date, sent, delivered, replied,
positiveReplies, bounced, unsubscribed, meetings)` as the rollup target;
`LeadNote`, `LeadTask`; `Subscription`, `UsageCounter`, `Invoice` for billing;
`WebhookEvent` for provider callbacks with a dedupe key.

## 8. Migration order

1. `0001_identity` — users, organizations, memberships, sessions, invitations, audit_logs. *(Phase 1)*
2. `0002_leads` — audiences, companies, leads (+ partial unique indexes), lead_imports, suppression_entries.
3. `0003_ai` — ai_generations, ai_usage_daily.
4. `0004_email` — mailboxes, email_templates, campaigns, campaign_steps, campaign_leads, outreach_messages.
5. `0005_inbox` — inbox_threads, inbox_messages, webhook_events.
6. `0006_orchestration` — cross-channel constraints, lead state check constraints.
7. `0007_analytics` — campaign_daily_stats, lead_notes, lead_tasks.
8. `0008_instagram` — instagram channel accounts and eligibility fields.
9. `0009_billing_rls` — subscriptions, usage counters, row-level security policies.
