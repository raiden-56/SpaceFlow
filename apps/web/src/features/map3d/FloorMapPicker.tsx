// Embeddable floor map for booking pages: pick a desk or room on the 2D plan (or in 3D) without
// leaving the page. Uses the shared booking window (building, floor, date, time) so availability
// matches the list, dims resources that don't match the page's filters, and shows teammates.
import { useMemo, useRef, useState } from 'react';
import { Alert, Box, Chip, Stack, Tooltip, Typography } from '@mui/material';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import type { ResourceDto } from '@spaceflow/shared';
import { useAppDispatch } from '@/store';
import { setFloor } from '@/store/bookingSlice';
import { useBookingWindow } from '@/hooks/useBookingWindow';
import { useFloorMapQuery, useTeammatesQuery, type TeammateSeatDto } from '@/services/endpoints';
import { AvailabilityLegend } from '@/components/common/AvailabilityLegend';
import { ErrorState } from '@/components/common/Feedback';
import { useToast } from '@/components/common/ToastProvider';
import { FloorPlan2D, type PlanMarker } from './FloorPlan2D';
import { BuildingScene, type SceneHandle } from './BuildingScene';
import { hasWebGL, resourceState } from './geometry';
import { fmtTime } from '@/utils/time';

export interface FloorMapPickerProps {
  /** Restrict to desks or rooms; the other type is hidden. */
  type?: 'SEAT' | 'MEETING_ROOM';
  /** Resources matching the page filters (others are dimmed). null = no filtering. */
  highlightIds?: Set<string> | null;
  selectedResourceId: string | null;
  onSelect: (resource: ResourceDto | null) => void;
  mode?: '2D' | '3D';
  height?: number | string;
  showTeammates?: boolean;
}

const BOOKABLE = ['AVAILABLE', 'RESTRICTED'];

/** Nearest bookable desk (by plan distance) to a given resource, optionally limited to `allowed`. */
export function nearestFreeResource(
  objects: { resourceId: string | null; x: number; y: number; width: number; depth: number }[],
  resources: ResourceDto[],
  fromResourceId: string,
  allowed?: Set<string> | null,
): ResourceDto | null {
  const byId = new Map(resources.map((r) => [r.id, r]));
  const origin = objects.find((o) => o.resourceId === fromResourceId);
  if (!origin) return null;
  const ox = origin.x + origin.width / 2;
  const oy = origin.y + origin.depth / 2;
  let best: { r: ResourceDto; d: number } | null = null;
  for (const o of objects) {
    if (!o.resourceId || o.resourceId === fromResourceId) continue;
    const r = byId.get(o.resourceId);
    if (!r || !BOOKABLE.includes(resourceState(r)) || (allowed && !allowed.has(r.id))) continue;
    const d = Math.hypot(o.x + o.width / 2 - ox, o.y + o.depth / 2 - oy);
    if (!best || d < best.d) best = { r, d };
  }
  return best?.r ?? null;
}

