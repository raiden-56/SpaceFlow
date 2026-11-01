import { Box, Card, CardActionArea, CardContent, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded';
import DesktopWindowsRoundedIcon from '@mui/icons-material/DesktopWindowsRounded';
import MeetingRoomRoundedIcon from '@mui/icons-material/MeetingRoomRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded';
import { SEAT_ATTRIBUTE_LABELS, type ResourceDto, type SeatAttributeKey } from '@spaceflow/shared';
import { StatusBadge } from './StatusBadge';
import { useAddFavoriteMutation, useRemoveFavoriteMutation } from '@/services/endpoints';
import { useToast } from './ToastProvider';
import { errorMessage } from '@/services/api';

export function seatFeatureChips(r: ResourceDto, max = 3): string[] {
  const out: string[] = [];
  const attrs = r.seatAttributes ?? {};
  for (const k of Object.keys(SEAT_ATTRIBUTE_LABELS) as SeatAttributeKey[]) if (attrs[k]) out.push(SEAT_ATTRIBUTE_LABELS[k]);
  for (const a of r.amenities) if (!out.includes(a.name)) out.push(a.name);
  return out.slice(0, max);
}

export function FavoriteButton({ resource, size = 'small' }: { resource: ResourceDto; size?: 'small' | 'medium' }) {
  const [add, { isLoading: adding }] = useAddFavoriteMutation();
  const [remove, { isLoading: removing }] = useRemoveFavoriteMutation();
  const toast = useToast();
  const fav = !!resource.isFavorite;
  return (
    <Tooltip title={fav ? 'Remove from favorites' : 'Add to favorites'}>
      <IconButton
        size={size}
        aria-label={fav ? `Remove ${resource.name} from favorites` : `Add ${resource.name} to favorites`}
        aria-pressed={fav}
        disabled={adding || removing}
        onClick={async (e) => {
          e.stopPropagation();
          e.preventDefault();
          try {
            if (fav) await remove({ resourceId: resource.id }).unwrap();
            else await add({ resourceId: resource.id }).unwrap();
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
        sx={{ color: fav ? '#F59E0B' : 'text.secondary' }}
      >
        {fav ? <StarRoundedIcon /> : <StarBorderRoundedIcon />}
      </IconButton>
    </Tooltip>
  );
}

export function ResourceCard({ resource, selected, onSelect, onBook, showLocation = true, dense }: { resource: ResourceDto; selected?: boolean; onSelect?: (r: ResourceDto) => void; onBook?: (r: ResourceDto) => void; showLocation?: boolean; dense?: boolean }) {
  const isSeat = resource.type === 'SEAT';
  const av = resource.availability;
  const features = seatFeatureChips(resource, dense ? 2 : 3);
  return (
    <Card
      sx={{ height: '100%', borderColor: selected ? 'primary.main' : undefined, boxShadow: selected ? '0 0 0 2px rgba(79,70,229,0.25)' : undefined, transition: 'box-shadow 120ms ease, transform 120ms ease', '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 6px 16px rgba(23,32,51,0.08)' } }}
      data-testid={`resource-card-${resource.code}`}
    >
      <CardActionArea onClick={() => onSelect?.(resource)} aria-label={`${resource.name}, ${av ? av.state.toLowerCase() : resource.status.toLowerCase()}`} sx={{ height: '100%', alignItems: 'stretch' }}>
        <CardContent sx={{ p: dense ? 1.5 : 2, '&:last-child': { pb: dense ? 1.5 : 2 } }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
              <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: 'rgba(79,70,229,0.08)', color: 'primary.main', display: 'grid', placeItems: 'center', flexShrink: 0 }} aria-hidden>
                {isSeat ? <DesktopWindowsRoundedIcon fontSize="small" /> : <MeetingRoomRoundedIcon fontSize="small" />}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
                  {resource.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                  {resource.code}
                  {resource.zoneName ? ` · ${resource.zoneName}` : ''}
                </Typography>
              </Box>
            </Stack>
            <FavoriteButton resource={resource} />
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mt: 1.25 }} useFlexGap>
            {av ? <StatusBadge status={av.state} /> : resource.status !== 'ACTIVE' ? <StatusBadge status="DISABLED" label={resource.status === 'MAINTENANCE' ? 'Maintenance' : 'Disabled'} /> : null}
            {!isSeat && resource.capacity && (
              <Chip size="small" variant="outlined" icon={<PeopleAltRoundedIcon />} label={`${resource.capacity} seats`} />
            )}
            {resource.requiresApproval && !av && <Chip size="small" variant="outlined" color="warning" label="Approval" />}
          </Stack>
          {av?.reason && av.state !== 'AVAILABLE' && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              {av.reason}
            </Typography>
          )}
          {showLocation && (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 1, color: 'text.secondary' }}>
              <PlaceRoundedIcon sx={{ fontSize: 16 }} aria-hidden />
              <Typography variant="caption">
                {resource.buildingName} · {resource.floorName}
              </Typography>
            </Stack>
          )}
          {features.length > 0 && (
            <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mt: 1 }}>
              {features.map((f) => (
                <Chip key={f} size="small" label={f} sx={{ bgcolor: '#F1F5F9', fontWeight: 500 }} />
              ))}
            </Stack>
          )}
          {onBook && av?.canBook && (
            <Box sx={{ mt: 1.5 }}>
              <Box
                component="button"
                type="button"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onBook(resource);
                }}
                sx={{ width: '100%', border: 0, borderRadius: 2, py: 1, fontWeight: 600, fontFamily: 'inherit', fontSize: 14, color: '#fff', bgcolor: 'primary.main', cursor: 'pointer', '&:hover': { bgcolor: 'primary.dark' } }}
              >
                {av.state === 'RESTRICTED' ? 'Request booking' : 'Book now'}
              </Box>
            </Box>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
