import type { PhasePageProps } from './PhasePage';

/**
 * One entry per screen a later phase delivers. Keeping them as data means the
 * route table, the sidebar and the roadmap cannot drift apart.
 */
export const PLACEHOLDER_PAGES: Record<string, PhasePageProps> = {
  audience: {
    title: 'Target audience',
    description: 'Describe your ideal customer profile in plain language, then refine it with filters.',
    phase: 2,
    capabilities: [
      'Free-text ICP description, parsed into structured filters by Gemini for you to confirm',
      'Filters for industry, country, city, company size, revenue band, job title and seniority',
      'Availability filters: has business email, has LinkedIn profile, verification status',
      'Saved audiences reused by campaigns and by AI qualification',
      'A configurable, visible scoring rubric rather than a hidden score',
    ],
    dependsOn: ['Lead provider adapters (Phase 2)', 'Gemini gateway (Phase 3) for parsing'],
  },
  discovery: {
    title: 'Lead discovery',
    description: 'Find leads through licensed providers or import your own CSV.',
    phase: 2,
    capabilities: [
      'Search preview with an estimated result count and credit cost before you spend anything',
      'CSV import with column mapping, per-row validation and a dry-run report',
      'Deduplication on normalised email, LinkedIn URL and name plus company domain',
      'Provenance recorded for every lead: source, collection date, verification, consent basis',
      'Imports run as background jobs, so a provider outage is a retry and not data loss',
    ],
    dependsOn: ['LeadProvider adapters and a data-provider licence', 'Redis queue for import jobs'],
  },
  leads: {
    title: 'Lead database',
    description: 'One searchable record per prospect, with its full outreach history.',
    phase: 2,
    capabilities: [
      'Filter, sort and cursor-paginate across large lists; saved views',
      'Bulk select to tag, delete or add to a campaign; CSV export',
      'Manual create and edit, with deduplication applied on write',
      'Qualification score with the written rationale that produced it',
      'Per-lead campaign history, reply status and current state',
    ],
  },
  messages: {
    title: 'AI message generator',
    description: 'Draft personalised email and LinkedIn messages grounded in what you actually know.',
    phase: 3,
    capabilities: [
      'Email and LinkedIn drafts generated from stored, sourced facts only',
      'Every draft shows which lead fields it used, so a claim can be traced',
      'Follow-up variants and subject-line alternatives',
      'Side-by-side edit before anything is queued',
      'Token and cost metering per generation, against a per-organization budget',
    ],
    dependsOn: ['Gemini API key', 'Leads with enriched, sourced fields (Phase 2)'],
  },
  emailAccounts: {
    title: 'Email accounts',
    description: 'Connect the mailboxes campaigns will send from.',
    phase: 4,
    capabilities: [
      'Google and Microsoft OAuth connection with encrypted token storage',
      'Per-mailbox daily cap and sending window',
      'Connection health, re-authorization prompts and disconnect',
      'Optional delivery provider for your own verified domain',
    ],
    dependsOn: [
      'Google OAuth verification and CASA assessment for restricted Gmail scopes',
      'Azure app registration for Microsoft Graph',
    ],
  },
  emailCampaigns: {
    title: 'Email campaigns',
    description: 'Build, approve and run email sequences.',
    phase: 4,
    capabilities: [
      'Audience or explicit lead list, templates with variables, AI personalisation step',
      'Approval queue: nothing sends until a human signs it off, by default',
      'Follow-up steps with delays, daily caps and a sending schedule',
      'Per-lead status: queued, sent, delivered, bounced, replied, failed',
      'Pause, resume and stop; follow-ups halt the moment someone replies or opts out',
    ],
    dependsOn: ['A connected mailbox', 'Redis queue workers for scheduled sending'],
  },
  linkedin: {
    title: 'LinkedIn workspace',
    description: 'Draft, sequence and track LinkedIn outreach with a human in the loop.',
    phase: 5,
    capabilities: [
      'AI connection notes within the 300-character limit, and follow-up messages',
      'A send queue you work through manually: copy, send, mark as sent',
      'Conversation tracking that advances the shared lead state',
      'Daily activity caps that mirror platform norms',
    ],
    dependsOn: [
      'No automated sending unless official partner API access is granted — by design, ' +
        'this product does not automate LinkedIn through unauthorized means',
    ],
  },
  campaigns: {
    title: 'All campaigns',
    description: 'Cross-channel orchestration over one shared lead state machine.',
    phase: 6,
    capabilities: [
      'One state machine for every channel, with explicitly allowed transitions',
      'An opt-out or reply on any channel suppresses the prospect on all of them',
      'Conflict rules: one active campaign per lead per channel unless overridden',
      'A scheduling calendar showing planned volume by day and channel',
    ],
  },
  inbox: {
    title: 'Inbox & replies',
    description: 'Triage replies, classify intent and decide the next action.',
    phase: 4,
    capabilities: [
      'Threaded replies pulled from the connected mailbox',
      'Gemini classification: interested, not interested, referral, out of office, unsubscribe',
      'Automatic sequence stop and suppression-list update on an opt-out',
      'Assignment, notes and reply-from-inbox',
    ],
  },
  analytics: {
    title: 'Analytics',
    description: 'Funnel, channel and variant performance from aggregated rollups.',
    phase: 7,
    capabilities: [
      'Dashboard counters served from daily rollups, so they stay fast at volume',
      'Funnel view from contacted through replied to meeting booked and converted',
      'Per-campaign and per-variant comparison, and time series',
      'CSV export that matches the numbers on screen for the same filters',
    ],
  },
};
