import { useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, Divider, IconButton, InputAdornment, Link, Stack, TextField, Typography } from '@mui/material';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import { loginSchema, type LoginInput } from '@spaceflow/shared';
import { useGuestLoginMutation, useGuestStatusQuery, useLoginMutation, useSsoStatusQuery } from '@/services/endpoints';
import { errorMessage, API_BASE } from '@/services/api';
import { DEMO_MODE } from '@/demo';

export function LoginPage() {
  const [login, { isLoading, error }] = useLoginMutation();
  const { data: sso } = useSsoStatusQuery();
  const { data: guest } = useGuestStatusQuery();
  const [guestLogin, { isLoading: guestLoading, error: guestError }] = useGuestLoginMutation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [showPw, setShowPw] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const { register, handleSubmit, formState: { errors } } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values).unwrap();
      navigate(from, { replace: true });
    } catch {
      /* error shown below */
    }
  });

  return (
    <Box component="form" onSubmit={onSubmit} noValidate aria-labelledby="login-title">
      <Typography id="login-title" variant="h2" component="h1" gutterBottom>
        Welcome back
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Sign in to book your workspace.
      </Typography>
      {params.get('error') === 'sso_no_account' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Your SSO identity is not linked to a SpaceFlow account. Ask an administrator to invite you.
        </Alert>
      )}
      {DEMO_MODE && (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="demo-notice">
          This is a live demo without a backend. Choose <strong>Continue as guest</strong> to explore SpaceFlow with sample buildings, desks, rooms and bookings.
        </Alert>
      )}
      {(error || guestError) && (
        <Alert severity="error" sx={{ mb: 2 }} role="alert">
          {errorMessage(error ?? guestError)}
        </Alert>
      )}
      <Stack spacing={2}>
        <TextField label="Work email" type="email" autoComplete="email" autoFocus {...register('email')} error={!!errors.email} helperText={errors.email?.message} slotProps={{ htmlInput: { 'data-testid': 'login-email' } }} />
        <TextField label="Password" type={showPw ? 'text' : 'password'} autoComplete="current-password" {...register('password')} error={!!errors.password} helperText={errors.password?.message} slotProps={{ htmlInput: { 'data-testid': 'login-password' }, input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw((s) => !s)} edge="end" size="small">
                  {showPw ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          } }} />
        <Box sx={{ textAlign: 'right' }}>
          <Link component={RouterLink} to="/forgot-password" variant="body2" underline="hover">
            Forgot password?
          </Link>
        </Box>
        <Button type="submit" variant="contained" size="large" disabled={isLoading} data-testid="login-submit">
          {isLoading ? 'Signing in…' : 'Sign in'}
        </Button>
        {sso?.enabled && (
          <>
            <Divider>
              <Typography variant="caption" color="text.secondary">
                or
              </Typography>
            </Divider>
            <Button variant="outlined" size="large" href={`${API_BASE}/auth/sso/login?returnTo=${encodeURIComponent(from)}`}>
              Continue with company SSO
            </Button>
          </>
        )}
        {guest?.enabled && (
          <>
            <Divider>
              <Typography variant="caption" color="text.secondary">
                or
              </Typography>
            </Divider>
            <Button
              variant="outlined"
              size="large"
              disabled={guestLoading}
              data-testid="guest-login"
              onClick={async () => {
                try {
                  await guestLogin().unwrap();
                  navigate('/', { replace: true });
                } catch {
                  /* shown above */
                }
              }}
            >
              {guestLoading ? 'Preparing your sandbox…' : 'Continue as guest'}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              Guest mode gives you a private workspace with sample data. Every feature works; the sandbox is deleted after {guest.sandboxTtlHours} hours.
            </Typography>
          </>
        )}
      </Stack>
      {import.meta.env.DEV && !DEMO_MODE && (
        <Alert severity="info" role="note" sx={{ mt: 3 }} icon={false}>
          <Typography variant="caption" component="div">
            <strong>Demo accounts</strong> (seeded): employee@spaceflow.local / Password123! · admin@spaceflow.local / Admin123!
          </Typography>
        </Alert>
      )}
    </Box>
  );
}
