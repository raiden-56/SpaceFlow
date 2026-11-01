import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ContentOutlet } from '@/components/common/ContentOutlet';
import { AppBar, Box, Chip, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, Typography, useMediaQuery, useTheme, Divider } from '@mui/material';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded';
import DesktopWindowsRoundedIcon from '@mui/icons-material/DesktopWindowsRounded';
import MeetingRoomRoundedIcon from '@mui/icons-material/MeetingRoomRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import EventNoteRoundedIcon from '@mui/icons-material/EventNoteRounded';
import PolicyRoundedIcon from '@mui/icons-material/PolicyRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded';
import ExtensionRoundedIcon from '@mui/icons-material/ExtensionRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import type { Permission } from '@spaceflow/shared';
import { useAuth } from '@/hooks/useAuth';
import { Logo, UserMenu, SIDEBAR_WIDTH } from './EmployeeLayout';
import { NotificationBell } from '@/components/common/NotificationBell';
import { useRealtime } from '@/services/realtime';
import { useGuardedNavigate } from '@/hooks/useLeaveGuard';
import { GuestBanner } from '@/components/common/GuestBanner';

const NAV: { to: string; label: string; icon: React.ReactNode; perm: Permission }[] = [
  { to: '/admin', label: 'Overview', icon: <DashboardRoundedIcon />, perm: 'analytics:read' },
  { to: '/admin/buildings', label: 'Buildings & Floors', icon: <ApartmentRoundedIcon />, perm: 'building:manage' },
  { to: '/admin/map-studio', label: '3D Map Studio', icon: <ViewInArRoundedIcon />, perm: 'floorplan:manage' },
  { to: '/admin/seats', label: 'Seat Management', icon: <DesktopWindowsRoundedIcon />, perm: 'resource:manage' },
  { to: '/admin/meeting-rooms', label: 'Meeting Rooms', icon: <MeetingRoomRoundedIcon />, perm: 'resource:manage' },
  { to: '/admin/employees', label: 'Employees & Teams', icon: <PeopleAltRoundedIcon />, perm: 'user:manage' },
  { to: '/admin/reservations', label: 'Reservations', icon: <EventNoteRoundedIcon />, perm: 'reservation:manage-any' },
  { to: '/admin/policies', label: 'Booking Policies', icon: <PolicyRoundedIcon />, perm: 'policy:manage' },
  { to: '/admin/analytics', label: 'Analytics & Reports', icon: <InsightsRoundedIcon />, perm: 'analytics:read' },
  { to: '/admin/notifications', label: 'Notifications', icon: <CampaignRoundedIcon />, perm: 'building:manage' },
  { to: '/admin/audit', label: 'Audit Log', icon: <HistoryRoundedIcon />, perm: 'audit:read' },
  { to: '/admin/integrations', label: 'Integrations', icon: <ExtensionRoundedIcon />, perm: 'integration:manage' },
  { to: '/admin/settings', label: 'Settings', icon: <SettingsRoundedIcon />, perm: 'settings:manage' },
];

export function adminNavFor(can: (p: Permission) => boolean) {
  return NAV.filter((n) => can(n.perm));
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const navigate = useGuardedNavigate();
  const { can } = useAuth();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: '#0F172A', color: '#CBD5E1' }}>
      <Toolbar sx={{ px: 2, color: '#fff' }}>
        <Logo />
      </Toolbar>
      <Box sx={{ px: 2, pb: 1 }}>
        <Chip label="Admin portal" size="small" sx={{ bgcolor: 'rgba(129,140,248,0.2)', color: '#C7D2FE', fontWeight: 700 }} />
      </Box>
      <List component="nav" aria-label="Admin navigation" sx={{ px: 1, flex: 1 }}>
        {adminNavFor(can).map((n) => {
          const selected = n.to === '/admin' ? pathname === '/admin' : pathname.startsWith(n.to);
          return (
            <ListItemButton key={n.to} selected={selected} aria-current={selected ? 'page' : undefined} onClick={() => { if (navigate(n.to)) onNavigate?.(); }} sx={{ mb: 0.25, minHeight: 42, color: selected ? '#fff' : '#CBD5E1', '&.Mui-selected': { bgcolor: 'rgba(79,70,229,0.5)', color: '#fff', '& .MuiListItemIcon-root': { color: '#fff' } }, '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' } }}>
              <ListItemIcon sx={{ minWidth: 36, color: selected ? '#fff' : '#94A3B8' }}>{n.icon}</ListItemIcon>
              <ListItemText primary={n.label} slotProps={{ primary: { sx: { fontSize: 14, fontWeight: selected ? 600 : 500 } } }} />
            </ListItemButton>
          );
        })}
      </List>
      <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />
      <ListItemButton onClick={() => { if (navigate('/')) onNavigate?.(); }} sx={{ m: 1, color: '#CBD5E1', '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' } }}>
        <ListItemIcon sx={{ minWidth: 36, color: '#94A3B8' }}>
          <ArrowBackRoundedIcon />
        </ListItemIcon>
        <ListItemText primary="Back to employee portal" slotProps={{ primary: { sx: { fontSize: 13, fontWeight: 600 } } }} />
      </ListItemButton>
    </Box>
  );
}

export function AdminLayout() {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const [open, setOpen] = useState(false);
  useRealtime();
  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
      {mobile ? (
        <Drawer open={open} onClose={() => setOpen(false)} slotProps={{ paper: { sx: { width: SIDEBAR_WIDTH, border: 0 } } }}>
          <Sidebar onNavigate={() => setOpen(false)} />
        </Drawer>
      ) : (
        <Box component="aside" sx={{ width: SIDEBAR_WIDTH, flexShrink: 0, position: 'sticky', top: 0, height: '100dvh' }}>
          <Sidebar />
        </Box>
      )}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <GuestBanner />
        <AppBar color="inherit" elevation={0} sx={{ position: 'sticky', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Toolbar sx={{ gap: 1.5, px: { xs: 1.5, md: 3 } }}>
            {mobile && (
              <IconButton edge="start" onClick={() => setOpen(true)} aria-label="Open admin navigation">
                <MenuRoundedIcon />
              </IconButton>
            )}
            <Typography variant="subtitle2" sx={{ flex: 1 }}>
              Workplace administration
            </Typography>
            <NotificationBell />
            <UserMenu />
          </Toolbar>
        </AppBar>
        <Box component="main" id="main" sx={{ flex: 1, p: { xs: 2, md: 3 }, maxWidth: 1600, width: '100%', mx: 'auto' }}>
          <ContentOutlet />
        </Box>
      </Box>
    </Box>
  );
}
