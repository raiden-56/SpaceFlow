import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, CircularProgress, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Paper, Popper, TextField, Typography, ClickAwayListener } from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import LayersRoundedIcon from '@mui/icons-material/LayersRounded';
import DesktopWindowsRoundedIcon from '@mui/icons-material/DesktopWindowsRounded';
import MeetingRoomRoundedIcon from '@mui/icons-material/MeetingRoomRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded';
import ExtensionRoundedIcon from '@mui/icons-material/ExtensionRounded';
import { useNavigate } from 'react-router-dom';
import { useLazySearchQuery } from '@/services/endpoints';
import { useAppDispatch } from '@/store';
import { focusResource, setBuilding, setFloor } from '@/store/bookingSlice';
import type { SearchResultsDto } from '@spaceflow/shared';

interface Item {
  key: string;
  group: string;
  icon: React.ReactNode;
  primary: string;
  secondary?: string;
  onPick: () => void;
}

export function GlobalSearch({ fullWidth }: { fullWidth?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const anchor = useRef<HTMLDivElement>(null);
  const [trigger, { data, isFetching }] = useLazySearchQuery();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  // Debounced search with request de-duplication (RTK Query caches identical args).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(() => void trigger({ q: term, limit: 6 }, true), 250);
    return () => clearTimeout(t);
  }, [q, trigger]);

  const items = useMemo<Item[]>(() => {
    if (!data || q.trim().length < 2) return [];
    const r: SearchResultsDto = data;
    const goResource = (res: { id: string; buildingId: string; floorId: string }) => {
      dispatch(focusResource({ buildingId: res.buildingId, floorId: res.floorId, resourceId: res.id }));
      navigate('/explore');
    };
    return [
      ...r.buildings.map((b) => ({ key: `b${b.id}`, group: 'Buildings', icon: <ApartmentRoundedIcon fontSize="small" />, primary: b.name, secondary: [b.code, b.city].filter(Boolean).join(' · '), onPick: () => { dispatch(setBuilding(b.id)); navigate('/explore'); } })),
      ...r.floors.map((f) => ({ key: `f${f.id}`, group: 'Floors', icon: <LayersRoundedIcon fontSize="small" />, primary: f.name, secondary: f.buildingName, onPick: () => { dispatch(setBuilding(f.buildingId)); dispatch(setFloor(f.id)); navigate('/explore'); } })),
      ...r.seats.map((s) => ({ key: `s${s.id}`, group: 'Desks', icon: <DesktopWindowsRoundedIcon fontSize="small" />, primary: s.name, secondary: `${s.buildingName} · ${s.floorName}${s.zoneName ? ` · ${s.zoneName}` : ''}`, onPick: () => goResource(s) })),
      ...r.rooms.map((s) => ({ key: `r${s.id}`, group: 'Meeting rooms', icon: <MeetingRoomRoundedIcon fontSize="small" />, primary: s.name, secondary: `${s.buildingName} · ${s.floorName} · ${s.capacity} seats`, onPick: () => goResource(s) })),
      ...r.facilities.map((f) => ({ key: `fa${f.id}`, group: 'Facilities', icon: <PlaceRoundedIcon fontSize="small" />, primary: f.label, secondary: `${f.buildingName} · ${f.floorName}`, onPick: () => { dispatch(setBuilding(f.buildingId)); dispatch(setFloor(f.floorId)); navigate('/explore'); } })),
      ...r.amenities.map((a) => ({ key: `a${a.id}`, group: 'Amenities', icon: <ExtensionRoundedIcon fontSize="small" />, primary: a.name, secondary: `${a.resourceCount} resources`, onPick: () => navigate(`/book-seat?amenityIds=${a.id}`) })),
      ...r.employees.map((e) => ({ key: `e${e.id}`, group: 'Employees', icon: <PersonRoundedIcon fontSize="small" />, primary: e.displayName, secondary: [e.jobTitle, e.departmentName].filter(Boolean).join(' · '), onPick: () => navigate(`/directory?user=${e.id}`) })),
    ];
  }, [data, q, dispatch, navigate]);

  const pick = (it: Item) => {
    it.onPick();
    setOpen(false);
    setQ('');
  };

  let lastGroup = '';
  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Box ref={anchor} sx={{ width: fullWidth ? '100%' : { xs: '100%', md: 360 } }}>
        <TextField value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }} onFocus={() => q.trim().length >= 2 && setOpen(true)} onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Enter' && items[active]) { e.preventDefault(); pick(items[active]); }
            if (e.key === 'Escape') setOpen(false);
          }} placeholder="Search desks, rooms, floors, people…" size="small" slotProps={{ htmlInput: { 'aria-label': 'Search the office', 'aria-expanded': open, 'aria-controls': 'global-search-results', role: 'combobox', 'aria-autocomplete': 'list' }, input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: isFetching ? <CircularProgress size={16} /> : undefined,
            sx: { bgcolor: '#F8FAFC' },
          } }} />
        <Popper open={open && q.trim().length >= 2} anchorEl={anchor.current} placement="bottom-start" style={{ zIndex: 1300, width: anchor.current?.clientWidth }}>
          <Paper variant="outlined" sx={{ mt: 0.5, maxHeight: 420, overflow: 'auto', boxShadow: '0 12px 32px rgba(23,32,51,0.14)' }}>
            {items.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                {isFetching ? 'Searching…' : `No results for “${q.trim()}”`}
              </Typography>
            ) : (
              <List dense id="global-search-results" role="listbox" disablePadding>
                {items.map((it, i) => {
                  const header = it.group !== lastGroup ? <ListSubheader key={`h-${it.group}`} disableSticky sx={{ lineHeight: '28px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{it.group}</ListSubheader> : null;
                  lastGroup = it.group;
                  return (
                    <Box key={it.key}>
                      {header}
                      <ListItemButton role="option" aria-selected={i === active} selected={i === active} onClick={() => pick(it)} sx={{ py: 0.75 }}>
                        <ListItemIcon sx={{ minWidth: 32, color: 'primary.main' }}>{it.icon}</ListItemIcon>
                        <ListItemText primary={it.primary} secondary={it.secondary} slotProps={{ primary: { sx: { fontWeight: 500, fontSize: 14 } }, secondary: { sx: { fontSize: 12 } } }} />
                      </ListItemButton>
                    </Box>
                  );
                })}
              </List>
            )}
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
  );
}
