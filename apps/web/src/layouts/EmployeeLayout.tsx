import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ContentOutlet } from '@/components/common/ContentOutlet';
import { AppBar, Avatar, BottomNavigation, BottomNavigationAction, Box, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Toolbar, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import { motion } from 'framer-motion';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded';
import DesktopWindowsRoundedIcon from '@mui/icons-material/DesktopWindowsRounded';
import MeetingRoomRoundedIcon from '@mui/icons-material/MeetingRoomRounded';
import EventNoteRoundedIcon from '@mui/icons-material/EventNoteRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded';
import { useAuth } from '@/hooks/useAuth';
import { useLogoutMutation } from '@/services/endpoints';
import { GlobalSearch } from '@/components/common/GlobalSearch';
import { NotificationBell } from '@/components/common/NotificationBell';
import { useRealtime } from '@/services/realtime';
import { confirmLeave, useGuardedNavigate } from '@/hooks/useLeaveGuard';
import { GuestBanner } from '@/components/common/GuestBanner';

const NAV = [
  { to: '/', label: 'Home', icon: <HomeRoundedIcon /> },
  { to: '/explore', label: 'Explore Office', icon: <ViewInArRoundedIcon /> },
  { to: '/book-seat', label: 'Book a Seat', icon: <DesktopWindowsRoundedIcon /> },
  { to: '/meeting-rooms', label: 'Meeting Rooms', icon: <MeetingRoomRoundedIcon /> },
  { to: '/bookings', label: 'My Bookings', icon: <EventNoteRoundedIcon /> },
  { to: '/directory', label: 'Office Directory', icon: <PeopleAltRoundedIcon /> },
  { to: '/notifications', label: 'Notifications', icon: <NotificationsRoundedIcon /> },
  { to: '/settings', label: 'Profile & Settings', icon: <SettingsRoundedIcon /> },
];
const MOBILE_NAV = [NAV[0], NAV[2], NAV[1], NAV[3], NAV[4]];

export const SIDEBAR_WIDTH = 248;
export const SIDEBAR_COLLAPSED = 72;

export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', px: collapsed ? 0 : 0.5, justifyContent: collapsed ? 'center' : 'flex-start' }}>
      <Box aria-hidden sx={{ width: 34, height: 34, borderRadius: 2.5, background: 'linear-gradient(135deg,#4F46E5,#818CF8)', display: 'grid', placeItems: 'center', color: '#fff', flexShrink: 0 }}>
        <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
          <path d="M8 20l8-5 8 5-8 5z" fill="#fff" />
          <path d="M8 14l8-5 8 5-8 5z" fill="#fff" opacity=".6" />
        </svg>
      </Box>
      {!collapsed && (
        <Typography variant="h3" component="span" sx={{ letterSpacing: '-0.02em', fontWeight: 800 }}>
          SpaceFlow
        </Typography>
      )}
    </Stack>
  );
}

function SidebarContent({ collapsed, onNavigate, extra }: { collapsed: boolean; onNavigate?: () => void; extra?: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isAdmin, isApprover } = useAuth();
  const items = [...NAV, ...(isApprover && !isAdmin ? [{ to: '/approvals', label: 'Approvals', icon: <FactCheckRoundedIcon /> }] : [])];
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar sx={{ px: collapsed ? 1 : 2 }}>
        <Logo collapsed={collapsed} />
      </Toolbar>
      <List component="nav" aria-label="Main navigation" sx={{ px: 1, flex: 1 }}>
        {items.map((n) => {
          const selected = n.to === '/' ? pathname === '/' : pathname.startsWith(n.to);
          const btn = (
            <ListItemButton key={n.to} selected={selected} onClick={() => { navigate(n.to); onNavigate?.(); }} aria-current={selected ? 'page' : undefined} sx={{ mb: 0.5, justifyContent: collapsed ? 'center' : 'flex-start', px: collapsed ? 1.25 : 1.5, minHeight: 44 }}>
              <ListItemIcon sx={{ minWidth: collapsed ? 0 : 36, color: 'inherit' }}>{n.icon}</ListItemIcon>
              {!collapsed && <ListItemText primary={n.label} slotProps={{ primary: { sx: { fontWeight: selected ? 600 : 500, fontSize: 14 } } }} />}
            </ListItemButton>
          );
          return collapsed ? (
            <Tooltip key={n.to} title={n.label} placement="right">
              {btn}
            </Tooltip>
          ) : (
            btn
          );
        })}
      </List>
      {isAdmin && (
        <Box sx={{ px: 1, pb: 1 }}>
          <Divider sx={{ mb: 1 }} />
          <Tooltip title={collapsed ? 'Admin portal' : ''} placement="right">
            <ListItemButton onClick={() => { navigate('/admin'); onNavigate?.(); }} sx={{ justifyContent: collapsed ? 'center' : 'flex-start', px: collapsed ? 1.25 : 1.5, minHeight: 44 }}>
              <ListItemIcon sx={{ minWidth: collapsed ? 0 : 36 }}>
                <AdminPanelSettingsRoundedIcon />
              </ListItemIcon>
              {!collapsed && <ListItemText primary="Admin portal" slotProps={{ primary: { sx: { fontWeight: 600, fontSize: 14 } } }} />}
            </ListItemButton>
          </Tooltip>
        </Box>
      )}
      {extra}
    </Box>
  );
}

