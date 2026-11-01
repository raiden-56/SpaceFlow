import { useNavigate } from 'react-router-dom';
import { Button, Grid, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { ErrorState, GridSkeleton } from '@/components/common/Feedback';
import { useAnalyticsOverviewQuery } from '@/services/endpoints';
import { AnalyticsFilters, useAnalyticsRange } from './components/AnalyticsFilters';
import { Bars, ChartCard, Lines, SERIES, StackedBars, StatTile } from './components/charts';
import { dayjs } from '@/utils/time';

export function AdminOverviewPage() {
  const [range, setRange] = useAnalyticsRange(30);
  const { data, isLoading, error, refetch } = useAnalyticsOverviewQuery(range);
  const navigate = useNavigate();
  const fmtDay = (d: string) => dayjs(d).format('D MMM');

  return (
    <PageTransition>
      <PageHeader title="Overview" subtitle="Workplace at a glance: inventory, today's reservations and utilization over the selected period." crumbs={[{ label: 'Admin' }, { label: 'Overview' }]} actions={<Button variant="outlined" onClick={() => navigate('/admin/analytics')}>Full reports</Button>} />
      <AnalyticsFilters value={range} onChange={setRange} />
      {isLoading ? (
        <GridSkeleton count={8} height={120} />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : data ? (
        <Stack spacing={2}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, md: 3, xl: 2 }}><StatTile label="Buildings" value={data.totals.buildings} hint={`${data.totals.floors} floors`} /></Grid>
            <Grid size={{ xs: 6, md: 3, xl: 2 }}><StatTile label="Bookable seats" value={data.totals.seats} hint={`${data.today.availableSeats} free right now`} /></Grid>
            <Grid size={{ xs: 6, md: 3, xl: 2 }}><StatTile label="Meeting rooms" value={data.totals.rooms} hint={`${data.today.availableRooms} free right now`} /></Grid>
            <Grid size={{ xs: 6, md: 3, xl: 2 }}><StatTile label="Employees" value={data.totals.employees} hint="active accounts" /></Grid>
            <Grid size={{ xs: 6, md: 3, xl: 2 }}><StatTile label="Reserved today" value={`${data.today.reservedSeats} / ${data.today.reservedRooms}`} hint="seats / rooms" /></Grid>
            <Grid size={{ xs: 6, md: 3, xl: 2 }}><StatTile label="Checked in now" value={data.today.checkedIn} hint="actual presence (check-ins)" color={data.today.checkedIn ? '#15803D' : undefined} /></Grid>
          </Grid>
          {data.today.pendingApprovals > 0 && (
            <Button variant="outlined" color="warning" onClick={() => navigate('/approvals')} sx={{ alignSelf: 'flex-start' }}>
              {data.today.pendingApprovals} booking request{data.today.pendingApprovals > 1 ? 's' : ''} awaiting approval
            </Button>
          )}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, lg: 7 }}>
              <ChartCard title="Booking volume" subtitle="Reservations created per day (seats vs rooms)" empty={!data.bookingVolume.some((d) => d.seats || d.rooms)}>
                <StackedBars data={data.bookingVolume.map((d) => ({ ...d, day: fmtDay(d.date) }))} xKey="day" series={[{ key: 'seats', name: 'Seats', color: SERIES[0] }, { key: 'rooms', name: 'Rooms', color: SERIES[1] }]} />
              </ChartCard>
            </Grid>
            <Grid size={{ xs: 12, lg: 5 }}>
              <ChartCard title="Reservation utilization" subtitle="Booked hours ÷ (resources × 12 core hours), per day" empty={!data.utilization.some((d) => d.seatUtilization || d.roomUtilization)}>
                <Lines data={data.utilization.map((d) => ({ ...d, day: fmtDay(d.date) }))} xKey="day" unit="%" domain={[0, 100]} series={[{ key: 'seatUtilization', name: 'Seats', color: SERIES[0] }, { key: 'roomUtilization', name: 'Rooms', color: SERIES[1] }]} />
              </ChartCard>
            </Grid>
            <Grid size={{ xs: 12, md: 6, lg: 4 }}>
              <ChartCard title="Peak booking hours" subtitle="Start hour of reservations in the period" empty={!data.peakHours.some((p) => p.count)}>
                <Bars data={data.peakHours.map((p) => ({ hour: `${String(p.hour).padStart(2, '0')}:00`, count: p.count }))} xKey="hour" series={{ key: 'count', name: 'Bookings' }} />
              </ChartCard>
            </Grid>
            <Grid size={{ xs: 12, md: 6, lg: 4 }}>
              <ChartCard title="Rates" subtitle={`${data.rates.totalBookings} reservations in period`} height={200}>
                <Stack spacing={1.5} sx={{ pt: 1 }}>
                  <Rate label="Cancellation rate" value={data.rates.cancellationRate} detail={`${data.rates.cancelled} cancelled`} />
                  <Rate label="Check-in rate" value={data.rates.checkInRate} detail={`${data.rates.checkedIn} of ${data.rates.checkInRequired} finished bookings that required check-in`} good />
                  <Rate label="No-show rate" value={data.rates.noShowRate} detail={`${data.rates.noShows} no-shows / released`} />
                </Stack>
              </ChartCard>
            </Grid>
            <Grid size={{ xs: 12, lg: 4 }}>
              <ChartCard title="Most booked resources" height={200} empty={!data.topResources.length}>
                <Table size="small" aria-label="Top resources">
                  <TableHead>
                    <TableRow>
                      <TableCell>Resource</TableCell>
                      <TableCell align="right">Bookings</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.topResources.slice(0, 6).map((r) => (
                      <TableRow key={r.resourceId}>
                        <TableCell>{r.name} <Typography component="span" variant="caption" color="text.secondary">{r.code}</Typography></TableCell>
                        <TableCell align="right">{r.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ChartCard>
            </Grid>
          </Grid>
        </Stack>
      ) : null}
    </PageTransition>
  );
}

function Rate({ label, value, detail, good }: { label: string; value: number; detail: string; good?: boolean }) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
      <div>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
        <Typography variant="caption" color="text.secondary">{detail}</Typography>
      </div>
      <Typography variant="h3" sx={{ fontVariantNumeric: 'tabular-nums', color: good ? (value >= 70 ? '#15803D' : value >= 40 ? '#B45309' : '#B91C1C') : value <= 10 ? '#15803D' : value <= 25 ? '#B45309' : '#B91C1C' }}>
        {value}%
      </Typography>
    </Stack>
  );
}
