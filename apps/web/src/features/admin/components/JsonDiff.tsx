import { Box, Stack, Typography } from '@mui/material';

function flatten(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (value === null || value === undefined) {
    if (prefix) out[prefix] = String(value);
    return out;
  }
  if (Array.isArray(value)) {
    out[prefix || 'value'] = JSON.stringify(value);
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out[prefix || 'value'] = String(value);
  return out;
}

/** Side-by-side before/after view with changed keys highlighted. */
export function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  const b = flatten(before ?? {});
  const a = flatten(after ?? {});
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  if (!keys.length) return <Typography variant="body2" color="text.secondary">No details recorded.</Typography>;
  return (
    <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, '& td, & th': { p: 0.75, borderBottom: '1px solid', borderColor: 'divider', verticalAlign: 'top', textAlign: 'left' } }} aria-label="Change details">
      <thead>
        <tr>
          <th>Field</th>
          <th>Before</th>
          <th>After</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const changed = b[k] !== a[k];
          return (
            <tr key={k} style={{ background: changed ? 'rgba(245,158,11,0.08)' : undefined }}>
              <td>
                <code>{k}</code>
              </td>
              <td style={{ wordBreak: 'break-word', color: changed ? '#B91C1C' : undefined }}>{b[k] ?? '—'}</td>
              <td style={{ wordBreak: 'break-word', color: changed ? '#15803D' : undefined }}>{a[k] ?? '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </Box>
  );
}

export function KeyValue({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <Stack spacing={0.75}>
      {items.map((i) => (
        <Stack key={i.label} direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 110 }}>
            {i.label}
          </Typography>
          <Typography variant="body2" sx={{ textAlign: 'right', wordBreak: 'break-word' }}>
            {i.value ?? '—'}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}
