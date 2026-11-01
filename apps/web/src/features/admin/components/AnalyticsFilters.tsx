import { useState } from 'react';
import { Button, FormControl, InputLabel, MenuItem, Select, Stack } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useBuildingsQuery } from '@/services/endpoints';
import { dayjs } from '@/utils/time';
import { FilterBar } from './FilterBar';

export interface AnalyticsRange {
  buildingId?: string;
  from: string;
  to: string;
}

export function useAnalyticsRange(days = 30): [AnalyticsRange, (r: AnalyticsRange) => void] {
  const [range, setRange] = useState<AnalyticsRange>({ from: dayjs().subtract(days - 1, 'day').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') });
  return [range, setRange];
}

export function AnalyticsFilters({ value, onChange }: { value: AnalyticsRange; onChange: (v: AnalyticsRange) => void }) {
  const { data: buildings } = useBuildingsQuery();
  const preset = (days: number) => onChange({ ...value, from: dayjs().subtract(days - 1, 'day').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') });
  return (
    <FilterBar
      actions={
        <Stack direction="row" spacing={0.5}>
          {[7, 30, 90].map((d) => (
            <Button key={d} size="small" variant={dayjs(value.to).diff(dayjs(value.from), 'day') + 1 === d ? 'contained' : 'outlined'} onClick={() => preset(d)}>
              {d}d
            </Button>
          ))}
        </Stack>
      }
    >
      <FormControl size="small">
        <InputLabel id="an-b">Building</InputLabel>
        <Select labelId="an-b" label="Building" value={value.buildingId ?? ''} onChange={(e) => onChange({ ...value, buildingId: e.target.value || undefined })}>
          <MenuItem value="">All buildings</MenuItem>
          {(buildings ?? []).map((b) => (
            <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <DatePicker label="From" value={dayjs(value.from)} maxDate={dayjs(value.to)} onChange={(v) => v?.isValid() && onChange({ ...value, from: v.format('YYYY-MM-DD') })} slotProps={{ textField: { size: 'small' } }} />
      <DatePicker label="To" value={dayjs(value.to)} minDate={dayjs(value.from)} maxDate={dayjs()} onChange={(v) => v?.isValid() && onChange({ ...value, to: v.format('YYYY-MM-DD') })} slotProps={{ textField: { size: 'small' } }} />
    </FilterBar>
  );
}
