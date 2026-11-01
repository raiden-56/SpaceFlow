import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, CardContent, Chip, FormControl, Grid, InputLabel, MenuItem, Select, Skeleton, Stack, Typography } from '@mui/material';
import DesktopWindowsRoundedIcon from '@mui/icons-material/DesktopWindowsRounded';
import MeetingRoomRoundedIcon from '@mui/icons-material/MeetingRoomRounded';
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded';
import EventNoteRoundedIcon from '@mui/icons-material/EventNoteRounded';
import MapRoundedIcon from '@mui/icons-material/MapRounded';
import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded';
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded';
import type { ResourceDto } from '@spaceflow/shared';
import { useDashboardQuery } from '@/services/endpoints';
import { useBookingWindow } from '@/hooks/useBookingWindow';
import { useAppDispatch } from '@/store';
import { setBuilding } from '@/store/bookingSlice';
import { PageTransition, StaggerItem, StaggerList } from '@/components/common/Motion';
import { ErrorState } from '@/components/common/Feedback';
import { EmptyState } from '@/components/common/EmptyState';
import { BookingCard, useViewOnMap } from '@/components/common/BookingCard';
import { ResourceCard } from '@/components/common/ResourceCard';
import { StatusBadge } from '@/components/common/StatusBadge';
import { BookingDialog } from '@/features/bookings/BookingDialog';
import { BuildingPreview } from '@/features/map3d/BuildingPreview';
import { dayjs, fmtRelative, fmtTime } from '@/utils/time';

