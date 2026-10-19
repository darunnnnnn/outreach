import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  AuthResponse,
  LoginInput,
  MeResponse,
  MembershipSummary,
  RegisterInput,
  Role,
  SessionUser,
} from '@outreach/shared';
import {
  http,
  refreshSession,
  setAccessToken,
  setActiveOrganization,
  setSessionLostHandler,
} from '../lib/api';
import { queryClient } from '../lib/queryClient';

interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: SessionUser | null;
  memberships: MembershipSummary[];
  organizationId: string | null;
  role: Role | null;
}

interface AuthContextValue extends AuthState {
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: string) => void;
  /** Adopts a session handed over by invitation acceptance. */
  adoptSession: (accessToken: string, organizationId: string) => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ACTIVE_ORG_KEY = 'outreach.activeOrganizationId';

const ANONYMOUS: AuthState = {
  status: 'anonymous',
  user: null,
  memberships: [],
  organizationId: null,
  role: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...ANONYMOUS, status: 'loading' });

  const applySession = useCallback((payload: MeResponse, preferredOrgId?: string | null) => {
    const stored = preferredOrgId ?? window.localStorage.getItem(ACTIVE_ORG_KEY);
    const chosen =
      payload.memberships.find((m) => m.organizationId === stored) ?? payload.memberships[0] ?? null;

    setActiveOrganization(chosen?.organizationId ?? null);
    if (chosen) window.localStorage.setItem(ACTIVE_ORG_KEY, chosen.organizationId);

    setState({
      status: 'authenticated',
      user: payload.user,
      memberships: payload.memberships,
      organizationId: chosen?.organizationId ?? null,
      role: chosen?.role ?? null,
    });
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setActiveOrganization(null);
    window.localStorage.removeItem(ACTIVE_ORG_KEY);
    queryClient.clear();
    setState(ANONYMOUS);
  }, []);

  const reload = useCallback(async () => {
    const me = await http.get<MeResponse>('/auth/me');
    applySession(me);
  }, [applySession]);

  // On a cold load the access token is gone (it only ever lived in memory), so
  // the httpOnly refresh cookie is what restores the session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const refreshed = await refreshSession();
      if (cancelled) return;
      if (!refreshed) {
        setState(ANONYMOUS);
        return;
      }
      try {
        await reload();
      } catch {
        if (!cancelled) clearSession();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, clearSession]);

  useEffect(() => {
    setSessionLostHandler(clearSession);
    return () => setSessionLostHandler(null);
  }, [clearSession]);

  const adoptAuthResponse = useCallback(
    (payload: AuthResponse) => {
      setAccessToken(payload.accessToken);
      applySession(
        {
          user: payload.user,
          memberships: payload.memberships,
          activeOrganizationId: payload.activeOrganizationId,
        },
        payload.activeOrganizationId,
      );
    },
    [applySession],
  );

  const login = useCallback(
    async (input: LoginInput) => {
      adoptAuthResponse(await http.anonymous.post<AuthResponse>('/auth/login', input));
    },
    [adoptAuthResponse],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      adoptAuthResponse(await http.anonymous.post<AuthResponse>('/auth/register', input));
    },
    [adoptAuthResponse],
  );

  const adoptSession = useCallback(
    async (accessToken: string, organizationId: string) => {
      setAccessToken(accessToken);
      setActiveOrganization(organizationId);
      const me = await http.get<MeResponse>('/auth/me');
      applySession(me, organizationId);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await http.post('/auth/logout');
    } finally {
      // Local state is cleared even if the call fails: the user asked to leave.
      clearSession();
    }
  }, [clearSession]);

  const switchOrganization = useCallback(
    (organizationId: string) => {
      const membership = state.memberships.find((m) => m.organizationId === organizationId);
      if (!membership) return;
      setActiveOrganization(organizationId);
      window.localStorage.setItem(ACTIVE_ORG_KEY, organizationId);
      queryClient.clear();
      setState((current) => ({ ...current, organizationId, role: membership.role }));
    },
    [state.memberships],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, register, logout, switchOrganization, adoptSession, reload }),
    [state, login, register, logout, switchOrganization, adoptSession, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

const RANK: Record<Role, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

/** Mirrors the server's `requireRole`, for hiding controls the API would refuse. */
export function useHasRole(minimum: Role): boolean {
  const { role } = useAuth();
  return role !== null && RANK[role] >= RANK[minimum];
}
