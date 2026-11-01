import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import DesktopWindowsRoundedIcon from '@mui/icons-material/DesktopWindowsRounded';
import MeetingRoomRoundedIcon from '@mui/icons-material/MeetingRoomRounded';
import MapRoundedIcon from '@mui/icons-material/MapRounded';
import type { ReservationSummaryDto } from '@spaceflow/shared';
import { StatusBadge } from './StatusBadge';
import { durationLabel, fmtDate, fmtRelative, fmtTime } from '@/utils/time';
import { useAppDispatch } from '@/store';
import { focusResource } from '@/store/bookingSlice';

export function useViewOnMap() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  return (r: { buildingId: string; floorId: string; resourceId: string }) => {
    dispatch(focusResource({ buildingId: r.buildingId, floorId: r.floorId, resourceId: r.resourceId }));
    navigate('/explore');
  };
}

export function BookingCard({ booking, onOpen, compact, showUser }: { booking: ReservationSummaryDto; onOpen?: (b: ReservationSummaryDto) => void; compact?: boolean; showUser?: boolean }) {
  const viewOnMap = useViewOnMap();
  const isSeat = booking.type === 'SEAT';
  const startsSoon = new Date(booking.startAt).getTime() > Date.now() && new Date(booking.startAt).getTime() - Date.now() < 24 * 3600000;
  return (
    <Card data-testid={`booking-card-${booking.resourceCode}`} sx={{ height: '100%' }}>
      <CardContent sx={{ p: compact ? 1.5 : 2, '&:last-child': { pb: compact ? 1.5 : 2 } }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Stack direction="row" spacing={1.25} sx={{ minWidth: 0 }}>
            <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: isSeat ? 'rgba(79,70,229,0.08)' : 'rgba(14,165,233,0.1)', color: isSeat ? 'primary.main' : 'secondary.main', display: 'grid', placeItems: 'center', flexShrink: 0 }} aria-hidden>
              {isSeat ? <DesktopWindowsRoundedIcon /> : <MeetingRoomRoundedIcon />}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
                {booking.title && !isSeat ? booking.title : booking.resourceName}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                {!isSeat && booking.title ? `${booking.resourceName} · ` : ''}
                {booking.buildingName} · {booking.floorName}
                {showUser ? ` · ${booking.userDisplayName}` : ''}
              </Typography>
            </Box>
          </Stack>
          <StatusBadge status={booking.status} />
        </Stack>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline', mt: 1.5 }}>
          <Box>
            <Typography variant="subtitle2" component="div">
              {fmtDate(booking.startAt, booking.timezone)}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {fmtTime(booking.startAt, booking.timezone)}–{fmtTime(booking.endAt, booking.timezone)}
              <Typography component="span" variant="caption" color="text.secondary">
                {' '}
                · {durationLabel(booking.startAt, booking.endAt)}
              </Typography>
            </Typography>
          </Box>
          {startsSoon && (
            <Typography variant="caption" color="primary.main" sx={{ fontWeight: 600 }}>
              Starts {fmtRelative(booking.startAt)}
            </Typography>
          )}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          {onOpen && (
            <Button size="small" variant="outlined" onClick={() => onOpen(booking)}>
              View details
            </Button>
          )}
          <Button size="small" variant="text" startIcon={<MapRoundedIcon />} onClick={() => viewOnMap({ buildingId: booking.buildingId, floorId: booking.floorId, resourceId: booking.resourceId })}>
            View on map
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
