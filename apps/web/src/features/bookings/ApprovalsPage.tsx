import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, CardContent, Pagination, Stack, TextField, Typography } from '@mui/material';
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded';
import type { ReservationSummaryDto } from '@spaceflow/shared';
import { useApprovalsQuery, useDecideApprovalMutation } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { ErrorState, CardSkeleton } from '@/components/common/Feedback';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/ToastProvider';
import { useViewOnMap } from '@/components/common/BookingCard';
import { fmtRange, fmtRelative } from '@/utils/time';

export function ApprovalsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const viewOnMap = useViewOnMap();
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useApprovalsQuery({ page, pageSize: 10 });
  const [decide, { isLoading: deciding }] = useDecideApprovalMutation();
  const [pending, setPending] = useState<{ booking: ReservationSummaryDto; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [note, setNote] = useState('');

  const submit = async () => {
    if (!pending) return;
    try {
      await decide({ id: pending.booking.id, decision: pending.decision, note: note || undefined }).unwrap();
      toast.success(pending.decision === 'APPROVED' ? 'Request approved' : 'Request rejected');
      setPending(null);
      setNote('');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <PageTransition>
      <PageHeader title="Approval requests" subtitle="Bookings for restricted rooms and desks that need your decision." />
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <CardSkeleton count={3} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={<FactCheckRoundedIcon />} title="No pending requests" description="New requests will appear here as soon as someone books a resource that requires approval." />
      ) : (
        <Stack spacing={1.5} data-testid="approvals-list">
          {data.items.map((b) => (
            <Card key={b.id}>
              <CardContent>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { md: 'center' } }}>
                  <div>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      {b.title ?? b.resourceName} · {b.resourceName}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {b.userDisplayName} · {b.buildingName}, {b.floorName} · {fmtRange(b.startAt, b.endAt, b.timezone)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Requested {fmtRelative(b.createdAt)}
                    </Typography>
                  </div>
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    <Button size="small" onClick={() => navigate(`/bookings/${b.id}`)}>
                      Details
                    </Button>
                    <Button size="small" onClick={() => viewOnMap({ buildingId: b.buildingId, floorId: b.floorId, resourceId: b.resourceId })}>
                      Map
                    </Button>
                    <Button size="small" variant="outlined" color="error" onClick={() => setPending({ booking: b, decision: 'REJECTED' })}>
                      Reject
                    </Button>
                    <Button size="small" variant="contained" color="success" onClick={() => setPending({ booking: b, decision: 'APPROVED' })} data-testid={`approve-${b.resourceCode}`}>
                      Approve
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
          {data.totalPages > 1 && (
            <Stack sx={{ alignItems: 'center' }}>
              <Pagination count={data.totalPages} page={page} onChange={(_e, p) => setPage(p)} />
            </Stack>
          )}
        </Stack>
      )}
      <ConfirmDialog
        open={!!pending}
        title={pending?.decision === 'APPROVED' ? 'Approve this request?' : 'Reject this request?'}
        description={pending ? `${pending.booking.userDisplayName} · ${pending.booking.resourceName} · ${fmtRange(pending.booking.startAt, pending.booking.endAt, pending.booking.timezone)}` : ''}
        confirmLabel={pending?.decision === 'APPROVED' ? 'Approve' : 'Reject'}
        destructive={pending?.decision === 'REJECTED'}
        loading={deciding}
        onClose={() => setPending(null)}
        onConfirm={submit}
      >
        <TextField label="Note to requester (optional)" value={note} onChange={(e) => setNote(e.target.value)} sx={{ mt: 2 }} slotProps={{ htmlInput: { maxLength: 300 } }} />
      </ConfirmDialog>
    </PageTransition>
  );
}
