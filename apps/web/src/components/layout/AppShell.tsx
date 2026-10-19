import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Button, cx } from '../ui';

interface NavItem {
  to: string;
  label: string;
  /** Phase that delivers the screen; shown as a hint while it is a placeholder. */
  phase?: number;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [{ to: '/', label: 'Dashboard' }],
  },
  {
    title: 'Audience',
    items: [
      { to: '/audience', label: 'Target audience', phase: 2 },
      { to: '/discovery', label: 'Lead discovery', phase: 2 },
      { to: '/leads', label: 'Lead database', phase: 2 },
    ],
  },
  {
    title: 'Outreach',
    items: [
      { to: '/messages', label: 'AI message generator', phase: 3 },
      { to: '/integrations/email', label: 'Email accounts', phase: 4 },
      { to: '/campaigns/email', label: 'Email campaigns', phase: 4 },
      { to: '/linkedin', label: 'LinkedIn workspace', phase: 5 },
      { to: '/campaigns', label: 'All campaigns', phase: 6 },
      { to: '/inbox', label: 'Inbox & replies', phase: 4 },
    ],
  },
  {
    title: 'Insight',
    items: [{ to: '/analytics', label: 'Analytics', phase: 7 }],
  },
  {
    title: 'Settings',
    items: [
      { to: '/settings/organization', label: 'Organization' },
      { to: '/settings/team', label: 'Team members' },
      { to: '/settings/audit-log', label: 'Audit log' },
      { to: '/settings/profile', label: 'Your profile' },
    ],
  },
];

function OrgSwitcher() {
  const { memberships, organizationId, switchOrganization } = useAuth();
  if (memberships.length <= 1) {
    const only = memberships[0];
    return (
      <div className="truncate px-3 py-2 text-sm font-semibold text-white">
        {only?.organizationName ?? 'OutreachOS'}
      </div>
    );
  }
  return (
    <label className="block px-3 py-2">
      <span className="sr-only">Active organization</span>
      <select
        value={organizationId ?? ''}
        onChange={(e) => switchOrganization(e.target.value)}
        className="w-full rounded-lg border-0 bg-slate-800 px-2 py-1.5 text-sm font-medium text-white ring-1 ring-inset ring-slate-700"
      >
        {memberships.map((m) => (
          <option key={m.organizationId} value={m.organizationId}>
            {m.organizationName}
          </option>
        ))}
      </select>
    </label>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-4 overflow-y-auto bg-slate-900 pb-6">
      <div className="px-3 pt-4">
        <div className="flex items-center gap-2 px-3 pb-3 text-white">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-500 text-xs font-bold">
            OS
          </span>
          <span className="text-sm font-semibold tracking-tight">OutreachOS</span>
        </div>
        <div className="rounded-lg bg-slate-800/60">
          <OrgSwitcher />
        </div>
      </div>

      {NAV_GROUPS.map((group) => (
        <div key={group.title} className="px-3">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {group.title}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cx(
                      'flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-slate-800 font-medium text-white'
                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
                    )
                  }
                >
                  <span className="truncate">{item.label}</span>
                  {item.phase && (
                    <span className="shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                      P{item.phase}
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user, role, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
      <button
        type="button"
        onClick={onOpenMenu}
        className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
        aria-label="Open navigation"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium text-slate-900">{user?.name}</p>
          <p className="text-xs text-slate-500">
            {user?.email}
            {role && ` · ${role}`}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
        >
          Sign out
        </Button>
      </div>
    </header>
  );
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-full">
      <div className="hidden w-64 shrink-0 lg:block">
        <Sidebar />
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMenuOpen(false)} />
          <div className="relative h-full w-64">
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setMenuOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
