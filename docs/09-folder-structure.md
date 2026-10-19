# Folder Structure

npm workspaces monorepo. Items marked *(Phase n)* are placeholders in the plan, not
files that exist yet; Phase 1 creates everything unmarked.

```
outreach/
├── docs/                              01-prd … 09-folder-structure, runbooks/ (Phase 4)
├── docker-compose.yml                 postgres 16 + redis 7 for local dev
├── package.json                       workspaces, root scripts
├── tsconfig.base.json
├── .env.example
├── packages/
│   └── shared/                        types + Zod schemas used by api and web
│       └── src/
│           ├── auth.ts                register/login/refresh/password schemas
│           ├── organization.ts        org + member + invitation schemas
│           ├── common.ts              pagination, error envelope, Role enum
│           └── index.ts
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── src/
│   │   │   ├── index.ts               http entrypoint
│   │   │   ├── app.ts                 express app factory (testable, no listen)
│   │   │   ├── worker.ts              BullMQ entrypoint (wired Phase 1, used Phase 2+)
│   │   │   ├── config/
│   │   │   │   ├── env.ts             Zod-validated process.env
│   │   │   │   └── logger.ts          pino + redaction
│   │   │   ├── db/
│   │   │   │   └── prisma.ts          singleton client
│   │   │   ├── queue/
│   │   │   │   ├── connection.ts      ioredis
│   │   │   │   └── queues.ts          queue registry + names
│   │   │   ├── http/
│   │   │   │   ├── middleware/        requestId, authenticate, withOrg,
│   │   │   │   │                      requireRole, validate, rateLimit, errorHandler
│   │   │   │   ├── errors.ts          AppError hierarchy + codes
│   │   │   │   └── routes.ts          v1 router assembly
│   │   │   ├── modules/
│   │   │   │   ├── auth/              controller, service, tokens, password
│   │   │   │   ├── organizations/     controller, service (members, roles, settings)
│   │   │   │   ├── invitations/       controller, service
│   │   │   │   ├── audit/             service
│   │   │   │   ├── leads/             (Phase 2)
│   │   │   │   ├── audiences/         (Phase 2)
│   │   │   │   ├── providers/         (Phase 2) LeadProvider registry + adapters
│   │   │   │   ├── ai/                (Phase 3) gateway, prompts/, gemini adapter
│   │   │   │   ├── channels/          (Phase 4-8) email/, linkedin/, instagram/
│   │   │   │   ├── campaigns/         (Phase 4-6) orchestrator, state machine
│   │   │   │   ├── inbox/             (Phase 4)
│   │   │   │   ├── analytics/         (Phase 7)
│   │   │   │   └── billing/           (Phase 9)
│   │   │   ├── jobs/                  (Phase 2+) processors per queue
│   │   │   ├── openapi/
│   │   │   │   └── spec.ts            OpenAPI 3.1 document served at /docs
│   │   │   └── lib/
│   │   │       ├── crypto.ts          AES-256-GCM helpers, token hashing
│   │   │       └── mailer.ts          transactional email (console in dev)
│   │   └── tests/
│   │       ├── unit/
│   │       ├── integration/
│   │       └── helpers/               app factory, db reset, auth fixtures
│   └── web/
│       ├── index.html
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       └── src/
│           ├── main.tsx, App.tsx, router.tsx
│           ├── lib/
│           │   ├── api.ts             fetch wrapper: auth header, refresh-on-401
│           │   └── queryClient.ts
│           ├── auth/
│           │   ├── AuthProvider.tsx   session state, org switching
│           │   └── RequireAuth.tsx
│           ├── components/
│           │   ├── ui/                Button, Input, Select, Card, Table, Badge,
│           │   │                      Dialog, Toast, Spinner, EmptyState, Alert
│           │   └── layout/            AppShell, Sidebar, Topbar, PageHeader
│           ├── pages/
│           │   ├── auth/              Login, Register, AcceptInvite
│           │   ├── Dashboard.tsx
│           │   ├── settings/          Profile, Organization, Team, AuditLog
│           │   └── placeholders/      Audience, Discovery, Leads, LeadDetail,
│           │                          MessageGenerator, EmailAccounts,
│           │                          EmailCampaigns, LinkedIn, Campaigns,
│           │                          Inbox, Analytics  (Phase 2+ screens,
│           │                          shipped as routed "coming in Phase n" states)
│           └── styles/index.css
└── e2e/                               (Phase 9) Playwright specs
```

## Why this layout

- **`modules/` by domain, not by technical layer.** A change to invitations touches
  one directory. The module exposes a service; other modules call that, never its
  Prisma queries.
- **`app.ts` separate from `index.ts`.** Supertest imports the app factory without
  binding a port, which is what makes the integration suite fast and parallel-safe.
- **`packages/shared` holds Zod schemas, not just types.** The same schema validates
  the request on the server and the form on the client, so the two cannot drift.
- **`worker.ts` exists in Phase 1 even with no processors.** Wiring the queue
  connection, graceful shutdown and the Docker entrypoint now is cheap; discovering
  them in Phase 2 under deadline is not.
- **Placeholder pages are routed and styled, not stubs.** Each shows the real
  navigation, a real empty state and what the phase will add — so the shell is
  demonstrably complete and later phases only replace page bodies.
