import type { ApiErrorBody, ErrorCode } from '@outreach/shared';

const BASE = '/api/v1';

/**
 * The access token lives in memory only. It is never written to localStorage or
 * sessionStorage: anything readable by page JavaScript is readable by an XSS
 * payload. Session continuity across reloads comes from the httpOnly refresh
 * cookie instead.
 */
let accessToken: string | null = null;
let activeOrganizationId: string | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setActiveOrganization(organizationId: string | null): void {
  activeOrganizationId = organizationId;
}

/** Called when a refresh attempt fails, so the UI can return to the login screen. */
export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK_ERROR';
  readonly details: Record<string, string>;
  readonly requestId?: string;

  constructor(
    status: number,
    code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    details: Record<string, string> = {},
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Field-level message for a form input, if the server supplied one. */
  fieldError(field: string): string | undefined {
    return this.details[field];
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skips the access token and the refresh-retry: used by auth endpoints. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | undefined;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    // An error response without a JSON body (proxy error, 502 page, …).
  }
  return new ApiError(
    res.status,
    body?.error.code ?? 'INTERNAL_ERROR',
    body?.error.message ?? `Request failed with status ${res.status}`,
    body?.error.details ?? {},
    body?.error.requestId,
  );
}

async function send<T>(path: string, options: RequestOptions): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!options.anonymous && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (!options.anonymous && activeOrganizationId) headers['X-Org-Id'] = activeOrganizationId;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.');
  }

  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Rotates the session. Concurrent callers share one in-flight request —
 * otherwise several parallel 401s would each rotate the token and the losers
 * would be treated as token reuse, revoking the whole family.
 */
export async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const result = await send<{ accessToken: string; activeOrganizationId: string }>(
        '/auth/refresh',
        { method: 'POST', body: {}, anonymous: true },
      );
      accessToken = result.accessToken;
      return true;
    } catch {
      accessToken = null;
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Issues a request, transparently refreshing once on a 401. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await send<T>(path, options);
  } catch (err) {
    const unauthenticated = err instanceof ApiError && err.status === 401;
    if (!unauthenticated || options.anonymous) throw err;

    const refreshed = await refreshSession();
    if (!refreshed) {
      onSessionLost?.();
      throw err;
    }
    return send<T>(path, options);
  }
}

export const http = {
  get: <T>(path: string, signal?: AbortSignal) => api<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => api<T>(path, { method: 'DELETE' }),
  anonymous: {
    get: <T>(path: string) => api<T>(path, { method: 'GET', anonymous: true }),
    post: <T>(path: string, body?: unknown) =>
      api<T>(path, { method: 'POST', body: body ?? {}, anonymous: true }),
  },
};
