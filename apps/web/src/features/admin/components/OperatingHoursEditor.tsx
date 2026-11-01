import { Box, Checkbox, FormControlLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import type { OperatingHours } from '@spaceflow/shared';
import { timeOptions } from '@/utils/time';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIMES = timeOptions('00:00', '23:30', 30);

/**
 * Per-weekday opening hours. `value === null` means "inherit from policy".
 * Days absent from the record are closed.
 */
export function OperatingHoursEditor({ value, onChange }: { value: OperatingHours | null; onChange: (v: OperatingHours | null) => void }) {
  const custom = value !== null;
  const setDay = (d: number, next: { open: string; close: string } | null) => {
    const copy: OperatingHours = { ...(value ?? {}) };
    if (next) copy[String(d)] = next;
    else delete copy[String(d)];
    onChange(copy);
  };
  return (
    <Box>
      <FormControlLabel
        control={<Checkbox checked={custom} onChange={(e) => onChange(e.target.checked ? { '1': { open: '08:00', close: '18:00' }, '2': { open: '08:00', close: '18:00' }, '3': { open: '08:00', close: '18:00' }, '4': { open: '08:00', close: '18:00' }, '5': { open: '08:00', close: '18:00' } } : null)} />}
        label="Custom opening hours (otherwise the booking policy applies)"
      />
      {custom && (
        <Stack spacing={0.75} sx={{ mt: 1 }} role="group" aria-label="Opening hours per weekday">
          {DAYS.map((name, d) => {
            const day = value?.[String(d)] ?? null;
            return (
              <Stack key={d} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <FormControlLabel sx={{ minWidth: 130, m: 0 }} control={<Checkbox size="small" checked={!!day} onChange={(e) => setDay(d, e.target.checked ? { open: '08:00', close: '18:00' } : null)} slotProps={{ input: { 'aria-label': `${name} open` } }} />} label={<Typography variant="body2">{name}</Typography>} />
                <Select size="small" value={day?.open ?? '08:00'} disabled={!day} onChange={(e) => day && setDay(d, { ...day, open: e.target.value })} inputProps={{ 'aria-label': `${name} opening time` }} sx={{ width: 110 }}>
                  {TIMES.map((t) => (
                    <MenuItem key={t} value={t}>{t}</MenuItem>
                  ))}
                </Select>
                <Typography variant="caption">to</Typography>
                <Select size="small" value={day?.close ?? '18:00'} disabled={!day} onChange={(e) => day && setDay(d, { ...day, close: e.target.value })} inputProps={{ 'aria-label': `${name} closing time` }} sx={{ width: 110 }}>
                  {TIMES.map((t) => (
                    <MenuItem key={t} value={t} disabled={!!day && t <= day.open}>{t}</MenuItem>
                  ))}
                </Select>
              </Stack>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
