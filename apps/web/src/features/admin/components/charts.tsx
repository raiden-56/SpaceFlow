// Chart building blocks following the dataviz method: fixed categorical order (seats = indigo,
// rooms = sky, third = amber), status colors reserved for status, one axis per chart, thin marks
// with rounded ends, hover tooltips, recessive grid, legend for >= 2 series, table views elsewhere.
import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/common/EmptyState';

export const SERIES = ['#4F46E5', '#0EA5E9', '#F59E0B'] as const;
const INK = '#172033';
const MUTED = '#64748B';
const GRID = '#E2E8F0';

const axisProps = { tick: { fill: MUTED, fontSize: 11 }, axisLine: { stroke: GRID }, tickLine: false as const };
const tooltipStyle = { contentStyle: { borderRadius: 8, border: `1px solid ${GRID}`, fontSize: 12, color: INK }, labelStyle: { color: MUTED, fontSize: 11 } };

export function ChartCard({ title, subtitle, children, height = 260, action, empty }: { title: string; subtitle?: string; children: ReactNode; height?: number; action?: ReactNode; empty?: boolean }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }} spacing={1}>
          <Box>
            <Typography variant="h5" component="h3">
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          {action}
        </Stack>
        <Box sx={{ height, mt: 1.5 }} role="figure" aria-label={title}>
          {empty ? <EmptyState compact title="No data for this range" description="Try a wider date range or another building." /> : children}
        </Box>
      </CardContent>
    </Card>
  );
}

export interface SeriesDef {
  key: string;
  name: string;
  color?: string;
}

export function StackedBars({ data, series, xKey, unit }: { data: Record<string, unknown>[]; series: SeriesDef[]; xKey: string; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey={xKey} {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} allowDecimals={false} unit={unit} />
        <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(79,70,229,0.06)' }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: INK }} iconType="circle" iconSize={8} />}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color ?? SERIES[i % SERIES.length]} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} stroke="#fff" strokeWidth={1} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Bars({ data, series, xKey, unit }: { data: Record<string, unknown>[]; series: SeriesDef; xKey: string; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey={xKey} {...axisProps} minTickGap={16} />
        <YAxis {...axisProps} allowDecimals={false} unit={unit} />
        <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(79,70,229,0.06)' }} />
        <Bar dataKey={series.key} name={series.name} fill={series.color ?? SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Lines({ data, series, xKey, unit, domain }: { data: Record<string, unknown>[]; series: SeriesDef[]; xKey: string; unit?: string; domain?: [number, number] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey={xKey} {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} unit={unit} domain={domain} />
        <Tooltip {...tooltipStyle} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: INK }} iconType="circle" iconSize={8} />}
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color ?? SERIES[i % SERIES.length]} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function StatTile({ label, value, hint, color }: { label: string; value: ReactNode; hint?: string; color?: string }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ py: 2 }}>
        <Typography variant="subtitle2" component="div">
          {label}
        </Typography>
        <Typography variant="h2" component="div" sx={{ mt: 0.5, color: color ?? 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
