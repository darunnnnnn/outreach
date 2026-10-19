import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { PASSWORD_MIN_LENGTH } from '@outreach/shared';
import { ApiError, http } from '../../lib/api';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/layout/AppShell';
import { Alert, Button, Card, Input, useToast } from '../../components/ui';

export function ProfilePage() {
  const { user, reload, logout } = useAuth();
  const toast = useToast();

  const [name, setName] = useState(user?.name ?? '');
  const [profileError, setProfileError] = useState<ApiError | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  const saveProfile = useMutation({
    mutationFn: () => http.patch('/auth/me', { name }),
    onSuccess: async () => {
      setProfileError(null);
      toast.push('Profile updated');
      await reload();
    },
    onError: (err) => setProfileError(err instanceof ApiError ? err : null),
  });

  const changePassword = useMutation({
    mutationFn: () =>
      http.post<{ sessionsRevoked: number }>('/auth/change-password', {
        currentPassword,
        newPassword,
      }),
    onSuccess: (result) => {
      setPasswordError(null);
      setCurrentPassword('');
      setNewPassword('');
      toast.push(
        result.sessionsRevoked > 0
          ? `Password changed. ${result.sessionsRevoked} other session(s) signed out.`
          : 'Password changed.',
      );
    },
    onError: (err) => setPasswordError(err instanceof ApiError ? err : null),
  });

  const signOutEverywhere = useMutation({
    mutationFn: () => http.post<{ sessionsRevoked: number }>('/auth/logout-all'),
    onSuccess: async () => {
      // Every session is gone, including this one, so return to the login screen.
      await logout();
    },
  });

  return (
    <>
      <PageHeader title="Your profile" description="Account details and sign-in security." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Details">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveProfile.mutate();
            }}
            noValidate
          >
            {profileError && <Alert tone="error">{profileError.message}</Alert>}

            <Input
              label="Name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={profileError?.fieldError('name')}
            />
            <Input
              label="Email"
              value={user?.email ?? ''}
              disabled
              hint="Changing your email address is not supported yet."
            />

            <Button
              type="submit"
              loading={saveProfile.isPending}
              disabled={name === user?.name || name.trim().length === 0}
            >
              Save
            </Button>
          </form>
        </Card>

        <Card title="Password">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              changePassword.mutate();
            }}
            noValidate
          >
            {passwordError && <Alert tone="error">{passwordError.message}</Alert>}

            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              error={passwordError?.fieldError('currentPassword')}
            />
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              error={passwordError?.fieldError('newPassword')}
              hint={`At least ${PASSWORD_MIN_LENGTH} characters. Changing it signs out your other devices.`}
            />

            <Button
              type="submit"
              loading={changePassword.isPending}
              disabled={!currentPassword || newPassword.length < PASSWORD_MIN_LENGTH}
            >
              Change password
            </Button>
          </form>
        </Card>

        <Card title="Sessions" className="lg:col-span-2">
          <p className="text-sm text-slate-600">
            Signing out everywhere revokes every refresh token on your account, including this
            browser. Use it if you think a device has been compromised.
          </p>
          <div className="mt-4">
            <Button
              variant="danger"
              loading={signOutEverywhere.isPending}
              onClick={() => signOutEverywhere.mutate()}
            >
              Sign out of all devices
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
