// Routed content area used by the layouts. The Suspense boundary sits here, so while a page's
// code loads only the content area shows a progress bar; the sidebar and header never unmount.
import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Box, LinearProgress } from '@mui/material';

function ContentFallback() {
  return (
    <Box sx={{ py: 2 }} role="status" aria-label="Loading page">
      <LinearProgress />
    </Box>
  );
}

export function ContentOutlet() {
  const { pathname } = useLocation();
  // New page: start at the top, as a full navigation would.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return (
    <Suspense fallback={<ContentFallback />}>
      <Outlet />
    </Suspense>
  );
}
