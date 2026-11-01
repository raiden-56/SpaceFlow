// Landing page after the OIDC callback. The API redirects here with a one-time, 60-second token
// in the URL fragment (never sent to the server); we exchange it for a session via /auth/me and
// then rely on the HttpOnly refresh cookie that the callback already set.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import { useAppDispatch } from '@/store';
import { sessionStarted } from '@/store/authSlice';
import { API_BASE, refreshSession } from '@/services/api';
import type { CurrentUserDto } from '@spaceflow/shared';

export function SsoCompletePage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = hash.get('token');
    const returnTo = hash.get('returnTo') ?? '/';
    window.history.replaceState(null, '', window.location.pathname);
    (async () => {
      if (!token) return setError('Missing SSO token.');
      const res = await fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return setError('Could not complete sign-in.');
      const user = (await res.json()) as CurrentUserDto;
      dispatch(sessionStarted({ accessToken: token, user }));
      await refreshSession(dispatch); // swap the short handoff token for a full access token
      navigate(returnTo.startsWith('/') ? returnTo : '/', { replace: true });
    })();
  }, [dispatch, navigate]);
  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      {error ? (
        <Alert severity="error">{error}</Alert>
      ) : (
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress />
          <Typography sx={{ mt: 2 }}>Completing sign-in…</Typography>
        </Box>
      )}
    </Box>
  );
}
