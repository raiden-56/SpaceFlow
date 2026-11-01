import { Link as RouterLink } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, Link, Stack, TextField, Typography } from '@mui/material';
import { forgotPasswordSchema } from '@spaceflow/shared';
import { useForgotPasswordMutation } from '@/services/endpoints';
import { errorMessage } from '@/services/api';

export function ForgotPasswordPage() {
  const [send, { isLoading, isSuccess, error }] = useForgotPasswordMutation();
  const { register, handleSubmit, formState: { errors } } = useForm<{ email: string }>({ resolver: zodResolver(forgotPasswordSchema) });
  return (
    <Box component="form" onSubmit={handleSubmit((v) => send(v))} noValidate>
      <Typography variant="h2" component="h1" gutterBottom>
        Reset your password
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Enter your work email and we will send you a reset link.
      </Typography>
      {isSuccess ? (
        <Alert severity="success">If an account exists for that email, a reset link has been sent. In local development the link is printed in the API log.</Alert>
      ) : (
        <Stack spacing={2}>
          {error && <Alert severity="error">{errorMessage(error)}</Alert>}
          <TextField label="Work email" type="email" autoComplete="email" autoFocus {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
          <Button type="submit" variant="contained" size="large" disabled={isLoading}>
            Send reset link
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
