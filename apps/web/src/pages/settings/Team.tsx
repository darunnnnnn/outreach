import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InvitationResponse, MemberResponse, Role } from '@outreach/shared';
import { ApiError, http } from '../../lib/api';
import { useAuth, useHasRole } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/layout/AppShell';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Select,
  SkeletonRows,
  Table,
  Td,
  Th,
  useToast,
} from '../../components/ui';

const ASSIGNABLE: Array<Exclude<Role, 'OWNER'>> = ['ADMIN', 'MEMBER', 'VIEWER'];

const ROLE_TONE: Record<Role, 'brand' | 'green' | 'slate'> = {
  OWNER: 'brand',
  ADMIN: 'green',
  MEMBER: 'slate',
  VIEWER: 'slate',
};

export function TeamPage() {
  const { user } = useAuth();
  const canManage = useHasRole('ADMIN');
  const queryClient = useQueryClient();
  const toast = useToast();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<Role, 'OWNER'>>('MEMBER');
  const [inviteError, setInviteError] = useState<ApiError | null>(null);
  const [lastAcceptUrl, setLastAcceptUrl] = useState<string | null>(null);
  const [removing, setRemoving] = useState<MemberResponse | null>(null);

  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => http.get<{ data: MemberResponse[] }>('/organizations/current/members'),
  });

  const invitations = useQuery({
    queryKey: ['invitations'],
    enabled: canManage,
    queryFn: () => http.get<{ data: InvitationResponse[] }>('/invitations'),
  });

  const invite = useMutation({
    mutationFn: (payload: { email: string; role: Role }) =>
      http.post<InvitationResponse>('/invitations', payload),
    onSuccess: (created) => {
      setInviteEmail('');
      setInviteError(null);
      // In local development mail is only logged, so the API returns the link.
      setLastAcceptUrl(created.acceptUrl ?? null);
      toast.push(`Invitation sent to ${created.email}`);
      void queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (err) => {
      setInviteError(err instanceof ApiError ? err : null);
    },
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Exclude<Role, 'OWNER'> }) =>
      http.patch<{ data: MemberResponse[] }>(`/organizations/current/members/${userId}`, { role }),
    onSuccess: () => {
      toast.push('Role updated');
      void queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : 'Update failed', 'error'),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => http.del<void>(`/organizations/current/members/${userId}`),
    onSuccess: () => {
      toast.push('Member removed');
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      void queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
    onError: (err) => {
      toast.push(err instanceof ApiError ? err.message : 'Could not remove member', 'error');
      setRemoving(null);
    },
  });

  const transfer = useMutation({
    mutationFn: (userId: string) =>
      http.post('/organizations/current/transfer-ownership', { userId }),
    onSuccess: async () => {
      toast.push('Ownership transferred. You are now an admin.');
      await queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : 'Transfer failed', 'error'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => http.del<void>(`/invitations/${id}`),
    onSuccess: () => {
      toast.push('Invitation revoked');
      void queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : 'Revoke failed', 'error'),
  });

  const isOwner = useHasRole('OWNER');
  const pending = (invitations.data?.data ?? []).filter((i) => i.status === 'PENDING');

  return (
    <>
      <PageHeader
        title="Team members"
        description="Roles decide what each person can do. The API enforces them regardless of what this page shows."
      />

      {canManage && (
        <Card title="Invite someone" className="mb-6">
          <form
            className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              invite.mutate({ email: inviteEmail, role: inviteRole });
            }}
            noValidate
          >
            <Input
              label="Email address"
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              error={inviteError?.fieldError('email')}
            />
            <Select
              label="Role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Exclude<Role, 'OWNER'>)}
            >
              {ASSIGNABLE.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </Select>
            <Button type="submit" loading={invite.isPending}>
              Send invitation
            </Button>
          </form>

          {inviteError && !inviteError.fieldError('email') && (
            <div className="mt-3">
              <Alert tone="error">{inviteError.message}</Alert>
            </div>
          )}

          {lastAcceptUrl && (
            <div className="mt-3">
              <Alert tone="info" title="Mail is being logged, not delivered">
                <p>
                  The API is running with <code>MAIL_TRANSPORT=console</code>, so share this link
                  directly:
                </p>
                <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs ring-1 ring-brand-200">
                  {lastAcceptUrl}
                </code>
              </Alert>
            </div>
          )}
        </Card>
      )}

      <Card title="Members" description={`${members.data?.data.length ?? 0} in this organization`}>
        {members.isLoading ? (
          <SkeletonRows rows={3} />
        ) : members.isError ? (
          <Alert tone="error">Could not load members.</Alert>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Last sign-in</Th>
                {canManage && <Th className="text-right">Actions</Th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.data!.data.map((member) => (
                <tr key={member.userId}>
                  <Td>
                    <span className="font-medium text-slate-900">{member.name}</span>
                    {member.userId === user?.id && (
                      <span className="ml-2 text-xs text-slate-500">(you)</span>
                    )}
                  </Td>
                  <Td>{member.email}</Td>
                  <Td>
                    {canManage && member.role !== 'OWNER' ? (
                      <select
                        aria-label={`Role for ${member.name}`}
                        className="rounded-md border-0 bg-white py-1 pl-2 pr-7 text-sm ring-1 ring-inset ring-slate-300"
                        value={member.role}
                        disabled={changeRole.isPending}
                        onChange={(e) =>
                          changeRole.mutate({
                            userId: member.userId,
                            role: e.target.value as Exclude<Role, 'OWNER'>,
                          })
                        }
                      >
                        {ASSIGNABLE.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge tone={ROLE_TONE[member.role]}>{member.role}</Badge>
                    )}
                  </Td>
                  <Td>
                    {member.lastLoginAt
                      ? new Date(member.lastLoginAt).toLocaleDateString()
                      : 'Never'}
                  </Td>
                  {canManage && (
                    <Td className="text-right">
                      <div className="flex justify-end gap-2">
                        {isOwner && member.role !== 'OWNER' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={transfer.isPending}
                            onClick={() => transfer.mutate(member.userId)}
                          >
                            Make owner
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:bg-red-50"
                          onClick={() => setRemoving(member)}
                        >
                          Remove
                        </Button>
                      </div>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {canManage && (
        <div className="mt-6">
          <Card title="Pending invitations">
            {invitations.isLoading ? (
              <SkeletonRows rows={2} />
            ) : pending.length === 0 ? (
              <EmptyState
                title="No pending invitations"
                description="Invite a colleague above. Invitations expire after seven days and can be re-sent at any time."
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Email</Th>
                    <Th>Role</Th>
                    <Th>Invited by</Th>
                    <Th>Expires</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pending.map((invitation) => (
                    <tr key={invitation.id}>
                      <Td>{invitation.email}</Td>
                      <Td>
                        <Badge tone={ROLE_TONE[invitation.role]}>{invitation.role}</Badge>
                      </Td>
                      <Td>{invitation.invitedByName}</Td>
                      <Td>{new Date(invitation.expiresAt).toLocaleDateString()}</Td>
                      <Td className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:bg-red-50"
                          loading={revoke.isPending}
                          onClick={() => revoke.mutate(invitation.id)}
                        >
                          Revoke
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Remove this member?"
        description={
          <>
            <strong>{removing?.name}</strong> ({removing?.email}) will lose access to this
            organization immediately. Their campaigns and leads stay with the organization.
          </>
        }
        confirmLabel="Remove member"
        busy={removeMember.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && removeMember.mutate(removing.userId)}
      />
    </>
  );
}
