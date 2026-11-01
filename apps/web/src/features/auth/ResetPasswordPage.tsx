import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Box, Button, Link, Stack, TextField, Typography } from '@mui/material';
import { passwordSchema } from '@spaceflow/shared';
import { useResetPasswordMutation } from '@/services/endpoints';
import { errorMessage } from '@/services/api';

const schema = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [reset, { isLoading, isSuccess, error }] = useResetPasswordMutation();
  const { register, handleSubmit, formState: { errors } } = useForm<{ password: string; confirm: string }>({ resolver: zodResolver(schema) });
  return (
    <Box component="form" onSubmit={handleSubmit(async (v) => { await reset({ token, password: v.password }).unwrap().catch(() => undefined); })} noValidate>
      <Typography variant="h2" component="h1" gutterBottom>
        Choose a new password
      </Typography>
      {!token && <Alert severity="error">This reset link is missing its token. Request a new one.</Alert>}
      {isSuccess ? (
        <Stack spacing={2}>
          <Alert severity="success">Your password has been updated. You can sign in now.</Alert>
          <Button variant="contained" onClick={() => navigate('/login')}>
            Go to sign in
          </Button>
        </Stack>
      ) : (
        <Stack spacing={2} sx={{ mt: 2 }}>
          {error && <Alert severity="error">{errorMessage(error)}</Alert>}
          <TextField label="New password" type="password" autoComplete="new-password" {...register('password')} error={!!errors.password} helperText={errors.password?.message ?? 'At least 8 characters with a letter and a number'} />
          <TextField label="Confirm password" type="password" autoComplete="new-password" {...register('confirm')} error={!!errors.confirm} helperText={errors.confirm?.message} />
          <Button type="submit" variant="contained" size="large" disabled={isLoading || !token}>
            Update password
          </Button>
        </Stack>
      )}
      <Typography variant="body2" sx={{ mt: 3 }}>
        <Link component={RouterLink} to="/login" underline="hover">
          Back to sign in
        </Link>
      </Typography>
    </Box>
  );
}
