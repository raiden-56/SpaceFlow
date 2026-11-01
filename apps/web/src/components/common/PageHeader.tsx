import { Box, Breadcrumbs, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { ReactNode } from 'react';

export interface Crumb {
  label: string;
  to?: string;
}

export function PageHeader({ title, subtitle, actions, crumbs, dense }: { title: string; subtitle?: ReactNode; actions?: ReactNode; crumbs?: Crumb[]; dense?: boolean }) {
  return (
    <Box sx={{ mb: dense ? 2 : 3 }}>
      {crumbs && crumbs.length > 0 && (
        <Breadcrumbs aria-label="breadcrumb" sx={{ mb: 1, fontSize: '0.8125rem' }}>
          {crumbs.map((c, i) =>
            c.to && i < crumbs.length - 1 ? (
              <Link key={i} component={RouterLink} to={c.to} underline="hover" color="text.secondary">
                {c.label}
              </Link>
            ) : (
              <Typography key={i} variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                {c.label}
              </Typography>
            ),
          )}
        </Breadcrumbs>
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h1" component="h1" sx={{ fontSize: { xs: '1.5rem', md: '1.875rem' } }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {actions && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {actions}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
