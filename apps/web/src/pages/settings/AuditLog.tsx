import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AuditLogResponse, Paginated } from '@outreach/shared';
import { http } from '../../lib/api';
import { PageHeader } from '../../components/layout/AppShell';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Select,
  SkeletonRows,
  Table,
  Td,
  Th,
} from '../../components/ui';

const ACTIONS = [
  'auth.registered',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.logout_all',
  'auth.refresh_reuse_detected',
  'auth.password_changed',
  'user.profile_updated',
  'org.updated',
  'org.ownership_transferred',
  'member.role_changed',
  'member.removed',
  'invitation.created',
  'invitation.accepted',
  'invitation.revoked',
];

/** Security-relevant actions are called out so they are not lost in the noise. */
const HIGH_SIGNAL = new Set([
  'auth.refresh_reuse_detected',
  'auth.login_failed',
  'member.role_changed',
  'member.removed',
  'org.ownership_transferred',
]);

const PAGE_SIZE = 25;

export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');

  const query = useQuery({
    queryKey: ['audit-logs', page, action],
    placeholderData: keepPreviousData,
    queryFn: () =>
      http.get<Paginated<AuditLogResponse>>(
        `/organizations/current/audit-logs?page=${page}&pageSize=${PAGE_SIZE}` +
          (action ? `&action=${encodeURIComponent(action)}` : ''),
      ),
  });

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every account, permission and organization change, with the actor and their IP address."
      />

      <Card
        title="Events"
        description={meta ? `${meta.total} event(s)` : undefined}
        actions={
          <div className="w-56">
            <Select
              label="Filter by action"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All actions</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        {query.isLoading ? (
          <SkeletonRows rows={5} />
        ) : query.isError ? (
          <Alert tone="error">Could not load the audit log.</Alert>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No events match this filter"
            description="Try a different action, or clear the filter to see everything."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Action</Th>
                  <Th>Actor</Th>
                  <Th>Target</Th>
                  <Th>Details</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <Td className="whitespace-nowrap text-xs text-slate-500">
                      {new Date(row.createdAt).toLocaleString()}
                    </Td>
                    <Td>
                      <Badge tone={HIGH_SIGNAL.has(row.action) ? 'amber' : 'slate'}>
                        {row.action}
                      </Badge>
                    </Td>
                    <Td>{row.actorName ?? <span className="text-slate-400">system</span>}</Td>
                    <Td className="text-xs text-slate-500">
                      {row.targetType ? `${row.targetType}` : '—'}
                    </Td>
                    <Td className="max-w-xs">
                      <code className="block truncate text-xs text-slate-500">
                        {Object.keys(row.metadata).length > 0
                          ? JSON.stringify(row.metadata)
                          : '—'}
                      </code>
                    </Td>
                    <Td className="text-xs text-slate-500">{row.ip ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-slate-500">
                Page {meta?.page} · showing {rows.length} of {meta?.total}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page === 1 || query.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!meta?.hasMore || query.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
