import { Paper, Stack } from '@mui/material';
import type { ReactNode } from 'react';

/** One row of filter controls above a table or chart set; wraps on small screens. */
export function FilterBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }} role="search">
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', '& > *': { minWidth: { xs: '100%', sm: 160 } } }}>
          {children}
        </Stack>
        {actions && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', flexShrink: 0 }}>
            {actions}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
