import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrganizationResponse } from '@outreach/shared';
import { ApiError, http } from '../../lib/api';
import { useHasRole } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/layout/AppShell';
import { Alert, Button, Card, Input, Select, SkeletonRows, useToast } from '../../components/ui';

/** A short list covers the launch markets; a full IANA list arrives with scheduling. */
const TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Warsaw',
  'Europe/Istanbul',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
];

export function OrganizationSettingsPage() {
  const canEdit = useHasRole('ADMIN');
  const queryClient = useQueryClient();
  const toast = useToast();

  const org = useQuery({
    queryKey: ['organization'],
    queryFn: () => http.get<OrganizationResponse>('/organizations/current'),
  });

  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!org.data) return;
    setName(org.data.name);
    setTimezone(org.data.timezone);
  }, [org.data]);

  const save = useMutation({
    mutationFn: () =>
      http.patch<OrganizationResponse>('/organizations/current', { name, timezone }),
    onSuccess: async () => {
      setError(null);
      toast.push('Organization updated');
      await queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err : null),
  });

  const dirty = org.data ? name !== org.data.name || timezone !== org.data.timezone : false;
  const options = org.data && !TIMEZONES.includes(org.data.timezone)
    ? [org.data.timezone, ...TIMEZONES]
    : TIMEZONES;

  return (
    <>
      <PageHeader
        title="Organization"
        description="Shared settings for everyone in this workspace."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="General">
          {org.isLoading ? (
            <SkeletonRows rows={3} />
          ) : org.isError ? (
            <Alert tone="error">Could not load the organization.</Alert>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
              noValidate
            >
              {error && <Alert tone="error">{error.message}</Alert>}
              {!canEdit && (
                <Alert tone="info">
                  You have read-only access to these settings. An admin or owner can change them.
                </Alert>
              )}

              <Input
                label="Organization name"
                required
                disabled={!canEdit}
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={error?.fieldError('name')}
              />

              <Select
                label="Timezone"
                disabled={!canEdit}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                hint="Used for sending windows, schedules and reports."
              >
                {options.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>

              {canEdit && (
                <div className="flex items-center gap-3">
                  <Button type="submit" loading={save.isPending} disabled={!dirty}>
                    Save changes
                  </Button>
                  {dirty && <span className="text-xs text-slate-500">Unsaved changes</span>}
                </div>
              )}
            </form>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Identifiers">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-slate-500">Slug</dt>
                <dd className="font-mono text-xs text-slate-800">{org.data?.slug ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Organization ID</dt>
                <dd className="break-all font-mono text-xs text-slate-800">{org.data?.id ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Created</dt>
                <dd className="text-slate-800">
                  {org.data ? new Date(org.data.createdAt).toLocaleDateString() : '—'}
                </dd>
              </div>
            </dl>
          </Card>

          <Card title="Coming later">
            <ul className="space-y-2 text-sm text-slate-600">
              <li>· Ideal customer profile defaults — Phase 2</li>
              <li>· AI model and monthly budget — Phase 3</li>
              <li>· Sending windows and daily caps — Phase 4</li>
              <li>· Data retention and deletion — Phase 9</li>
              <li>· Plan, usage limits and billing — Phase 9</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
