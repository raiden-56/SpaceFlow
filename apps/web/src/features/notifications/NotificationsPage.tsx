import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, FormControlLabel, IconButton, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Pagination, Stack, Switch, Tooltip, Typography } from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CancelRoundedIcon from '@mui/icons-material/CancelRounded';
import EditCalendarRoundedIcon from '@mui/icons-material/EditCalendarRounded';
import AlarmRoundedIcon from '@mui/icons-material/AlarmRounded';
import LoginRoundedIcon from '@mui/icons-material/LoginRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import HourglassTopRoundedIcon from '@mui/icons-material/HourglassTopRounded';
import BuildRoundedIcon from '@mui/icons-material/BuildRounded';
import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded';
import type { NotificationDto, NotificationType } from '@spaceflow/shared';
import { useDeleteNotificationMutation, useMarkAllNotificationsReadMutation, useMarkNotificationReadMutation, useNotificationsQuery } from '@/services/endpoints';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { ErrorState, CardSkeleton } from '@/components/common/Feedback';
import { EmptyState } from '@/components/common/EmptyState';
import { useToast } from '@/components/common/ToastProvider';
import { errorMessage } from '@/services/api';
import { fmtRelative } from '@/utils/time';

const ICONS: Record<NotificationType, { icon: React.ReactNode; color: string }> = {
  BOOKING_CONFIRMED: { icon: <CheckCircleRoundedIcon />, color: '#16A34A' },
  BOOKING_CANCELLED: { icon: <CancelRoundedIcon />, color: '#94A3B8' },
  BOOKING_MODIFIED: { icon: <EditCalendarRoundedIcon />, color: '#4F46E5' },
  BOOKING_REMINDER: { icon: <AlarmRoundedIcon />, color: '#4F46E5' },
  CHECKIN_REMINDER: { icon: <LoginRoundedIcon />, color: '#D97706' },
  NO_SHOW_WARNING: { icon: <WarningAmberRoundedIcon />, color: '#DC2626' },
  BOOKING_RELEASED: { icon: <WarningAmberRoundedIcon />, color: '#DC2626' },
  APPROVAL_REQUESTED: { icon: <HourglassTopRoundedIcon />, color: '#D97706' },
  APPROVAL_DECIDED: { icon: <CheckCircleRoundedIcon />, color: '#4F46E5' },
  RESOURCE_MAINTENANCE: { icon: <BuildRoundedIcon />, color: '#D97706' },
  ANNOUNCEMENT: { icon: <CampaignRoundedIcon />, color: '#0EA5E9' },
};

export function NotificationsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, isLoading, error, refetch } = useNotificationsQuery({ page, pageSize: 20, unreadOnly: unreadOnly || undefined });
  const [markRead] = useMarkNotificationReadMutation();
  const [markAll, { isLoading: markingAll }] = useMarkAllNotificationsReadMutation();
  const [remove] = useDeleteNotificationMutation();

  const openItem = async (n: NotificationDto) => {
    if (!n.readAt) await markRead({ id: n.id }).unwrap().catch(() => undefined);
    const reservationId = n.data?.reservationId as string | undefined;
    if (reservationId) navigate(`/bookings/${reservationId}`);
  };

  return (
    <PageTransition>
      <PageHeader
        title="Notifications"
        subtitle={data ? `${data.unread} unread` : undefined}
        actions={
          <>
            <FormControlLabel control={<Switch checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }} />} label="Unread only" />
            <Button variant="outlined" startIcon={<DoneAllRoundedIcon />} disabled={!data?.unread || markingAll} onClick={() => markAll().unwrap().then(() => toast.success('All notifications marked as read')).catch((e) => toast.error(errorMessage(e)))}>
              Mark all read
            </Button>
          </>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <CardSkeleton count={5} height={72} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={<NotificationsRoundedIcon />} title={unreadOnly ? 'You are all caught up' : 'No notifications yet'} description="Booking confirmations, reminders and approvals will show up here." />
      ) : (
        <Card>
          <List disablePadding aria-label="Notifications">
            {data.items.map((n, i) => {
              const meta = ICONS[n.type];
              const unread = !n.readAt;
              return (
                <ListItem
                  key={n.id}
                  disablePadding
                  divider={i < data.items.length - 1}
                  secondaryAction={
                    <Tooltip title="Delete">
                      <IconButton edge="end" aria-label={`Delete notification: ${n.title}`} onClick={() => remove({ id: n.id }).unwrap().catch((e) => toast.error(errorMessage(e)))}>
                        <DeleteOutlineRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  }
                  sx={{ bgcolor: unread ? 'rgba(79,70,229,0.04)' : undefined }}
                >
                  <ListItemButton onClick={() => openItem(n)} sx={{ py: 1.5, pr: 7 }} aria-label={`${unread ? 'Unread: ' : ''}${n.title}`}>
                    <ListItemIcon sx={{ minWidth: 44 }}>
                      <Box sx={{ width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: `${meta.color}1A`, color: meta.color, '& svg': { fontSize: 18 } }}>{meta.icon}</Box>
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          {unread && <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0 }} />}
                          <Typography sx={{ fontWeight: unread ? 700 : 500 }}>{n.title}</Typography>
                        </Stack>
                      }
                      secondary={
                        <>
                          <Typography variant="body2" color="text.secondary" component="span" sx={{ display: 'block' }}>
                            {n.body}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" component="span">
                            {fmtRelative(n.createdAt)}
                          </Typography>
                        </>
                      }
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        </Card>
      )}
      {data && data.totalPages > 1 && (
        <Stack sx={{ alignItems: 'center', mt: 2 }}>
          <Pagination count={data.totalPages} page={page} onChange={(_e, p) => setPage(p)} color="primary" />
        </Stack>
      )}
    </PageTransition>
  );
}
