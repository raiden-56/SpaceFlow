// Last-resort error boundary: a render error shows a recovery screen instead of a blank page.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Box role="alert" sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center', p: 3 }}>
        <Stack spacing={2} sx={{ maxWidth: 480, textAlign: 'center' }}>
          <Typography variant="h2" component="h1">
            Something went wrong
          </Typography>
          <Typography color="text.secondary">This screen hit an unexpected error. Your bookings are safe; reload to continue.</Typography>
          {import.meta.env.DEV && <Alert severity="error" sx={{ textAlign: 'left' }}>{this.state.error.message}</Alert>}
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'center' }}>
            <Button variant="contained" onClick={() => window.location.reload()}>
              Reload
            </Button>
            <Button onClick={() => { this.setState({ error: null }); window.location.assign('/'); }}>Go to home</Button>
          </Stack>
        </Stack>
      </Box>
    );
  }
}
