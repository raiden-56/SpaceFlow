// Analytics & reports. All figures come from GET /admin/analytics/overview. Definitions are shown
// next to the charts so reservation data is never presented as measured physical occupancy.
import { Alert, Box, Button, Card, CardContent, Grid, LinearProgress, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import type { AdminOverviewDto } from '@spaceflow/shared';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { ErrorState, GridSkeleton } from '@/components/common/Feedback';
import { useAnalyticsOverviewQuery } from '@/services/endpoints';
import { dayjs } from '@/utils/time';
import { AnalyticsFilters, useAnalyticsRange } from './components/AnalyticsFilters';
import { Bars, ChartCard, Lines, SERIES, StackedBars, StatTile } from './components/charts';

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
}

function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function avg(values: number[]) {
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0;
}

function UtilBar({ value }: { value: number }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 140 }}>
      <LinearProgress variant="determinate" value={Math.min(100, value)} sx={{ flex: 1, height: 8, borderRadius: 4, bgcolor: '#EEF2FF', '& .MuiLinearProgress-bar': { bgcolor: SERIES[0], borderRadius: 4 } }} aria-hidden />
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', width: 48, textAlign: 'right' }}>
        {value}%
      </Typography>
    </Stack>
  );
}

export function AdminAnalyticsPage() {
  const [range, setRange] = useAnalyticsRange(30);
  const { data, isLoading, error, refetch, isFetching } = useAnalyticsOverviewQuery(range);
  const fmtDay = (d: string) => dayjs(d).format('D MMM');

  return (
    <PageTransition>
      <PageHeader
        title="Analytics & reports"
        subtitle="Utilization, demand and attendance for the selected building and period."
        crumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Analytics & reports' }]}
        actions={
          data ? (
            <Button variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={() => downloadCsv(`spaceflow-utilization-${data.range.from}-${data.range.to}.csv`, data.utilization.map((u, i) => ({ date: u.date, seatUtilizationPct: u.seatUtilization, roomUtilizationPct: u.roomUtilization, seatBookings: data.bookingVolume[i]?.seats ?? 0, roomBookings: data.bookingVolume[i]?.rooms ?? 0 })))}>
              Export daily report
            </Button>
          ) : undefined
        }
      />
      <AnalyticsFilters value={range} onChange={setRange} />
      {isFetching && !isLoading && <LinearProgress sx={{ mb: 1 }} aria-label="Refreshing" />}
      {isLoading ? (
        <GridSkeleton count={6} height={200} />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : data ? (
        <Report data={data} fmtDay={fmtDay} />
      ) : null}
    </PageTransition>
  );
}

function Report({ data, fmtDay }: { data: AdminOverviewDto; fmtDay: (d: string) => string }) {
  const seatAvg = avg(data.utilization.map((u) => u.seatUtilization));
  const roomAvg = avg(data.utilization.map((u) => u.roomUtilization));
  const peak = [...data.peakHours].sort((a, b) => b.count - a.count)[0];
  const unused = data.rates.noShows;
  return (
    <Stack spacing={2}>
      <Alert severity="info" icon={false}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          How these numbers are defined
        </Typography>
        <Typography variant="caption" component="div">
          <strong>Reservation utilization</strong> = booked hours ÷ (bookable resources × 12 core hours) per day. It measures demand, not physical presence.{' '}
          <strong>Actual usage</strong> is based on check-ins only: the check-in rate is the share of finished bookings that required check-in and were checked in.{' '}
          <strong>Unused reservations</strong> are no-shows plus bookings released automatically after the grace period. SpaceFlow has no occupancy sensors, so no figure here is measured occupancy.
        </Typography>
      </Alert>

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}><StatTile label="Avg seat utilization" value={`${seatAvg}%`} hint="reservation-based" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatTile label="Avg room utilization" value={`${roomAvg}%`} hint="reservation-based" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatTile label="Check-in rate" value={`${data.rates.checkInRate}%`} hint={`${data.rates.checkedIn} of ${data.rates.checkInRequired} bookings`} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatTile label="Unused reservations" value={unused} hint={`${data.rates.noShowRate}% no-show rate`} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatTile label="Total reservations" value={data.rates.totalBookings} hint={`${data.range.from} → ${data.range.to}`} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatTile label="Cancellation rate" value={`${data.rates.cancellationRate}%`} hint={`${data.rates.cancelled} cancelled`} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatTile label="Peak start hour" value={peak && peak.count ? `${String(peak.hour).padStart(2, '0')}:00` : '–'} hint={peak?.count ? `${peak.count} bookings` : 'no bookings'} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatTile label="Checked in now" value={data.today.checkedIn} hint="live, from check-ins" /></Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <ChartCard title="Seat utilization" subtitle="Daily reservation utilization of desks" empty={!data.utilization.some((u) => u.seatUtilization)}>
            <Lines data={data.utilization.map((u) => ({ day: fmtDay(u.date), value: u.seatUtilization }))} xKey="day" unit="%" domain={[0, 100]} series={[{ key: 'value', name: 'Seats', color: SERIES[0] }]} />
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <ChartCard title="Meeting room utilization" subtitle="Daily reservation utilization of rooms" empty={!data.utilization.some((u) => u.roomUtilization)}>
            <Lines data={data.utilization.map((u) => ({ day: fmtDay(u.date), value: u.roomUtilization }))} xKey="day" unit="%" domain={[0, 100]} series={[{ key: 'value', name: 'Rooms', color: SERIES[1] }]} />
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <ChartCard title="Occupancy trend (reservations)" subtitle="Reservations per day by type" empty={!data.bookingVolume.some((d) => d.seats || d.rooms)}>
            <StackedBars data={data.bookingVolume.map((d) => ({ ...d, day: fmtDay(d.date) }))} xKey="day" series={[{ key: 'seats', name: 'Seats', color: SERIES[0] }, { key: 'rooms', name: 'Rooms', color: SERIES[1] }]} />
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <ChartCard title="Peak booking hours" subtitle="Reservations by local start hour" empty={!data.peakHours.some((p) => p.count)}>
            <Bars data={data.peakHours.map((p) => ({ hour: `${String(p.hour).padStart(2, '0')}`, count: p.count }))} xKey="hour" series={{ key: 'count', name: 'Bookings' }} />
          </ChartCard>
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h5" component="h3">Floor-level utilization</Typography>
              <Typography variant="caption" color="text.secondary">Booked desk hours ÷ (desks × 12 h × days)</Typography>
              <TableContainer sx={{ mt: 1 }}>
                <Table size="small" aria-label="Floor utilization">
                  <TableHead>
                    <TableRow>
                      <TableCell>Floor</TableCell>
                      <TableCell align="right">Desks</TableCell>
                      <TableCell align="right">Booked h</TableCell>
                      <TableCell>Utilization</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.floorUtilization.length === 0 && (
                      <TableRow><TableCell colSpan={4}><Typography variant="body2" color="text.secondary">No desks in scope.</Typography></TableCell></TableRow>
                    )}
                    {data.floorUtilization.map((f) => (
                      <TableRow key={f.floorId}>
                        <TableCell>{f.floorName}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{f.buildingName}</Typography></TableCell>
                        <TableCell align="right">{f.seats}</TableCell>
                        <TableCell align="right">{f.bookedHours}</TableCell>
                        <TableCell><UtilBar value={f.utilization} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Stack spacing={2}>
            <Card>
              <CardContent>
                <Typography variant="h5" component="h3">Building comparison</Typography>
                <Table size="small" aria-label="Building comparison" sx={{ mt: 1 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Building</TableCell>
                      <TableCell align="right">Bookings</TableCell>
                      <TableCell>Desk utilization</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.buildingComparison.map((b) => (
                      <TableRow key={b.buildingId}>
                        <TableCell>{b.buildingName}</TableCell>
                        <TableCell align="right">{b.bookings}</TableCell>
                        <TableCell><UtilBar value={b.utilization} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Typography variant="h5" component="h3">Popular resources</Typography>
                <Table size="small" aria-label="Popular resources" sx={{ mt: 1 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Resource</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell align="right">Bookings</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.topResources.length === 0 && <TableRow><TableCell colSpan={3}><Typography variant="body2" color="text.secondary">No bookings in this period.</Typography></TableCell></TableRow>}
                    {data.topResources.map((r) => (
                      <TableRow key={r.resourceId}>
                        <TableCell>{r.name} <Typography component="span" variant="caption" color="text.secondary">{r.code}</Typography></TableCell>
                        <TableCell>{r.type === 'SEAT' ? 'Desk' : 'Room'}</TableCell>
                        <TableCell align="right">{r.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </Stack>
        </Grid>
      </Grid>
      <Box />
    </Stack>
  );
}
