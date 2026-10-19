import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PublicInvitationResponse } from '@outreach/shared';
import { ApiError, http } from '../../lib/api';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button, Input, Spinner } from '../../components/ui';
import { AuthLayout } from './AuthLayout';

interface AcceptResponse {
  organizationId: string;
  organizationName: string;
  role: string;
  accessToken?: string;
}

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { status, adoptSession, reload } = useAuth();

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const invitation = useQuery({
    queryKey: ['invitation', token],
    enabled: token.length > 0,
    retry: false,
    queryFn: () =>
      http.anonymous.get<PublicInvitationResponse>(
        `/invitations/accept/${encodeURIComponent(token)}`,
      ),
  });

  if (!token) {
    return (
      <AuthLayout title="Invitation link incomplete">
        <Alert tone="error">
          This link is missing its token. Ask whoever invited you to send it again.
        </Alert>
      </AuthLayout>
    );
  }

  if (invitation.isLoading) {
    return (
      <AuthLayout title="Checking your invitation">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> One moment…
        </div>
      </AuthLayout>
    );
  }

  if (invitation.isError) {
    const err = invitation.error;
    const message = err instanceof ApiError ? err.message : 'This invitation could not be loaded.';
    return (
      <AuthLayout title="Invitation unavailable">
        <Alert tone="error">{message}</Alert>
        <p className="mt-6 text-center text-sm text-slate-600">
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Go to sign in
          </Link>
        </p>
      </AuthLayout>
    );
  }

  const data = invitation.data!;
  const needsSignIn = !data.requiresAccount && status !== 'authenticated';

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body = data.requiresAccount ? { name, password } : {};
      const path = `/invitations/accept/${encodeURIComponent(token)}`;
      // An existing account must accept while authenticated, so the server can
      // check the invitation was issued to that user.
      const result =
        status === 'authenticated'
          ? await http.post<AcceptResponse>(path, body)
          : await http.anonymous.post<AcceptResponse>(path, body);
      if (result.accessToken) {
        await adoptSession(result.accessToken, result.organizationId);
      } else {
        await reload();
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err
          : new ApiError(0, 'INTERNAL_ERROR', 'Could not accept the invitation'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title={`Join ${data.organizationName}`}
      subtitle={`${data.invitedByName} invited ${data.email} as ${data.role}.`}
    >
      {needsSignIn ? (
        <div className="space-y-4">
          <Alert tone="info">
            An account already exists for {data.email}. Sign in with it, then open this link again
            to join {data.organizationName}.
          </Alert>
          <Button className="w-full" onClick={() => navigate('/login', { state: { from: `/accept-invite?token=${token}` } })}>
            Sign in to continue
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error.message}</Alert>}

          {data.requiresAccount ? (
            <>
              <Input
                label="Your name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={error?.fieldError('name')}
              />
              <Input
                label="Choose a password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={error?.fieldError('password')}
                hint="At least 10 characters."
              />
            </>
          ) : (
            <Alert tone="info">
              You are signed in as {data.email}. Accepting adds {data.organizationName} to your
              account.
            </Alert>
          )}

          <Button type="submit" className="w-full" loading={submitting}>
            {data.requiresAccount ? 'Create account and join' : 'Accept invitation'}
          </Button>

          <p className="text-xs text-slate-500">
            Invitation expires {new Date(data.expiresAt).toLocaleString()}.
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
