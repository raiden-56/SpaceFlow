// Shared building / floor / date / time criteria. Writes to bookingSlice so the selection follows
// the user between the explorer, seat booking and meeting room pages.
import { Box, Checkbox, Chip, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useAppDispatch } from '@/store';
import { setBuilding, setDate, setFloor, setTimeWindow } from '@/store/bookingSlice';
import { useBookingWindow } from '@/hooks/useBookingWindow';
import { dayjs, timeOptions } from '@/utils/time';

export function BookingCriteriaBar({ showAllFloors, allowAllDay = true, compact }: { showAllFloors?: boolean; allowAllDay?: boolean; compact?: boolean }) {
  const dispatch = useAppDispatch();
  const ctx = useBookingWindow();
  const times = timeOptions('06:00', '22:00', 30);
  const allDay = allowAllDay && ctx.allDay;
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' }, flexWrap: 'wrap' }} useFlexGap aria-label="Booking criteria">
      <FormControl size="small" sx={{ minWidth: 180 }}>
        <InputLabel id="crit-building">Building</InputLabel>
        <Select labelId="crit-building" label="Building" value={ctx.buildingId ?? ''} onChange={(e) => dispatch(setBuilding(e.target.value))} data-testid="criteria-building">
          {ctx.buildings.map((b) => (
            <MenuItem key={b.id} value={b.id}>
              {b.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel id="crit-floor">Floor</InputLabel>
        <Select labelId="crit-floor" label="Floor" value={ctx.floorId ?? (showAllFloors ? '__all' : '')} onChange={(e) => dispatch(setFloor(e.target.value === '__all' ? null : e.target.value))} data-testid="criteria-floor">
          {showAllFloors && <MenuItem value="__all">All floors</MenuItem>}
          {ctx.floors.map((f) => (
            <MenuItem key={f.id} value={f.id}>
              {f.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <DatePicker label="Date" value={dayjs(ctx.date, 'YYYY-MM-DD')} minDate={dayjs()} onChange={(v) => v?.isValid() && dispatch(setDate(v.format('YYYY-MM-DD')))} slotProps={{ textField: { size: 'small', sx: { minWidth: 150 } } }} />
      {!allDay && (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <FormControl size="small" sx={{ minWidth: 100 }}>
            <InputLabel id="crit-start">Start</InputLabel>
            <Select labelId="crit-start" label="Start" value={ctx.startTime} onChange={(e) => dispatch(setTimeWindow({ startTime: e.target.value }))}>
              {times.slice(0, -1).map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 100 }}>
            <InputLabel id="crit-end">End</InputLabel>
            <Select labelId="crit-end" label="End" value={ctx.endTime} onChange={(e) => dispatch(setTimeWindow({ endTime: e.target.value }))}>
              {times.slice(1).map((t) => (
                <MenuItem key={t} value={t} disabled={t <= ctx.startTime}>
                  {t}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      )}
      {allowAllDay && <FormControlLabel control={<Checkbox checked={ctx.allDay} onChange={(e) => dispatch(setTimeWindow({ allDay: e.target.checked }))} size={compact ? 'small' : 'medium'} />} label="Full day" />}
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }} role="group" aria-label="Quick date and time">
        {quickPicks(ctx.date, allowAllDay).map((q) => {
          const active = q.date === ctx.date && (q.allDay ? allDay : !allDay && ctx.startTime === q.start && ctx.endTime === q.end);
          return (
            <Chip
              key={q.label}
              size="small"
              label={q.label}
              color={active ? 'primary' : 'default'}
              variant={active ? 'filled' : 'outlined'}
              aria-pressed={active}
              onClick={() => {
                dispatch(setDate(q.date));
                dispatch(setTimeWindow(q.allDay ? { allDay: true } : { allDay: false, startTime: q.start, endTime: q.end }));
              }}
            />
          );
        })}
      </Stack>
    </Stack>
  );
}

/** Today / tomorrow (next working day) plus morning and afternoon on the selected day. */
function quickPicks(selectedDate: string, allowAllDay: boolean) {
  const today = dayjs();
  let next = today.add(1, 'day');
  while (next.day() === 0 || next.day() === 6) next = next.add(1, 'day');
  const t = today.format('YYYY-MM-DD');
  const n = next.format('YYYY-MM-DD');
  const nextLabel = next.diff(today.startOf('day'), 'day') === 1 ? 'Tomorrow' : next.format('ddd D MMM');
  const picks: { label: string; date: string; start: string; end: string; allDay?: boolean }[] = [];
  if (allowAllDay) {
    picks.push({ label: 'Today', date: t, start: '08:00', end: '18:00', allDay: true });
    picks.push({ label: nextLabel, date: n, start: '08:00', end: '18:00', allDay: true });
  }
  picks.push({ label: 'Morning', date: selectedDate, start: '09:00', end: '13:00' });
  picks.push({ label: 'Afternoon', date: selectedDate, start: '13:00', end: '18:00' });
  return picks;
}