function StatTile({ label, value, total, color }: { label: string; value: number; total?: number; color?: string }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ py: 1.75, '&:last-child': { pb: 1.75 } }}>
        <Typography variant="subtitle2">{label}</Typography>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', mt: 0.5 }}>
          <Typography variant="h2" component="p" sx={{ color: color ?? 'text.primary' }}>
            {value}
          </Typography>
          {total !== undefined && (
            <Typography variant="body2" color="text.secondary">
              / {total}
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box component="section" sx={{ mt: 3 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="h3" component="h2">
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Box>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const viewOnMap = useViewOnMap();
  const { buildingId, building, buildings, startAt, endAt } = useBookingWindow();
  const { data, isLoading, error, refetch } = useDashboardQuery({ buildingId: buildingId ?? undefined, startAt, endAt }, { skip: !buildingId && buildings.length > 0 });
  const [bookResource, setBookResource] = useState<ResourceDto | null>(null);
  const greeting = (() => {
    const h = dayjs().hour();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  })();

  if (error) return <ErrorState error={error} onRetry={refetch} title="Could not load your dashboard" />;

  const todaySeat = data?.today.seatBooking ?? null;
  const next = data?.nextBooking ?? null;

  return (
    <PageTransition>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'flex-end' }, justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h1" component="h1" sx={{ fontSize: { xs: '1.5rem', md: '1.875rem' } }}>
            {isLoading || !data ? <Skeleton width={260} /> : `${greeting}, ${data.user.displayName.split(' ')[0]}!`}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {dayjs().format('dddd, D MMMM YYYY')}
            {data?.user.homeBuildingName ? ` · Home office: ${data.user.homeBuildingName}` : ''}
          </Typography>
          <Box sx={{ mt: 1 }} aria-live="polite">
            {isLoading ? (
              <Skeleton width={200} />
            ) : todaySeat ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
                <Typography variant="body2">
                  Today you are at <strong>{todaySeat.resourceName}</strong> ({todaySeat.floorName}, {todaySeat.buildingName}) {fmtTime(todaySeat.startAt, todaySeat.timezone)}–{fmtTime(todaySeat.endAt, todaySeat.timezone)}
                </Typography>
                <StatusBadge status={todaySeat.status} />
                <Button size="small" startIcon={<MapRoundedIcon />} onClick={() => viewOnMap({ buildingId: todaySeat.buildingId, floorId: todaySeat.floorId, resourceId: todaySeat.resourceId })}>
                  View on map
                </Button>
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No desk booked for today yet. Plan your perfect workday below.
              </Typography>
            )}
          </Box>
        </Box>
        <Button variant="contained" size="large" startIcon={<DesktopWindowsRoundedIcon />} onClick={() => navigate('/book-seat')} data-testid="dashboard-quick-book">
          Book a seat
        </Button>
      </Stack>

      <Grid container spacing={2}>
        {[
          { label: 'Book a Seat', icon: <DesktopWindowsRoundedIcon />, to: '/book-seat' },
          { label: 'Book a Meeting Room', icon: <MeetingRoomRoundedIcon />, to: '/meeting-rooms' },
          { label: 'Explore 3D Building', icon: <ViewInArRoundedIcon />, to: '/explore' },
          { label: 'My Bookings', icon: <EventNoteRoundedIcon />, to: '/bookings' },
        ].map((q) => (
          <Grid key={q.to} size={{ xs: 6, md: 3 }}>
            <Button fullWidth variant="outlined" onClick={() => navigate(q.to)} startIcon={q.icon} sx={{ justifyContent: 'flex-start', py: 1.5, bgcolor: '#fff' }}>
              {q.label}
            </Button>
          </Grid>
        ))}
      </Grid>

      <Section
        title="Availability now"
        action={
          buildings.length > 1 ? (
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel id="dash-building">Building</InputLabel>
              <Select labelId="dash-building" label="Building" value={buildingId ?? ''} onChange={(e) => dispatch(setBuilding(e.target.value))}>
                {buildings.map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : undefined
        }
      >
        <Grid container spacing={2}>
          {isLoading || !data ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Grid key={i} size={{ xs: 6, md: 3 }}>
                <Skeleton variant="rounded" height={88} />
              </Grid>
            ))
          ) : (
            <>
              <Grid size={{ xs: 6, md: 3 }}>
                <StatTile label="Available seats" value={data.availability.availableSeats} total={data.availability.totalSeats} color="success.main" />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <StatTile label="Available rooms" value={data.availability.availableRooms} total={data.availability.totalRooms} color="success.main" />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <StatTile label="Checked in now" value={data.availability.checkedInNow} />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <StatTile label="Reserved (next hour)" value={data.availability.reservedNow} />
              </Grid>
            </>
          )}
        </Grid>
      </Section>

      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h3" component="h2" gutterBottom>
                Explore your workplace
              </Typography>
              <BuildingPreview building={building} />
              <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }} useFlexGap>
                <Button variant="contained" startIcon={<ViewInArRoundedIcon />} onClick={() => navigate('/explore')}>
                  Explore building
                </Button>
                <Button variant="outlined" onClick={() => navigate('/book-seat')}>
                  Book a seat
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h3" component="h2" gutterBottom>
                Next booking
              </Typography>
              {isLoading ? (
                <Skeleton variant="rounded" height={120} />
              ) : next ? (
                <Box>
                  <Chip size="small" color="primary" label={`Starts ${fmtRelative(next.startAt)}`} sx={{ mb: 1 }} />
                  <BookingCard booking={next} onOpen={(b) => navigate(`/bookings/${b.id}`)} compact />
                </Box>
              ) : (
                <EmptyState compact title="Nothing scheduled" description="Book a desk or a meeting room to see it here." actionLabel="Book a seat" onAction={() => navigate('/book-seat')} />
              )}
              {data && data.today.meetings.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Today's meetings
                  </Typography>
                  <Stack spacing={0.5}>
                    {data.today.meetings.map((m) => (
                      <Stack key={m.id} direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="body2" noWrap>
                          {fmtTime(m.startAt, m.timezone)} · {m.title ?? m.resourceName} ({m.resourceName})
                        </Typography>
                        <Button size="small" onClick={() => navigate(`/bookings/${m.id}`)}>
                          Details
                        </Button>
                      </Stack>
                    ))}
                  </Stack>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Section title="Upcoming bookings" action={<Button size="small" onClick={() => navigate('/bookings')}>See all</Button>}>
        {isLoading ? (
          <Skeleton variant="rounded" height={140} />
        ) : data && data.upcoming.length ? (
          <StaggerList>
            <Grid container spacing={2}>
              {data.upcoming.slice(0, 4).map((b) => (
                <Grid key={b.id} size={{ xs: 12, sm: 6, lg: 3 }}>
                  <StaggerItem>
                    <BookingCard booking={b} onOpen={(x) => navigate(`/bookings/${x.id}`)} compact />
                  </StaggerItem>
                </Grid>
              ))}
            </Grid>
          </StaggerList>
        ) : (
          <EmptyState compact title="No upcoming bookings" description="Your future desk and room bookings will appear here." />
        )}
      </Section>

      {data && data.suggestedSeats.length > 0 && (
        <Section title="Suggested seats for you" action={<Typography variant="caption" color="text.secondary">Based on favorites and recent bookings</Typography>}>
          <Grid container spacing={2}>
            {data.suggestedSeats.map((r) => (
              <Grid key={r.id} size={{ xs: 12, sm: 6, lg: 3 }}>
                <ResourceCard resource={r} onSelect={() => setBookResource(r)} onBook={(x) => setBookResource(x)} dense />
              </Grid>
            ))}
          </Grid>
        </Section>
      )}

      {data && data.favorites.length > 0 && (
        <Section title="Favorite workspaces">
          <Grid container spacing={2}>
            {data.favorites.map((r) => (
              <Grid key={r.id} size={{ xs: 12, sm: 6, lg: 3 }}>
                <ResourceCard resource={r} onSelect={() => setBookResource(r)} dense />
              </Grid>
            ))}
          </Grid>
        </Section>
      )}

      {data && data.recentResources.length > 0 && (
        <Section title="Recently used">
          <Grid container spacing={2}>
            {data.recentResources.slice(0, 4).map((r) => (
              <Grid key={r.id} size={{ xs: 12, sm: 6, lg: 3 }}>
                <ResourceCard resource={r} onSelect={() => setBookResource(r)} dense />
              </Grid>
            ))}
          </Grid>
        </Section>
      )}

      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Section title="Office announcements">
            {data && data.announcements.length ? (
              <Stack spacing={1}>
                {data.announcements.map((a) => (
                  <Card key={a.id}>
                    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                        <CampaignRoundedIcon color="primary" fontSize="small" sx={{ mt: 0.25 }} />
                        <Box>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            {a.title}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {a.body}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {fmtRelative(a.publishedAt)}
                          </Typography>
                        </Box>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            ) : (
              <EmptyState compact icon={<CampaignRoundedIcon />} title="No announcements" />
            )}
          </Section>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Section
            title="Recent history"
            action={
              data && data.unreadNotifications > 0 ? (
                <Button size="small" startIcon={<NotificationsRoundedIcon />} onClick={() => navigate('/notifications')}>
                  {data.unreadNotifications} unread notification{data.unreadNotifications > 1 ? 's' : ''}
                </Button>
              ) : undefined
            }
          >
            {data && data.recent.length ? (
              <Stack spacing={1}>
                {data.recent.map((b) => (
                  <Card key={b.id}>
                    <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                            {b.resourceName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {dayjs(b.startAt).tz(b.timezone).format('ddd D MMM, HH:mm')} · {b.buildingName}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                          <StatusBadge status={b.status} />
                          <Button size="small" onClick={() => navigate(`/bookings/${b.id}`)}>
                            Open
                          </Button>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            ) : (
              <EmptyState compact title="No past bookings yet" />
            )}
          </Section>
        </Grid>
      </Grid>

      <BookingDialog open={!!bookResource} resource={bookResource} startAt={startAt} endAt={endAt} onClose={() => setBookResource(null)} />
    </PageTransition>
  );
}
