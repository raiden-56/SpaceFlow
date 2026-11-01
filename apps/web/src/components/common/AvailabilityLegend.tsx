import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { STATUS_COLORS } from '@spaceflow/shared';

const ITEMS: { key: string; color: string; label: string; meaning: string }[] = [
  { key: 'AVAILABLE', color: STATUS_COLORS.AVAILABLE, label: 'Available', meaning: 'Free for the selected date and time. Click to book.' },
  { key: 'RESERVED', color: STATUS_COLORS.RESERVED, label: 'Reserved', meaning: 'Booked for the selected period but not in use right now.' },
  { key: 'OCCUPIED', color: STATUS_COLORS.OCCUPIED, label: 'In use', meaning: 'Someone is checked in or the booking is happening now.' },
  { key: 'SELECTED', color: STATUS_COLORS.SELECTED, label: 'Selected', meaning: 'The resource you have selected.' },
  { key: 'RESTRICTED', color: STATUS_COLORS.RESTRICTED, label: 'Approval / restricted', meaning: 'Bookable with approval or limited to a team.' },
  { key: 'DISABLED', color: STATUS_COLORS.DISABLED, label: 'Not bookable', meaning: 'Disabled, under maintenance or a facility that cannot be booked.' },
];

export function AvailabilityLegend({ compact }: { compact?: boolean }) {
  return (
    <Stack component="ul" direction="row" useFlexGap spacing={compact ? 1 : 1.5} aria-label="Map legend" sx={{ flexWrap: 'wrap', listStyle: 'none', m: 0, p: 0 }}>
      {ITEMS.map((i) => (
        <Tooltip key={i.key} title={i.meaning}>
          <Box component="li" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: compact ? 12 : 13, cursor: 'help' }}>
            <Box aria-hidden sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: i.color, boxShadow: `0 0 0 2px ${i.color}33` }} />
            <Typography variant="caption" color="text.primary" sx={{ fontWeight: 500 }}>
              {i.label}
            </Typography>
          </Box>
        </Tooltip>
      ))}
    </Stack>
  );
}
