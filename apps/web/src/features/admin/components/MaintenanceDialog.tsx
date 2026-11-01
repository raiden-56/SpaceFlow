import { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import type { ResourceDto } from '@spaceflow/shared';
import { useAddMaintenanceMutation, useMaintenanceWindowsQuery, useRemoveMaintenanceMutation } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { useToast } from '@/components/common/ToastProvider';
import { dayjs, fmtRange } from '@/utils/time';

export function MaintenanceDialog({ open, onClose, resource }: { open: boolean; onClose: () => void; resource: ResourceDto | null }) {
  const [start, setStart] = useState(dayjs().add(1, 'day').hour(8).minute(0));
  const [end, setEnd] = useState(dayjs().add(1, 'day').hour(12).minute(0));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data: windows } = useMaintenanceWindowsQuery({ id: resource?.id ?? '' }, { skip: !resource || !open });
  const [add, { isLoading }] = useAddMaintenanceMutation();
  const [remove] = useRemoveMaintenanceMutation();
  const toast = useToast();
  if (!resource) return null;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="maint-title">
      <DialogTitle id="maint-title">Maintenance windows · {resource.name}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            During a maintenance window the resource is shown as not bookable and employees with overlapping bookings are notified.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <DateTimePicker label="From" value={start} onChange={(v) => v?.isValid() && setStart(v)} slotProps={{ textField: { size: 'small', fullWidth: true } }} />
            <DateTimePicker label="To" value={end} onChange={(v) => v?.isValid() && setEnd(v)} slotProps={{ textField: { size: 'small', fullWidth: true } }} />
          </Stack>
          <TextField label="Reason (shown to employees)" value={reason} onChange={(e) => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
          <Button variant="contained" disabled={isLoading || !end.isAfter(start)} onClick={async () => { setError(null); try { await add({ id: resource.id, startAt: start.toISOString(), endAt: end.toISOString(), reason: reason || undefined }).unwrap(); toast.success('Maintenance window added'); setReason(''); } catch (err) { setError(errorMessage(err)); } }}>
            Add window
          </Button>
          <List dense aria-label="Existing maintenance windows">
            {(windows ?? []).length === 0 && <Typography variant="caption" color="text.secondary">No maintenance windows.</Typography>}
            {(windows ?? []).map((w) => (
              <ListItem key={w.id} secondaryAction={<IconButton edge="end" aria-label="Remove window" onClick={async () => { try { await remove({ id: resource.id, windowId: w.id }).unwrap(); } catch (err) { setError(errorMessage(err)); } }}><DeleteOutlineRoundedIcon /></IconButton>}>
                <ListItemText primary={fmtRange(w.startAt, w.endAt, resource.buildingTimezone)} secondary={w.reason ?? 'No reason given'} />
              </ListItem>
            ))}
          </List>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
