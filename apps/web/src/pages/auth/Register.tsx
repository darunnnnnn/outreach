import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { PASSWORD_MIN_LENGTH, registerSchema } from '@outreach/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ApiError } from '../../lib/api';
import { Alert, Button, Input } from '../../components/ui';
import { AuthLayout } from './AuthLayout';

const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function RegisterPage() {
  const { register, status } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    organizationName: '',
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((current) => ({ ...current, [field]: e.target.value }));
      setLocalErrors(({ [field]: _removed, ...rest }) => rest);
    };
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Validated client-side with the same schema the server uses, so the
    // messages match and an obvious mistake costs no round trip.
    const parsed = registerSchema.safeParse({ ...form, timezone: TIMEZONE });
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        fields[key] ??= issue.message;
      }
      setLocalErrors(fields);
      return;
    }

    setSubmitting(true);
    try {
      await register(parsed.data);
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, 'INTERNAL_ERROR', 'Could not sign up'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (field: string) => localErrors[field] ?? error?.fieldError(field);

  return (
    <AuthLayout title="Create your organization" subtitle="You will be its owner.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && (
          <Alert tone="error">
            {error.message}
            {error.requestId && (
              <span className="mt-1 block text-xs opacity-70">Reference: {error.requestId}</span>
            )}
          </Alert>
        )}

        <Input
          label="Your name"
          name="name"
          autoComplete="name"
          required
          value={form.name}
          onChange={update('name')}
          error={fieldError('name')}
        />
        <Input
          label="Organization name"
          name="organization"
          autoComplete="organization"
          required
          value={form.organizationName}
          onChange={update('organizationName')}
          error={fieldError('organizationName')}
        />
        <Input
          label="Work email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={update('email')}
          error={fieldError('email')}
        />
        <Input
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={form.password}
          onChange={update('password')}
          error={fieldError('password')}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. A passphrase beats a short, clever one.`}
        />

        <p className="text-xs text-slate-500">
          Timezone detected as <span className="font-medium text-slate-700">{TIMEZONE}</span>. You
          can change it in organization settings.
        </p>

        <Button type="submit" className="w-full" loading={submitting}>
          Create organization
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
