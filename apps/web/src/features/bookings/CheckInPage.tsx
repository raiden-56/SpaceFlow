// QR check-in landing: /check-in?reservation=<id>&code=<code>. Also usable manually by typing a code.
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import QrCodeScannerRoundedIcon from '@mui/icons-material/QrCodeScannerRounded';
import { useCheckInMutation, useReservationQuery } from '@/services/endpoints';
import { errorMessage } from '@/services/api';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTransition } from '@/components/common/Motion';
import { StatusBadge } from '@/components/common/StatusBadge';
import { fmtRange } from '@/utils/time';

export function CheckInPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const reservationId = params.get('reservation') ?? '';
  const [code, setCode] = useState(params.get('code') ?? '');
  const [checkIn, { isLoading, error, data }] = useCheckInMutation();
  const { data: reservation } = useReservationQuery({ id: reservationId }, { skip: !reservationId });
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    if (reservationId && code && !auto) {
      setAuto(true);
      void checkIn({ id: reservationId, code });
    }
  }, [reservationId, code, auto, checkIn]);

  return (
    <PageTransition>
      <PageHeader title="Check in" subtitle="Confirm your arrival at a desk or meeting room." crumbs={[{ label: 'Home', to: '/' }, { label: 'Check in' }]} />
      <Card sx={{ maxWidth: 520 }}>
        <CardContent>
          <Stack spacing={2}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <QrCodeScannerRoundedIcon color="primary" fontSize="large" />
              <Typography variant="body2" color="text.secondary">
                Scan the QR code shown on your booking, or enter the booking's confirmation code.
              </Typography>
            </Box>
            {reservation && (
              <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: '#F8FAFC', border: '1px solid', borderColor: 'divider' }}>
                <Typography sx={{ fontWeight: 600 }}>{reservation.resourceName}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {reservation.buildingName} · {reservation.floorName} · {fmtRange(reservation.startAt, reservation.endAt, reservation.timezone)}
                </Typography>
                <Box sx={{ mt: 1 }}>
                  <StatusBadge status={data?.status ?? reservation.status} />
                </Box>
              </Box>
            )}
            {data && (
              <Alert severity="success" role="status">
                You are checked in to {data.resourceName}. Enjoy your day!
              </Alert>
            )}
            {error && <Alert severity="error">{errorMessage(error)}</Alert>}
            {!data && (
              <>
                <TextField label="Confirmation code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. 7K3M-Q9ZD" slotProps={{ htmlInput: { 'aria-label': 'Confirmation code', style: { letterSpacing: '0.1em', fontFamily: 'monospace' } } }} />
                <Button variant="contained" disabled={!reservationId || !code || isLoading} onClick={() => checkIn({ id: reservationId, code })}>
                  {isLoading ? 'Checking in…' : 'Check in'}
                </Button>
                {!reservationId && (
                  <Typography variant="caption" color="text.secondary">
                    Open this page from the QR code on your booking, or check in from <Button size="small" onClick={() => navigate('/bookings')}>My Bookings</Button>.
                  </Typography>
                )}
              </>
            )}
            {data && (
              <Button variant="outlined" onClick={() => navigate(`/bookings/${data.id}`)}>
                View booking
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>
    </PageTransition>
  );
}
