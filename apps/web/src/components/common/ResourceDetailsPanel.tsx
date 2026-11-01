// Details panel for a selected seat or room: location, status, amenities, restrictions, today's
// slots and the Book Now action. Used by the 3D/2D explorer, list views and booking pages.
import { useState } from 'react';
import { Box, Button, Chip, Divider, IconButton, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DesktopWindowsRoundedIcon from '@mui/icons-material/DesktopWindowsRounded';
import MeetingRoomRoundedIcon from '@mui/icons-material/MeetingRoomRounded';
import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import AccessibleRoundedIcon from '@mui/icons-material/AccessibleRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import TimerRoundedIcon from '@mui/icons-material/TimerRounded';
import QrCodeRoundedIcon from '@mui/icons-material/QrCodeRounded';
import { SEAT_ATTRIBUTE_LABELS, type ResourceDto, type SeatAttributeKey, type TimeSlotDto } from '@spaceflow/shared';
import { useResourceDayQuery } from '@/services/endpoints';
import { StatusBadge } from './StatusBadge';
import { FavoriteButton } from './ResourceCard';
import { BookingDialog } from '@/features/bookings/BookingDialog';
import { dayjs, fmtTime } from '@/utils/time';
import { useTheme } from '@mui/material/styles';

export function SlotStrip({ slots, tz, onPick, selectedStart, selectedEnd }: { slots: TimeSlotDto[]; tz: string; onPick?: (slot: TimeSlotDto) => void; selectedStart?: string; selectedEnd?: string }) {
  const theme = useTheme();
  if (!slots.length) return <Typography variant="caption" color="text.secondary">Closed on this day.</Typography>;
  return (
    <Box role="list" aria-label="Time slots" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))', gap: 0.5 }}>
      {slots.map((s) => {
        const sel = selectedStart && selectedEnd && new Date(s.startAt) < new Date(selectedEnd) && new Date(selectedStart) < new Date(s.endAt);
        const color = s.state === 'AVAILABLE' ? theme.palette.status.available : s.state === 'RESTRICTED' ? theme.palette.status.restricted : s.state === 'DISABLED' ? theme.palette.status.disabled : s.state === 'OCCUPIED' ? theme.palette.status.occupied : theme.palette.status.reserved;
        const bookable = s.state === 'AVAILABLE' || s.state === 'RESTRICTED';
        return (
          <Tooltip key={s.startAt} title={`${fmtTime(s.startAt, tz)}–${fmtTime(s.endAt, tz)} · ${s.state.toLowerCase().replace('_', ' ')}`}>
            <Box
              role="listitem"
              component={bookable && onPick ? 'button' : 'div'}
              onClick={bookable && onPick ? () => onPick(s) : undefined}
              aria-label={`${fmtTime(s.startAt, tz)} ${s.state.toLowerCase()}`}
              sx={{ fontFamily: 'inherit', fontSize: 11, fontWeight: 600, py: 0.5, borderRadius: 1, border: '1px solid', borderColor: sel ? theme.palette.status.selected : `${color}66`, bgcolor: sel ? theme.palette.status.selected : `${color}22`, color: sel ? '#fff' : color, cursor: bookable && onPick ? 'pointer' : 'default', textAlign: 'center', '&:hover': bookable && onPick ? { bgcolor: `${color}44` } : undefined }}
            >
              {fmtTime(s.startAt, tz)}
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}

export function ResourceDetailsPanel({ resource, date, startAt, endAt, onClose, onBooked, onSelectAlternative, compact }: { resource: ResourceDto | null; date: string; startAt?: string; endAt?: string; onClose?: () => void; onBooked?: () => void; onSelectAlternative?: (resourceId: string) => void; compact?: boolean }) {
  const [bookOpen, setBookOpen] = useState(false);
  const [pickedSlot, setPickedSlot] = useState<TimeSlotDto | null>(null);
  const { data: day, isLoading } = useResourceDayQuery({ id: resource?.id ?? '', date }, { skip: !resource });
  if (!resource) {
    return (
      <Box sx={{ p: compact ? 2 : 3, color: 'text.secondary' }}>
        <Typography variant="subtitle2" gutterBottom>
          Resource details
        </Typography>
        <Typography variant="body2">Select a desk or meeting room on the map or in the list to see its availability and book it.</Typography>
      </Box>
    );
  }
  const isSeat = resource.type === 'SEAT';
  const av = resource.availability;
  const attrs = (Object.keys(SEAT_ATTRIBUTE_LABELS) as SeatAttributeKey[]).filter((k) => resource.seatAttributes?.[k]);
  const restricted = resource.restrictedDepartmentIds.length + resource.restrictedTeamIds.length > 0;
  const canBook = av ? av.canBook : resource.status === 'ACTIVE' && resource.isBookable;

  return (
    <Box data-testid="resource-details" sx={{ p: compact ? 2 : 2.5 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1.25} sx={{ minWidth: 0 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: 'rgba(79,70,229,0.08)', color: 'primary.main', display: 'grid', placeItems: 'center', flexShrink: 0 }} aria-hidden>
            {isSeat ? <DesktopWindowsRoundedIcon /> : <MeetingRoomRoundedIcon />}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h4" component="h2" noWrap>
              {resource.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {resource.code} · {isSeat ? (resource.seatType ?? 'Desk').toLowerCase().replace('_', ' ') : (resource.roomType ?? 'Meeting room').toLowerCase()}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" sx={{ alignItems: 'center' }}>
          <FavoriteButton resource={resource} />
          {onClose && (
            <IconButton aria-label="Close details" size="small" onClick={onClose}>
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mt: 1.5 }}>
        {av ? <StatusBadge status={av.state} /> : resource.status !== 'ACTIVE' ? <StatusBadge status="DISABLED" label={resource.status === 'MAINTENANCE' ? 'Maintenance' : 'Disabled'} /> : <StatusBadge status="AVAILABLE" label="Bookable" />}
        {resource.capacity && <Chip size="small" variant="outlined" icon={<PeopleAltRoundedIcon />} label={`Capacity ${resource.capacity}`} />}
        {resource.accessible && <Chip size="small" variant="outlined" icon={<AccessibleRoundedIcon />} label="Accessible" />}
        {resource.requiresApproval && <Chip size="small" variant="outlined" color="warning" icon={<LockRoundedIcon />} label="Approval required" />}
        {resource.maxDurationMinutes && <Chip size="small" variant="outlined" icon={<TimerRoundedIcon />} label={`Max ${resource.maxDurationMinutes} min`} />}
        {resource.checkInRequired !== false && <Chip size="small" variant="outlined" icon={<QrCodeRoundedIcon />} label="Check-in required" />}
      </Stack>
      {av?.reason && av.state !== 'AVAILABLE' && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {av.reason}
        </Typography>
      )}

      <Divider sx={{ my: 2 }} />
      <Stack spacing={1.25}>
        <Row label="Location" value={`${resource.buildingName} · ${resource.floorName}${resource.zoneName ? ` · ${resource.zoneName}` : ''}`} icon={<PlaceRoundedIcon fontSize="small" />} />
        {resource.description && <Row label="About" value={resource.description} />}
        {(attrs.length > 0 || resource.amenities.length > 0) && (
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Amenities
            </Typography>
            <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {attrs.map((k) => (
                <Chip key={k} size="small" label={SEAT_ATTRIBUTE_LABELS[k]} sx={{ bgcolor: '#F1F5F9', fontWeight: 500 }} />
              ))}
              {resource.amenities.filter((a) => !attrs.some((k) => SEAT_ATTRIBUTE_LABELS[k] === a.name)).map((a) => (
                <Chip key={a.id} size="small" label={a.name} sx={{ bgcolor: '#F1F5F9', fontWeight: 500 }} />
              ))}
            </Stack>
          </Box>
        )}
        {restricted && <Row label="Restrictions" value="Reserved for specific departments or teams." icon={<LockRoundedIcon fontSize="small" />} />}
        {resource.operatingHours && (
          <Row label="Opening hours" value={Object.entries(resource.operatingHours).filter(([, v]) => v).map(([d, v]) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][Number(d)]} ${v!.open}–${v!.close}`).join(', ') || 'Closed'} />
        )}
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            {dayjs(date, 'YYYY-MM-DD').isSame(dayjs(), 'day') ? 'Today' : dayjs(date, 'YYYY-MM-DD').format('ddd D MMM')}
            {day?.operatingStart ? ` · ${day.operatingStart}–${day.operatingEnd}` : ''}
          </Typography>
          {isLoading ? <Skeleton variant="rounded" height={48} /> : <SlotStrip slots={day?.slots ?? []} tz={resource.buildingTimezone} selectedStart={startAt} selectedEnd={endAt} onPick={canBook ? (s) => { setPickedSlot(s); setBookOpen(true); } : undefined} />}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Tap a free slot to start a booking at that time.
          </Typography>
        </Box>
      </Stack>

      <Box sx={{ mt: 2.5 }}>
        <Button fullWidth variant="contained" size="large" disabled={!canBook} onClick={() => { setPickedSlot(null); setBookOpen(true); }} data-testid="book-now">
          {!canBook ? (av?.state === 'RESERVED' || av?.state === 'OCCUPIED' ? 'Not available for this time' : 'Not bookable') : av?.state === 'RESTRICTED' ? 'Request booking' : 'Book now'}
        </Button>
      </Box>

      <BookingDialog
        open={bookOpen}
        resource={resource}
        startAt={pickedSlot?.startAt ?? startAt}
        endAt={pickedSlot ? dayjs(pickedSlot.startAt).add(isSeat ? 8 : 1, 'hour').toISOString() : endAt}
        onClose={() => setBookOpen(false)}
        onBooked={() => onBooked?.()}
        onSelectAlternative={(alt) => { setBookOpen(false); onSelectAlternative?.(alt.resource.id); }}
      />
    </Box>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        {label}
      </Typography>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'flex-start', color: 'text.primary' }}>
        {icon && <Box sx={{ color: 'text.secondary', mt: '2px' }}>{icon}</Box>}
        <Typography variant="body2">{value}</Typography>
      </Stack>
    </Box>
  );
}
