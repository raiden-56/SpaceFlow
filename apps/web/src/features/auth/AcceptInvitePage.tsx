import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { passwordSchema } from '@spaceflow/shared';
import { useAcceptInviteMutation } from '@/services/endpoints';
import { errorMessage } from '@/services/api';

const schema = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [accept, { isLoading, error }] = useAcceptInviteMutation();
  const { register, handleSubmit, formState: { errors } } = useForm<{ password: string; confirm: string }>({ resolver: zodResolver(schema) });
  return (
    <Box
      component="form"
      noValidate
      onSubmit={handleSubmit(async (v) => {
        try {
          await accept({ token, password: v.password }).unwrap();
          navigate('/', { replace: true });
        } catch {
          /* shown */
        }
      })}
    >
      <Typography variant="h2" component="h1" gutterBottom>
        Welcome to SpaceFlow
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Set a password to activate your account.
      </Typography>
      {!token && <Alert severity="error">This invitation link is missing its token.</Alert>}
      <Stack spacing={2}>
        {error && <Alert severity="error">{errorMessage(error)}</Alert>}
        <TextField label="Password" type="password" autoComplete="new-password" autoFocus {...register('password')} error={!!errors.password} helperText={errors.password?.message ?? 'At least 8 characters with a letter and a number'} />
        <TextField label="Confirm password" type="password" autoComplete="new-password" {...register('confirm')} error={!!errors.confirm} helperText={errors.confirm?.message} />
        <Button type="submit" variant="contained" size="large" disabled={isLoading || !token}>
          Activate account
        </Button>
      </Stack>
    </Box>
  );
}
