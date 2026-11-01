import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';
import type { Permission } from '@spaceflow/shared';
import { useAuth } from '@/hooks/useAuth';
import { useAppDispatch } from '@/store';
import { refreshSession } from '@/services/api';
import { bootstrapFinished } from '@/store/authSlice';

/** Runs the silent refresh once at startup so a reload keeps the session. */
export function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const { bootstrapping } = useAuth();
  useEffect(() => {
    let cancelled = false;
    void refreshSession(dispatch).finally(() => !cancelled && dispatch(bootstrapFinished()));
    return () => {
      cancelled = true;
    };
  }, [dispatch]);
  if (bootstrapping) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }} role="status" aria-live="polite">
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Loading SpaceFlow…
          </Typography>
        </Box>
      </Box>
    );
  }
  return <>{children}</>;
}

export function RequireAuth() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  return <Outlet />;
}

export function RequirePermission({ anyOf }: { anyOf: Permission[] }) {
  const { can } = useAuth();
  if (!anyOf.some(can)) return <Navigate to="/forbidden" replace />;
  return <Outlet />;
}

export function RedirectIfAuthenticated() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <Outlet />;
}
