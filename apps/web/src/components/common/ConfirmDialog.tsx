import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, CircularProgress } from '@mui/material';
import type { ReactNode } from 'react';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  loading,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} aria-labelledby="confirm-title" aria-describedby="confirm-desc" maxWidth="xs" fullWidth>
      <DialogTitle id="confirm-title">{title}</DialogTitle>
      <DialogContent>
        {description && <DialogContentText id="confirm-desc">{description}</DialogContentText>}
        {children}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading} color="inherit">
          {cancelLabel}
        </Button>
        <Button onClick={onConfirm} variant="contained" color={destructive ? 'error' : 'primary'} disabled={loading} autoFocus startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
