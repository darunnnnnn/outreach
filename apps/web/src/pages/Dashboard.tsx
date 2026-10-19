import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { OrganizationResponse } from '@outreach/shared';
import { http } from '../lib/api';
import { useAuth, useHasRole } from '../auth/AuthProvider';
import { PageHeader } from '../components/layout/AppShell';
import { Alert, Badge, Button, Card, EmptyState, SkeletonRows } from '../components/ui';

/**
 * The metrics the dashboard will show are produced by later phases, so each
 * tile states which phase fills it rather than displaying a fake zero. The
 * counters that exist in Phase 1 (members) are real.
 */
const METRICS: Array<{ label: string; phase: number }> = [
  { label: 'Total leads', phase: 2 },
  { label: 'Qualified leads', phase: 3 },
  { label: 'Active campaigns', phase: 4 },
  { label: 'Messages sent', phase: 4 },
  { label: 'Replies received', phase: 4 },
  { label: 'Positive replies', phase: 4 },
  { label: 'Meetings booked', phase: 7 },
  { label: 'Bounce rate', phase: 4 },
  { label: 'Opt-out rate', phase: 4 },
  { label: 'Conversion rate', phase: 7 },
];

const NEXT_STEPS = [
  {
    title: 'Invite your team',
    description: 'Add colleagues as admins, members or read-only viewers.',
    to: '/settings/team',
    available: true,
  },
  {
    title: 'Set your organization timezone',
    description: 'Sending windows and schedules will use it.',
    to: '/settings/organization',
    available: true,
  },
  {
    title: 'Describe your ideal customer profile',
    description: 'Lead discovery and AI qualification build on it.',
    to: '/audience',
    available: false,
  },
];

export function DashboardPage() {
  const { user, role } = useAuth();
  const canSeeOrg = useHasRole('VIEWER');

  const org = useQuery({
    queryKey: ['organization'],
    enabled: canSeeOrg,
    queryFn: () => http.get<OrganizationResponse>('/organizations/current'),
  });

  const firstName = user?.name.split(' ')[0] ?? 'there';

  return (
    <>
      <PageHeader
        title={`Welcome, ${firstName}`}
        description="Phase 1 is live: accounts, organizations, roles and audit. The outreach engine arrives in the phases below."
        actions={
          <Button variant="secondary" onClick={() => window.open('/docs', '_blank')}>
            API docs
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Organization</p>
          {org.isLoading ? (
            <div className="skeleton mt-2 h-6 w-32" />
          ) : org.isError ? (
            <p className="mt-2 text-sm text-red-600">Could not load</p>
          ) : (
            <>
              <p className="mt-1 truncate text-lg font-semibold text-slate-900">
                {org.data?.name}
              </p>
              <p className="mt-1 text-xs text-slate-500">{org.data?.timezone}</p>
            </>
          )}
        </Card>

        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Members</p>
          {org.isLoading ? (
            <div className="skeleton mt-2 h-6 w-10" />
          ) : (
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {org.data?.memberCount ?? '—'}
            </p>
          )}
          <Link to="/settings/team" className="mt-1 inline-block text-xs text-brand-700 hover:underline">
            Manage team
          </Link>
        </Card>

        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Your role</p>
          <p className="mt-2">
            <Badge tone="brand">{role ?? '—'}</Badge>
          </p>
        </Card>

        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Plan</p>
          <p className="mt-1 text-lg font-semibold capitalize text-slate-900">
            {org.data?.plan ?? 'free'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Usage limits and billing land in Phase 9.</p>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Outreach metrics"
          description="Each tile is filled by the phase that produces its data."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {METRICS.map((metric) => (
              <div
                key={metric.label}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
              >
                <span className="text-sm text-slate-600">{metric.label}</span>
                <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                  PHASE {metric.phase}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Next steps">
          <ul className="space-y-3">
            {NEXT_STEPS.map((step) => (
              <li key={step.title} className="flex flex-col">
                {step.available ? (
                  <Link
                    to={step.to}
                    className="text-sm font-medium text-brand-700 hover:underline"
                  >
                    {step.title}
                  </Link>
                ) : (
                  <span className="text-sm font-medium text-slate-400">{step.title}</span>
                )}
                <span className="text-xs text-slate-500">{step.description}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6">
        {org.isError ? (
          <Alert tone="error" title="Organization could not be loaded">
            Reload the page. If this persists, check that the API is running.
          </Alert>
        ) : (
          <Card title="Recent activity">
            {org.isLoading ? (
              <SkeletonRows rows={2} />
            ) : (
              <EmptyState
                title="Campaign activity will appear here"
                description="Once lead discovery (Phase 2) and email campaigns (Phase 4) are in place, sends, replies and state changes stream into this feed. The audit log already records every account and permission change."
                action={
                  <Link
                    to="/settings/audit-log"
                    className="inline-flex items-center rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
                  >
                    Open audit log
                  </Link>
                }
              />
            )}
          </Card>
        )}
      </div>
    </>
  );
}
