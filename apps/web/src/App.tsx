import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Box, LinearProgress } from '@mui/material';
import { EmployeeLayout } from './layouts/EmployeeLayout';
import { AdminLayout } from './layouts/AdminLayout';
import { AuthLayout } from './layouts/AuthLayout';
import { RedirectIfAuthenticated, RequireAuth, RequirePermission, SessionBootstrap } from './components/common/RequireAuth';
import { LoginPage } from './features/auth/LoginPage';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { AcceptInvitePage } from './features/auth/AcceptInvitePage';
import { SsoCompletePage } from './features/auth/SsoCompletePage';
import { ForbiddenPage, NotFoundPage } from './components/common/Placeholder';
import { useAuth } from './hooks/useAuth';

// Route modules are code-split. Each loader is kept so it can be preloaded after sign-in, which
// makes menu navigation instant (no loading flash) while the first paint stays small.
type Loader = () => Promise<{ default: ComponentType }>;
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K): Loader => () => load().then((m) => ({ default: m[name] }));

const employeeLoaders = {
  dashboard: page(() => import('./features/dashboard/DashboardPage'), 'DashboardPage'),
  explore: page(() => import('./features/map3d/ExplorePage'), 'ExplorePage'),
  bookSeat: page(() => import('./features/seats/BookSeatPage'), 'BookSeatPage'),
  rooms: page(() => import('./features/meeting-rooms/MeetingRoomsPage'), 'MeetingRoomsPage'),
  myBookings: page(() => import('./features/bookings/MyBookingsPage'), 'MyBookingsPage'),
  bookingDetail: page(() => import('./features/bookings/BookingDetailPage'), 'BookingDetailPage'),
  checkIn: page(() => import('./features/bookings/CheckInPage'), 'CheckInPage'),
  directory: page(() => import('./features/directory/DirectoryPage'), 'DirectoryPage'),
  notifications: page(() => import('./features/notifications/NotificationsPage'), 'NotificationsPage'),
  settings: page(() => import('./features/settings/SettingsPage'), 'SettingsPage'),
  approvals: page(() => import('./features/bookings/ApprovalsPage'), 'ApprovalsPage'),
};
const adminLoaders = {
  overview: page(() => import('./features/admin/AdminOverviewPage'), 'AdminOverviewPage'),
  buildings: page(() => import('./features/admin/AdminBuildingsPage'), 'AdminBuildingsPage'),
  mapStudio: page(() => import('./features/admin/MapStudioPage'), 'MapStudioPage'),
  seats: page(() => import('./features/admin/AdminSeatsPage'), 'AdminSeatsPage'),
  rooms: page(() => import('./features/admin/AdminRoomsPage'), 'AdminRoomsPage'),
  employees: page(() => import('./features/admin/AdminEmployeesPage'), 'AdminEmployeesPage'),
  reservations: page(() => import('./features/admin/AdminReservationsPage'), 'AdminReservationsPage'),
  policies: page(() => import('./features/admin/AdminPoliciesPage'), 'AdminPoliciesPage'),
  analytics: page(() => import('./features/admin/AdminAnalyticsPage'), 'AdminAnalyticsPage'),
  notifications: page(() => import('./features/admin/AdminNotificationsPage'), 'AdminNotificationsPage'),
  audit: page(() => import('./features/admin/AdminAuditPage'), 'AdminAuditPage'),
  integrations: page(() => import('./features/admin/AdminIntegrationsPage'), 'AdminIntegrationsPage'),
  settings: page(() => import('./features/admin/AdminSettingsPage'), 'AdminSettingsPage'),
};

const DashboardPage = lazy(employeeLoaders.dashboard);
const ExplorePage = lazy(employeeLoaders.explore);
const BookSeatPage = lazy(employeeLoaders.bookSeat);
const MeetingRoomsPage = lazy(employeeLoaders.rooms);
const MyBookingsPage = lazy(employeeLoaders.myBookings);
const BookingDetailPage = lazy(employeeLoaders.bookingDetail);
const CheckInPage = lazy(employeeLoaders.checkIn);
const DirectoryPage = lazy(employeeLoaders.directory);
const NotificationsPage = lazy(employeeLoaders.notifications);
const SettingsPage = lazy(employeeLoaders.settings);
const ApprovalsPage = lazy(employeeLoaders.approvals);

const AdminOverviewPage = lazy(adminLoaders.overview);
const AdminBuildingsPage = lazy(adminLoaders.buildings);
const MapStudioPage = lazy(adminLoaders.mapStudio);
const AdminSeatsPage = lazy(adminLoaders.seats);
const AdminRoomsPage = lazy(adminLoaders.rooms);
const AdminEmployeesPage = lazy(adminLoaders.employees);
const AdminReservationsPage = lazy(adminLoaders.reservations);
const AdminPoliciesPage = lazy(adminLoaders.policies);
const AdminAnalyticsPage = lazy(adminLoaders.analytics);
const AdminNotificationsPage = lazy(adminLoaders.notifications);
const AdminAuditPage = lazy(adminLoaders.audit);
const AdminIntegrationsPage = lazy(adminLoaders.integrations);
const AdminSettingsPage = lazy(adminLoaders.settings);