export function UserMenu() {
  const { user } = useAuth();
  const [logout] = useLogoutMutation();
  const navigate = useGuardedNavigate();
  const rawNavigate = useNavigate(); // already confirmed via confirmLeave() before logout
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  if (!user) return null;
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
  return (
    <>
      <Tooltip title="Account">
        <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label="Account menu" aria-haspopup="menu" sx={{ p: 0.5 }} data-testid="user-menu">
          <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 13, fontWeight: 700 }}>{initials}</Avatar>
        </IconButton>
      </Tooltip>
      <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} transformOrigin={{ horizontal: 'right', vertical: 'top' }} anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {user.displayName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {user.email}
          </Typography>
        </Box>
        <Divider />
        <MenuItem onClick={() => { setAnchor(null); navigate('/settings'); }}>
          <ListItemIcon>
            <SettingsRoundedIcon fontSize="small" />
          </ListItemIcon>
          Profile & settings
        </MenuItem>
        <MenuItem onClick={async () => { setAnchor(null); if (!confirmLeave()) return; await logout().unwrap().catch(() => undefined); rawNavigate('/login'); }} data-testid="logout">
          <ListItemIcon>
            <LogoutRoundedIcon fontSize="small" />
          </ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>
    </>
  );
}

export function EmployeeLayout() {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sf.sidebar') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useRealtime();
  const width = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH;
  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem('sf.sidebar', c ? 'expanded' : 'collapsed');
      return !c;
    });
  };
  const mobileValue = MOBILE_NAV.findIndex((n) => (n.to === '/' ? pathname === '/' : pathname.startsWith(n.to)));

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
      {!mobile && (
        <Box component={motion.aside} animate={{ width }} transition={{ duration: 0.22, ease: 'easeInOut' }} sx={{ flexShrink: 0, position: 'sticky', top: 0, height: '100dvh', borderRight: '1px solid', borderColor: 'divider', bgcolor: '#fff', overflow: 'hidden' }}>
          <SidebarContent
            collapsed={collapsed}
            extra={
              <Box sx={{ p: 1, display: 'flex', justifyContent: collapsed ? 'center' : 'flex-end' }}>
                <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
                  <IconButton onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} size="small">
                    <ChevronLeftRoundedIcon sx={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }} />
                  </IconButton>
                </Tooltip>
              </Box>
            }
          />
        </Box>
      )}
      {mobile && (
        <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} slotProps={{ paper: { sx: { width: SIDEBAR_WIDTH } } }}>
          <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </Drawer>
      )}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <GuestBanner />
        <AppBar color="inherit" elevation={0} sx={{ position: 'sticky', borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)' }}>
          <Toolbar sx={{ gap: 1.5, px: { xs: 1.5, md: 3 } }}>
            {mobile && (
              <IconButton edge="start" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
                <MenuRoundedIcon />
              </IconButton>
            )}
            {mobile && <Logo collapsed />}
            <Box sx={{ flex: 1, display: 'flex', justifyContent: { xs: 'flex-end', md: 'flex-start' } }}>
              {!mobile && <GlobalSearch />}
            </Box>
            <NotificationBell />
            <UserMenu />
          </Toolbar>
        </AppBar>
        <Box component="main" id="main" sx={{ flex: 1, p: { xs: 2, md: 3 }, pb: { xs: 10, md: 3 }, maxWidth: 1440, width: '100%', mx: 'auto' }}>
          {mobile && (
            <Box sx={{ mb: 2 }}>
              <GlobalSearch fullWidth />
            </Box>
          )}
          <ContentOutlet />
        </Box>
        {mobile && (
          <BottomNavigation showLabels value={mobileValue} onChange={(_e, v) => navigate(MOBILE_NAV[v].to)} sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, borderTop: '1px solid', borderColor: 'divider', zIndex: 1200, pb: 'env(safe-area-inset-bottom)', height: 'calc(60px + env(safe-area-inset-bottom))' }} component="nav" aria-label="Primary">
            {MOBILE_NAV.map((n) => (
              <BottomNavigationAction key={n.to} label={n.label.replace('Explore Office', 'Explore').replace('Book a Seat', 'Seat').replace('Meeting Rooms', 'Rooms').replace('My Bookings', 'Bookings')} icon={n.icon} sx={{ minWidth: 0, '& .MuiBottomNavigationAction-label': { fontSize: 11 } }} />
            ))}
          </BottomNavigation>
        )}
      </Box>
    </Box>
  );
}
