import { Outlet } from 'react-router-dom';
import { Box, Paper, Typography } from '@mui/material';
import { Logo } from './EmployeeLayout';

export function AuthLayout() {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.1fr 1fr' } }}>
      <Box sx={{ display: { xs: 'none', md: 'flex' }, flexDirection: 'column', justifyContent: 'space-between', p: 6, color: '#fff', background: 'radial-gradient(1200px 600px at 10% 10%, #6366F1 0%, #3730A3 45%, #1E1B4B 100%)' }}>
        <Box sx={{ color: '#fff', '& span': { color: '#fff' } }}>
          <Logo />
        </Box>
        <Box>
          <Typography variant="h1" sx={{ fontSize: '2.5rem', color: '#fff', mb: 2, maxWidth: 480 }}>
            Find your place in the office in seconds.
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.8)', maxWidth: 440 }}>
            Explore every floor in 3D, book desks and meeting rooms, and check in with a QR code. One workspace, zero friction.
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)' }}>
          © {new Date().getFullYear()} SpaceFlow · Workplace management platform
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 2, sm: 4 } }}>
        <Paper variant="outlined" sx={{ width: '100%', maxWidth: 440, p: { xs: 3, sm: 4 }, borderRadius: 4 }}>
          <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 3 }}>
            <Logo />
          </Box>
          <Outlet />
        </Paper>
      </Box>
    </Box>
  );
}