/** Loading indicator shown inside the content area only (layouts stay mounted). */
export function PageFallback() {
  return (
    <Box sx={{ py: 2 }} role="status" aria-label="Loading page">
      <LinearProgress />
    </Box>
  );
}

/** After sign-in, fetch every page chunk the user can open while the browser is idle. */
function usePreloadPages() {
  const { isAuthenticated, isAdmin } = useAuth();
  useEffect(() => {
    if (!isAuthenticated) return;
    const loaders: Loader[] = [...Object.values(employeeLoaders), ...(isAdmin ? Object.values(adminLoaders) : [])];
    const idle = (cb: () => void) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 800));
    let cancelled = false;
    idle(() => {
      // Sequential so preloading never competes with the page the user is looking at.
      void loaders.reduce((p, load) => p.then(() => (cancelled ? undefined : load().then(() => undefined, () => undefined))), Promise.resolve());
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isAdmin]);
}

export function App() {
  usePreloadPages();
  return (
    <SessionBootstrap>
      <a href="#main" className="skip-link" style={{ position: 'absolute', left: -9999, top: 8, zIndex: 2000, background: '#fff', padding: 8, borderRadius: 8 }} onFocus={(e) => (e.currentTarget.style.left = '8px')} onBlur={(e) => (e.currentTarget.style.left = '-9999px')}>
        Skip to main content
      </a>
      {/* No key on <Routes>: layouts (sidebar, header, realtime connection) stay mounted while only
          the routed content changes. Suspense boundaries live inside the layouts' content area. */}
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<RedirectIfAuthenticated />}>
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/accept-invite" element={<AcceptInvitePage />} />
            </Route>
          </Route>
          <Route path="/sso/complete" element={<SsoCompletePage />} />

          <Route element={<RequireAuth />}>
            <Route element={<EmployeeLayout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/explore" element={<ExplorePage />} />
              <Route path="/book-seat" element={<BookSeatPage />} />
              <Route path="/meeting-rooms" element={<MeetingRoomsPage />} />
              <Route path="/bookings" element={<MyBookingsPage />} />
              <Route path="/bookings/:id" element={<BookingDetailPage />} />
              <Route path="/check-in" element={<CheckInPage />} />
              <Route path="/directory" element={<DirectoryPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route element={<RequirePermission anyOf={['reservation:approve']} />}>
                <Route path="/approvals" element={<ApprovalsPage />} />
              </Route>
              <Route path="/forbidden" element={<ForbiddenPage />} />
            </Route>

            <Route element={<RequirePermission anyOf={['analytics:read', 'resource:manage', 'user:manage', 'building:manage', 'policy:manage']} />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminOverviewPage />} />
                <Route element={<RequirePermission anyOf={['building:manage']} />}>
                  <Route path="buildings" element={<AdminBuildingsPage />} />
                  <Route path="buildings/:buildingId" element={<AdminBuildingsPage />} />
                  <Route path="notifications" element={<AdminNotificationsPage />} />
                </Route>
                <Route element={<RequirePermission anyOf={['floorplan:manage']} />}>
                  <Route path="map-studio" element={<MapStudioPage />} />
                  <Route path="map-studio/:floorId" element={<MapStudioPage />} />
                </Route>
                <Route element={<RequirePermission anyOf={['resource:manage']} />}>
                  <Route path="seats" element={<AdminSeatsPage />} />
                  <Route path="meeting-rooms" element={<AdminRoomsPage />} />
                </Route>
                <Route element={<RequirePermission anyOf={['user:manage']} />}>
                  <Route path="employees" element={<AdminEmployeesPage />} />
                </Route>
                <Route element={<RequirePermission anyOf={['reservation:manage-any']} />}>
                  <Route path="reservations" element={<AdminReservationsPage />} />
                </Route>
                <Route element={<RequirePermission anyOf={['policy:manage']} />}>
                  <Route path="policies" element={<AdminPoliciesPage />} />
                </Route>
                <Route element={<RequirePermission anyOf={['analytics:read']} />}>
                  <Route path="analytics" element={<AdminAnalyticsPage />} />
                </Route>
                <Route element={<RequirePermission anyOf={['audit:read']} />}>
                  <Route path="audit" element={<AdminAuditPage />} />
                </Route>
                <Route element={<RequirePermission anyOf={['integration:manage']} />}>
                  <Route path="integrations" element={<AdminIntegrationsPage />} />
                </Route>
                <Route element={<RequirePermission anyOf={['settings:manage']} />}>
                  <Route path="settings" element={<AdminSettingsPage />} />
                </Route>
                <Route path="*" element={<Navigate to="/admin" replace />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </SessionBootstrap>
  );
}
