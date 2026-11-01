import { Chip, type ChipProps } from '@mui/material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CancelRoundedIcon from '@mui/icons-material/CancelRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import HourglassTopRoundedIcon from '@mui/icons-material/HourglassTopRounded';
import LoginRoundedIcon from '@mui/icons-material/LoginRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import PersonOffRoundedIcon from '@mui/icons-material/PersonOffRounded';
import type { AvailabilityState, ReservationStatus } from '@spaceflow/shared';
import { STATUS_COLORS } from '@spaceflow/shared';

type Kind = AvailabilityState | ReservationStatus;

const META: Record<Kind, { label: string; color: string; icon: React.ReactElement }> = {
  AVAILABLE: { label: 'Available', color: STATUS_COLORS.AVAILABLE, icon: <CheckCircleRoundedIcon fontSize="inherit" /> },
  OCCUPIED: { label: 'In use', color: STATUS_COLORS.OCCUPIED, icon: <CancelRoundedIcon fontSize="inherit" /> },
  RESERVED: { label: 'Reserved', color: STATUS_COLORS.RESERVED, icon: <ScheduleRoundedIcon fontSize="inherit" /> },
  RESTRICTED: { label: 'Approval needed', color: STATUS_COLORS.RESTRICTED, icon: <LockRoundedIcon fontSize="inherit" /> },
  DISABLED: { label: 'Not bookable', color: STATUS_COLORS.DISABLED, icon: <BlockRoundedIcon fontSize="inherit" /> },
  PENDING_APPROVAL: { label: 'Pending approval', color: STATUS_COLORS.RESTRICTED, icon: <HourglassTopRoundedIcon fontSize="inherit" /> },
  CONFIRMED: { label: 'Confirmed', color: STATUS_COLORS.AVAILABLE, icon: <CheckCircleRoundedIcon fontSize="inherit" /> },
  CHECKED_IN: { label: 'Checked in', color: STATUS_COLORS.SELECTED, icon: <LoginRoundedIcon fontSize="inherit" /> },
  COMPLETED: { label: 'Completed', color: '#475569', icon: <DoneAllRoundedIcon fontSize="inherit" /> },
  CANCELLED: { label: 'Cancelled', color: STATUS_COLORS.DISABLED, icon: <CancelRoundedIcon fontSize="inherit" /> },
  REJECTED: { label: 'Rejected', color: STATUS_COLORS.OCCUPIED, icon: <BlockRoundedIcon fontSize="inherit" /> },
  NO_SHOW: { label: 'No-show', color: STATUS_COLORS.OCCUPIED, icon: <PersonOffRoundedIcon fontSize="inherit" /> },
  RELEASED: { label: 'Released', color: STATUS_COLORS.RESERVED, icon: <PersonOffRoundedIcon fontSize="inherit" /> },
};

export function statusMeta(kind: Kind) {
  return META[kind];
}

export function StatusBadge({ status, size = 'small', label, ...rest }: { status: Kind; label?: string } & Omit<ChipProps, 'label' | 'icon'>) {
  const m = META[status];
  return (
    <Chip
      size={size}
      icon={<span style={{ display: 'inline-flex', fontSize: 14, color: m.color }}>{m.icon}</span>}
      label={label ?? m.label}
      aria-label={`Status: ${label ?? m.label}`}
      sx={{ bgcolor: `${m.color}1A`, color: m.color, border: `1px solid ${m.color}55`, '& .MuiChip-icon': { color: m.color, ml: 0.75 } }}
      {...rest}
    />
  );
}
