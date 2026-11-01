import { createApi, fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from '@reduxjs/toolkit/query/react';
import { API_PREFIX, type ApiErrorBody, type AuthResponseDto } from '@spaceflow/shared';
import { sessionEnded, sessionStarted, tokenRefreshed } from '@/store/authSlice';
import type { RootState } from '@/store';
import { DEMO_MODE, apiFetch } from '@/demo';

/**
 * Absolute API base. When VITE_API_URL is empty the app talks to its own origin (Vite proxy in
 * development, nginx in Docker). Resolving against window.location keeps it absolute, which
 * `new Request()` requires outside browsers (jsdom tests).
 */
export const API_BASE = `${import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : '')}${API_PREFIX}`;

/** Minimal async mutex so concurrent 401s share a single refresh call. */
class Mutex {
  private locked = false;
  private waiters: (() => void)[] = [];
  isLocked() {
    return this.locked;
  }
  async acquire(): Promise<() => void> {
    while (this.locked) await new Promise<void>((r) => this.waiters.push(r));
    this.locked = true;
    return () => {
      this.locked = false;
      this.waiters.splice(0).forEach((w) => w());
    };
  }
  async waitForUnlock() {
    while (this.locked) await new Promise<void>((r) => this.waiters.push(r));
  }
}

const mutex = new Mutex();

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_BASE,
  credentials: 'include',
  fetchFn: DEMO_MODE ? apiFetch : undefined,
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as RootState).auth.accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    headers.set('X-Requested-With', 'SpaceFlow');
    return headers;
  },
});

/**
 * In-flight refresh shared by every caller in this tab. Refresh tokens rotate and the server
 * revokes the whole session family when a rotated token is presented again, so two concurrent
 * refreshes with the same cookie (React StrictMode double effects, startup + 401 retry) would
 * log the user out. Sharing one request avoids that.
 */
let inFlightRefresh: Promise<AuthResponseDto | null> | null = null;

/** Try to obtain a new access token using the HttpOnly refresh cookie. */
export function refreshSession(dispatch: (a: unknown) => unknown): Promise<AuthResponseDto | null> {
  if (!inFlightRefresh) {
    inFlightRefresh = (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Requested-With': 'SpaceFlow' },
        });
        if (!res.ok) return null;
        return (await res.json()) as AuthResponseDto;
      } catch {
        return null;
      }
    })().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh.then((data) => {
    if (data) dispatch(sessionStarted({ accessToken: data.accessToken, user: data.user }));
    return data;
  });
}

/**
 * Base query with automatic token refresh: on 401 TOKEN_EXPIRED/UNAUTHENTICATED, refresh once
 * (serialised through a mutex so concurrent requests share one refresh) and retry.
 */
const baseQueryWithReauth: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, extraOptions) => {
  await mutex.waitForUnlock();
  let result = await rawBaseQuery(args, api, extraOptions);
  const isAuthPath = typeof args === 'string' ? args.startsWith('/auth/') : args.url.startsWith('/auth/');
  if (result.error?.status === 401 && !isAuthPath) {
    if (!mutex.isLocked()) {
      const release = await mutex.acquire();
      try {
        const refreshed = await refreshSession(api.dispatch);
        if (refreshed) {
          api.dispatch(tokenRefreshed(refreshed.accessToken));
          result = await rawBaseQuery(args, api, extraOptions);
        } else {
          api.dispatch(sessionEnded());
        }
      } finally {
        release();
      }
    } else {
      await mutex.waitForUnlock();
      result = await rawBaseQuery(args, api, extraOptions);
    }
  }
  return result;
};

export const TAGS = [
  'Me',
  'Buildings',
  'Floors',
  'FloorMap',
  'Resources',
  'Resource',
  'Availability',
  'Reservations',
  'Reservation',
  'Favorites',
  'Notifications',
  'Dashboard',
  'Search',
  'AdminUsers',
  'Departments',
  'Policies',
  'Analytics',
  'Audit',
  'Integrations',
  'Assets',
  'Announcements',
  'Amenities',
  'Zones',
  'FloorPlan',
  'Approvals',
  'Settings',
] as const;

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: [...TAGS],
  endpoints: () => ({}),
});

/** Extract a human-readable message from an RTK Query error. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as { status?: number | string; data?: ApiErrorBody | string; error?: string };
  if (!e) return fallback;
  if (e.status === 'FETCH_ERROR') return 'Cannot reach the server. Check your connection and try again.';
  if (typeof e.data === 'object' && e.data?.error?.message) return e.data.error.message;
  if (typeof e.error === 'string') return e.error;
  return fallback;
}

export function errorCode(err: unknown): string | null {
  const e = err as { data?: ApiErrorBody };
  return typeof e?.data === 'object' ? e.data?.error?.code ?? null : null;
}

export function errorDetails<T = unknown>(err: unknown): T | undefined {
  const e = err as { data?: ApiErrorBody };
  return typeof e?.data === 'object' ? (e.data?.error?.details as T | undefined) : undefined;
}