export function FloorMapPicker({ type, highlightIds, selectedResourceId, onSelect, mode = '2D', height = 520, showTeammates = true }: FloorMapPickerProps) {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const ctx = useBookingWindow();
  const [webgl] = useState(() => hasWebGL());
  const [focusNonce, setFocusNonce] = useState(0);
  const sceneRef = useRef<SceneHandle>(null);
  const effectiveMode = mode === '3D' && !webgl ? '2D' : mode;

  const { data: map, isFetching, error, refetch } = useFloorMapQuery({ floorId: ctx.floorId!, startAt: ctx.startAt, endAt: ctx.endAt }, { skip: !ctx.floorId });
  const { data: teammates } = useTeammatesQuery({ buildingId: ctx.buildingId ?? undefined, startAt: ctx.startAt, endAt: ctx.endAt }, { skip: !showTeammates || !ctx.buildingId });

  const current = map && map.floor.id === ctx.floorId ? map : undefined;
  const resources = useMemo(() => (current?.resources ?? []).filter((r) => !type || r.type === type), [current, type]);
  const byId = useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources]);

  const others = (teammates ?? []).filter((t) => !t.isMe);
  const onThisFloor = others.filter((t) => t.floorId === ctx.floorId);
  const elsewhere = others.filter((t) => t.floorId !== ctx.floorId);
  const me = (teammates ?? []).find((t) => t.isMe);

  const markers: PlanMarker[] = useMemo(
    () =>
      (teammates ?? [])
        .filter((t) => t.floorId === ctx.floorId)
        .map((t) => ({
          resourceId: t.resourceId,
          label: t.isMe ? 'ME' : t.initials,
          title: `${t.isMe ? 'You' : t.displayName}${t.isMe ? '' : ' (your team)'} · ${fmtTime(t.startAt, current?.building.timezone)}–${fmtTime(t.endAt, current?.building.timezone)}`,
          color: t.isMe ? '#4F46E5' : '#0EA5E9',
        })),
    [teammates, ctx.floorId, current],
  );

  const select = (id: string | null) => {
    onSelect(id ? byId.get(id) ?? null : null);
    if (id) setFocusNonce((n) => n + 1);
  };

  const sitNear = (t: TeammateSeatDto) => {
    if (!current) return;
    const near = nearestFreeResource(current.objects, resources, t.resourceId, highlightIds);
    if (near) {
      select(near.id);
      toast.info(`${near.name} is the closest free ${near.type === 'SEAT' ? 'desk' : 'room'} to ${t.displayName.split(' ')[0]}.`);
    } else toast.info(`No free desk near ${t.displayName.split(' ')[0]} matches your filters for this time.`);
  };

  const sortedFloors = [...ctx.floors].sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number);
  const matching = highlightIds ? resources.filter((r) => highlightIds.has(r.id) && BOOKABLE.includes(resourceState(r))).length : resources.filter((r) => BOOKABLE.includes(resourceState(r))).length;

  return (
    <Box data-testid="floor-map-picker">
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', mb: 1.5 }} role="radiogroup" aria-label="Floor">
        {sortedFloors.map((f) => {
          const mates = others.filter((t) => t.floorId === f.id).length;
          return (
            <Chip
              key={f.id}
              role="radio"
              aria-checked={f.id === ctx.floorId}
              label={`${f.name}${mates ? ` · ${mates} teammate${mates > 1 ? 's' : ''}` : ''}`}
              color={f.id === ctx.floorId ? 'primary' : 'default'}
              variant={f.id === ctx.floorId ? 'filled' : 'outlined'}
              onClick={() => dispatch(setFloor(f.id))}
              icon={mates ? <GroupsRoundedIcon /> : undefined}
            />
          );
        })}
      </Stack>

      {error && <ErrorState error={error} onRetry={refetch} title="Could not load the floor map" />}

      <Box sx={{ position: 'relative', height, borderRadius: 3, overflow: 'hidden', border: '1px solid', borderColor: 'divider', bgcolor: '#F5F7FB' }}>
        {!ctx.floorId ? (
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', p: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Pick a floor above to see its {type === 'MEETING_ROOM' ? 'rooms' : 'desks'} on the map.
            </Typography>
          </Box>
        ) : effectiveMode === '3D' ? (
          <BuildingScene
            ref={sceneRef}
            floors={ctx.floors}
            selectedFloorId={ctx.floorId}
            map={current}
            resources={resources}
            selectedResourceId={selectedResourceId}
            onSelectResource={select}
            onSelectFloor={(id) => dispatch(setFloor(id))}
            exploded={false}
            reducedMotion={false}
            focusNonce={focusNonce}
            buildingModelUrl={ctx.building?.modelUrl}
            floorModelUrl={current?.plan?.modelUrl}
          />
        ) : (
          <FloorPlan2D map={current} resources={resources} selectedResourceId={selectedResourceId} onSelectResource={select} focusNonce={focusNonce} highlightIds={highlightIds} markers={markers} />
        )}
        {isFetching && (
          <Typography variant="caption" role="status" sx={{ position: 'absolute', left: 12, bottom: 12, bgcolor: 'rgba(255,255,255,0.9)', px: 1, py: 0.25, borderRadius: 1 }}>
            Updating availability…
          </Typography>
        )}
      </Box>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mt: 1.25, justifyContent: 'space-between', alignItems: { md: 'center' } }}>
        <AvailabilityLegend compact />
        {current && (
          <Typography variant="caption" color="text.secondary" aria-live="polite">
            {matching} {type === 'MEETING_ROOM' ? 'room' : 'desk'}
            {matching === 1 ? '' : 's'} free{highlightIds ? ' matching your filters' : ''} on {current.floor.name}
          </Typography>
        )}
      </Stack>

      {showTeammates && (onThisFloor.length > 0 || elsewhere.length > 0 || me) && (
        <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 2, bgcolor: 'rgba(14,165,233,0.06)', border: '1px solid', borderColor: 'rgba(14,165,233,0.25)' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.75 }}>
            <GroupsRoundedIcon fontSize="small" sx={{ color: '#0EA5E9' }} />
            <Typography variant="subtitle2" component="h3" sx={{ textTransform: 'none', letterSpacing: 0 }}>
              Your team in the office
            </Typography>
          </Stack>
          {me && (
            <Typography variant="caption" sx={{ display: 'block', mb: 0.75 }}>
              You already have {me.resourceCode} on {me.floorName} for this time.
            </Typography>
          )}
          {onThisFloor.length > 0 && (
            <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {onThisFloor.map((t) => (
                <Tooltip key={`${t.userId}-${t.startAt}`} title={`Select the closest free desk to ${t.displayName} (${t.resourceCode})`}>
                  <Chip size="small" label={`Sit near ${t.displayName} · ${t.resourceCode}`} onClick={() => sitNear(t)} sx={{ bgcolor: '#fff' }} />
                </Tooltip>
              ))}
            </Stack>
          )}
          {elsewhere.length > 0 && (
            <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mt: onThisFloor.length ? 0.75 : 0 }}>
              {elsewhere.map((t) => (
                <Chip key={`${t.userId}-${t.startAt}`} size="small" variant="outlined" label={`${t.displayName} · ${t.floorName}`} onClick={() => dispatch(setFloor(t.floorId))} />
              ))}
            </Stack>
          )}
          {!onThisFloor.length && !elsewhere.length && (
            <Typography variant="caption" color="text.secondary">
              None of your teammates have booked a desk in this building for this time yet.
            </Typography>
          )}
        </Box>
      )}
      {mode === '3D' && !webgl && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          3D isn't supported on this device, so the 2D floor plan is shown instead.
        </Alert>
      )}
    </Box>
  );
}
