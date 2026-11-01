import { Badge, IconButton, Tooltip } from '@mui/material';
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded';
import { useNavigate } from 'react-router-dom';
import { useNotificationsQuery } from '@/services/endpoints';

export function NotificationBell() {
  const navigate = useNavigate();
  const { data } = useNotificationsQuery({ pageSize: 1 }, { pollingInterval: 60_000 });
  const unread = data?.unread ?? 0;
  return (
    <Tooltip title="Notifications">
      <IconButton aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => navigate('/notifications')} data-testid="notification-bell">
        <Badge badgeContent={unread} color="error" max={99}>
          <NotificationsRoundedIcon />
        </Badge>
      </IconButton>
    </Tooltip>
  );
}
