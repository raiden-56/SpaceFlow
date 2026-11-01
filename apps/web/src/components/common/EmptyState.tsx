import { Box, Button, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import InboxRoundedIcon from '@mui/icons-material/InboxRounded';

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  return (
    <Box role="status" sx={{ textAlign: 'center', py: compact ? 3 : 6, px: 2, color: 'text.secondary' }}>
      <Box sx={{ width: 56, height: 56, borderRadius: '50%', bgcolor: 'rgba(79,70,229,0.08)', color: 'primary.main', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', mb: 1.5, '& svg': { fontSize: 28 } }}>
        {icon ?? <InboxRoundedIcon />}
      </Box>
      <Typography variant="h5" color="text.primary" gutterBottom>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" sx={{ maxWidth: 420, mx: 'auto' }}>
          {description}
        </Typography>
      )}
      {actionLabel && onAction && (
        <Button variant="contained" sx={{ mt: 2.5 }} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Box>
  );
}
