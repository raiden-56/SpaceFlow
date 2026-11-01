import { useMemo, useState, type ReactNode } from 'react';
import { Box, Checkbox, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TableSortLabel, Typography } from '@mui/material';
import { TableSkeleton } from '@/components/common/Feedback';
import { EmptyState } from '@/components/common/EmptyState';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Enables client-side sorting by this accessor. */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Server-side pagination: total count + controlled page/pageSize. Omit for client-side paging. */
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  onRowClick?: (row: T) => void;
  dense?: boolean;
  'data-testid'?: string;
  ariaLabel: string;
}

export function DataTable<T>({ rows, columns, rowKey, loading, emptyTitle = 'Nothing here yet', emptyDescription, total, page, pageSize, onPageChange, onPageSizeChange, selectable, selected, onSelectedChange, onRowClick, dense, ariaLabel, ...rest }: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [localPage, setLocalPage] = useState(0);
  const [localSize, setLocalSize] = useState(25);
  const serverPaged = total !== undefined && page !== undefined && pageSize !== undefined;

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    return [...rows].sort((a, b) => {
      const av = sv(a);
      const bv = sv(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir, columns]);

  const visible = serverPaged ? sorted : sorted.slice(localPage * localSize, localPage * localSize + localSize);
  const allSelected = selectable && visible.length > 0 && visible.every((r) => selected?.has(rowKey(r)));
  const someSelected = selectable && visible.some((r) => selected?.has(rowKey(r)));

  const toggleAll = () => {
    if (!onSelectedChange) return;
    const next = new Set(selected);
    if (allSelected) visible.forEach((r) => next.delete(rowKey(r)));
    else visible.forEach((r) => next.add(rowKey(r)));
    onSelectedChange(next);
  };

  if (loading) return <TableSkeleton />;

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }} data-testid={rest['data-testid']}>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size={dense ? 'small' : 'medium'} aria-label={ariaLabel} stickyHeader>
          <TableHead>
            <TableRow>
              {selectable && (
                <TableCell padding="checkbox">
                  <Checkbox indeterminate={!!someSelected && !allSelected} checked={!!allSelected} onChange={toggleAll} slotProps={{ input: { 'aria-label': 'Select all rows' } }} />
                </TableCell>
              )}
              {columns.map((c) => (
                <TableCell key={c.key} align={c.align} sx={{ width: c.width, whiteSpace: 'nowrap' }} sortDirection={sortKey === c.key ? sortDir : false}>
                  {c.sortValue ? (
                    <TableSortLabel active={sortKey === c.key} direction={sortKey === c.key ? sortDir : 'asc'} onClick={() => { if (sortKey === c.key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortKey(c.key); setSortDir('asc'); } }}>
                      {c.header}
                    </TableSortLabel>
                  ) : (
                    c.header
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + (selectable ? 1 : 0)}>
                  <EmptyState compact title={emptyTitle} description={emptyDescription} />
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => {
                const key = rowKey(row);
                const isSel = !!selected?.has(key);
                return (
                  <TableRow
                    key={key}
                    hover
                    selected={isSel}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row); } } : undefined}
                    sx={{ cursor: onRowClick ? 'pointer' : 'default', '&:focus-visible': { outline: '2px solid #2563EB', outlineOffset: -2 } }}
                  >
                    {selectable && (
                      <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={isSel} onChange={() => { const next = new Set(selected); if (isSel) next.delete(key); else next.add(key); onSelectedChange?.(next); }} slotProps={{ input: { 'aria-label': `Select row ${key}` } }} />
                      </TableCell>
                    )}
                    {columns.map((c) => (
                      <TableCell key={c.key} align={c.align}>
                        {c.render(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {serverPaged ? (
        <TablePagination component="div" count={total} page={Math.max(0, page - 1)} rowsPerPage={pageSize} onPageChange={(_e, p) => onPageChange?.(p + 1)} onRowsPerPageChange={(e) => onPageSizeChange?.(Number(e.target.value))} rowsPerPageOptions={[10, 20, 50, 100]} />
      ) : rows.length > localSize ? (
        <TablePagination component="div" count={rows.length} page={localPage} rowsPerPage={localSize} onPageChange={(_e, p) => setLocalPage(p)} onRowsPerPageChange={(e) => { setLocalSize(Number(e.target.value)); setLocalPage(0); }} rowsPerPageOptions={[10, 25, 50, 100]} />
      ) : null}
      {selectable && selected && selected.size > 0 && (
        <Box sx={{ px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" aria-live="polite">
            {selected.size} selected
          </Typography>
        </Box>
      )}
    </Paper>
  );
}
