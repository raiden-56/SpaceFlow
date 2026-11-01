// Test helper: renders a component inside the real providers (store, theme, router, toasts).
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { configureStore } from '@reduxjs/toolkit';
import type { CurrentUserDto } from '@spaceflow/shared';
import { api } from '@/services/api';
import { authReducer, sessionStarted } from '@/store/authSlice';
import { bookingReducer } from '@/store/bookingSlice';
import { theme } from '@/theme/theme';
import { ToastProvider } from '@/components/common/ToastProvider';

export const testUser: CurrentUserDto = {
  id: 'u1',
  email: 'sam@example.com',
  firstName: 'Sam',
  lastName: 'Taylor',
  displayName: 'Sam Taylor',
  avatarUrl: null,
  jobTitle: 'Engineer',
  departmentId: null,
  departmentName: null,
  teamId: null,
  teamName: null,
  orgId: 'o1',
  orgName: 'Test Org',
  roles: ['EMPLOYEE'],
  permissions: ['workplace:read', 'reservation:create', 'reservation:manage-own', 'user:read'],
  status: 'ACTIVE',
  homeBuildingId: null,
  homeBuildingName: null,
  phone: null,
  preferences: { defaultBuildingId: null, defaultFloorId: null, shareLocationWithTeam: true, emailNotifications: true, preferredView: '3D', reducedMotion: false },
  lastLoginAt: null,
  isGuest: false,
  guestExpiresAt: null,
};

export function makeStore() {
  const store = configureStore({ reducer: { auth: authReducer, booking: bookingReducer, [api.reducerPath]: api.reducer }, middleware: (g) => g().concat(api.middleware) });
  store.dispatch(sessionStarted({ accessToken: 'test-token', user: testUser }));
  return store;
}

export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const store = makeStore();
  return {
    store,
    ...render(
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <ToastProvider>
              <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
            </ToastProvider>
          </LocalizationProvider>
        </ThemeProvider>
      </Provider>,
    ),
  };
}

/** Minimal fetch mock: maps URL substrings to JSON responses. */
export function mockFetch(routes: Record<string, unknown>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const key = Object.keys(routes).find((k) => url.includes(k));
    const body = key ? routes[key] : { error: { code: 'NOT_FOUND', message: `no mock for ${url}` } };
    return new Response(JSON.stringify(body), { status: key ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
