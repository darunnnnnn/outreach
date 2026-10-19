import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '@outreach/shared';
import { useAuth, useHasRole } from './AuthProvider';
import { Alert, Spinner } from '../components/ui';

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (status === 'anonymous') {
    // `from` lets the login screen return the user where they were heading.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <Outlet />;
}

/**
 * Client-side role gate. It is a usability affordance, never the control: the
 * API enforces the same rule, and this only avoids showing a screen that would
 * return 403.
 */
export function RequireRole({ minimum }: { minimum: Role }) {
  const allowed = useHasRole(minimum);
  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <Alert tone="warning" title="Not available for your role">
          This area requires the {minimum} role or higher. Ask an administrator of your
          organization if you need access.
        </Alert>
      </div>
    );
  }
  return <Outlet />;
}
