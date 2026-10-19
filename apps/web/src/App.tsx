import { Link, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth, RequireRole } from './auth/RequireAuth';
import { queryClient } from './lib/queryClient';
import { AppShell } from './components/layout/AppShell';
import { ToastProvider } from './components/ui';
import { LoginPage } from './pages/auth/Login';
import { RegisterPage } from './pages/auth/Register';
import { AcceptInvitePage } from './pages/auth/AcceptInvite';
import { DashboardPage } from './pages/Dashboard';
import { TeamPage } from './pages/settings/Team';
import { OrganizationSettingsPage } from './pages/settings/Organization';
import { ProfilePage } from './pages/settings/Profile';
import { AuditLogPage } from './pages/settings/AuditLog';
import { PhasePage } from './pages/placeholders/PhasePage';
import { PLACEHOLDER_PAGES } from './pages/placeholders/definitions';

function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-sm font-semibold text-brand-700">404</p>
      <h1 className="mt-2 text-xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-2 text-sm text-slate-500">
        That route does not exist. It may belong to a phase that has not shipped yet.
      </p>
      <Link to="/" className="mt-6 inline-block text-sm font-medium text-brand-700 hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/accept-invite" element={<AcceptInvitePage />} />

            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route index element={<DashboardPage />} />

                <Route path="audience" element={<PhasePage {...PLACEHOLDER_PAGES.audience!} />} />
                <Route path="discovery" element={<PhasePage {...PLACEHOLDER_PAGES.discovery!} />} />
                <Route path="leads" element={<PhasePage {...PLACEHOLDER_PAGES.leads!} />} />
                <Route path="messages" element={<PhasePage {...PLACEHOLDER_PAGES.messages!} />} />
                <Route
                  path="integrations/email"
                  element={<PhasePage {...PLACEHOLDER_PAGES.emailAccounts!} />}
                />
                <Route
                  path="campaigns/email"
                  element={<PhasePage {...PLACEHOLDER_PAGES.emailCampaigns!} />}
                />
                <Route path="linkedin" element={<PhasePage {...PLACEHOLDER_PAGES.linkedin!} />} />
                <Route path="campaigns" element={<PhasePage {...PLACEHOLDER_PAGES.campaigns!} />} />
                <Route path="inbox" element={<PhasePage {...PLACEHOLDER_PAGES.inbox!} />} />
                <Route path="analytics" element={<PhasePage {...PLACEHOLDER_PAGES.analytics!} />} />

                <Route path="settings/profile" element={<ProfilePage />} />
                <Route path="settings/organization" element={<OrganizationSettingsPage />} />
                <Route path="settings/team" element={<TeamPage />} />

                {/* Audit log is admin-only on the server; the gate here avoids a 403 screen. */}
                <Route element={<RequireRole minimum="ADMIN" />}>
                  <Route path="settings/audit-log" element={<AuditLogPage />} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
