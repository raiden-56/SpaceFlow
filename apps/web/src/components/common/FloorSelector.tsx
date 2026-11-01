import { Box, ButtonBase, Stack, Typography, useMediaQuery, useTheme, Select, MenuItem, FormControl, InputLabel } from '@mui/material';
import { motion } from 'framer-motion';
import type { FloorDto } from '@spaceflow/shared';

/** Vertical floor stack on desktop, compact select on mobile. Keyboard accessible (radio group). */
export function FloorSelector({ floors, value, onChange, showAll, allLabel = 'Whole building', dense }: { floors: FloorDto[]; value: string | null; onChange: (floorId: string | null) => void; showAll?: boolean; allLabel?: string; dense?: boolean }) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const ordered = [...floors].sort((a, b) => b.sortOrder - a.sortOrder || b.number - a.number);

  if (mobile) {
    return (
      <FormControl size="small" fullWidth>
        <InputLabel id="floor-select-label">Floor</InputLabel>
        <Select labelId="floor-select-label" label="Floor" value={value ?? (showAll ? '__all' : '')} onChange={(e) => onChange(e.target.value === '__all' ? null : (e.target.value as string))}>
          {showAll && <MenuItem value="__all">{allLabel}</MenuItem>}
          {ordered.map((f) => (
            <MenuItem key={f.id} value={f.id}>
              {f.name} · {f.seatCount} seats, {f.roomCount} rooms
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  }

  const item = (id: string | null, label: string, meta?: string, selected?: boolean) => (
    <ButtonBase
      key={id ?? '__all'}
      role="radio"
      aria-checked={!!selected}
      onClick={() => onChange(id)}
      component={motion.button}
      nativeButton
      whileTap={{ scale: 0.98 }}
      sx={{ width: '100%', justifyContent: 'space-between', px: 1.5, py: dense ? 0.75 : 1.1, borderRadius: 2, border: '1px solid', borderColor: selected ? 'primary.main' : 'divider', bgcolor: selected ? 'rgba(79,70,229,0.08)' : '#fff', color: selected ? 'primary.main' : 'text.primary', fontFamily: 'inherit', textAlign: 'left', transition: 'all 120ms ease', '&:hover': { borderColor: 'primary.light' } }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      {meta && (
        <Typography variant="caption" color={selected ? 'primary.main' : 'text.secondary'}>
          {meta}
        </Typography>
      )}
    </ButtonBase>
  );

  return (
    <Box role="radiogroup" aria-label="Floor selector">
      <Stack spacing={0.75}>
        {showAll && item(null, allLabel, undefined, value === null)}
        {ordered.map((f) => item(f.id, f.name, `${f.seatCount} seats · ${f.roomCount} rooms`, value === f.id))}
      </Stack>
    </Box>
  );
}
