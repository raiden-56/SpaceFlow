import { Alert, Button, Collapse } from '@mui/material';
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLogoutMutation } from '@/services/endpoints';
import { dayjs } from '@/utils/time';
import { DEMO_MODE } from '@/demo';

/** Shown in both portals while a guest sandbox session is active. */
export function GuestBanner() {
  const { user } = useAuth();
  const [logout] = useLogoutMutation();
  const navigate = useNavigate();
  const isGuest = !!user?.isGuest;
  const expires = user?.guestExpiresAt ? dayjs(user.guestExpiresAt).fromNow() : null;
  return (
    <Collapse in={isGuest} unmountOnExit>
      <Alert
        severity="info"
        icon={<ScienceRoundedIcon fontSize="inherit" />}
        data-testid="guest-banner"
        sx={{ borderRadius: 0, alignItems: 'center', py: 0.25, borderBottom: '1px solid', borderColor: 'divider' }}
        action={
          <Button color="inherit" size="small" onClick={async () => { await logout().unwrap().catch(() => undefined); navigate('/login'); }}>
            Sign in with an account
          </Button>
        }
      >
        <strong>Guest mode.</strong> You are exploring a private sandbox with sample buildings, desks, rooms, colleagues and bookings. Everything works, including the admin portal, and your sandbox is deleted automatically{expires ? ` ${expires}` : ''}.
        {DEMO_MODE && ' This demo runs entirely in your browser; changes are kept on this device only.'}
      </Alert>
    </Collapse>
  );
}
