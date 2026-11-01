import { Alert, Box, Button, Skeleton, Stack } from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { errorMessage } from '@/services/api';

export function ErrorState({ error, onRetry, title }: { error?: unknown; onRetry?: () => void; title?: string }) {
  return (
    <Alert
      severity="error"
      role="alert"
      action={
        onRetry ? (
          <Button color="inherit" size="small" startIcon={<RefreshRoundedIcon />} onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
      sx={{ my: 2 }}
    >
      {title ? `${title}: ` : ''}
      {errorMessage(error)}
    </Alert>
  );
}

export function CardSkeleton({ count = 3, height = 120 }: { count?: number; height?: number }) {
  return (
    <Stack spacing={1.5} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} variant="rounded" height={height} animation="wave" />
      ))}
    </Stack>
  );
}

export function GridSkeleton({ count = 6, height = 160 }: { count?: number; height?: number }) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' } }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} variant="rounded" height={height} animation="wave" />
      ))}
    </Box>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Stack spacing={1} aria-busy="true" aria-label="Loading">
      <Skeleton variant="rounded" height={40} />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="rounded" height={52} animation="wave" />
      ))}
    </Stack>
  );
}
