import { Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import ExploreOffRoundedIcon from '@mui/icons-material/ExploreOffRounded';
import ConstructionRoundedIcon from '@mui/icons-material/ConstructionRounded';
import { EmptyState } from './EmptyState';
import { PageTransition } from './Motion';

export function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <PageTransition>
      <EmptyState icon={<LockRoundedIcon />} title="You don't have access to this page" description="Ask a workplace administrator if you believe you should have access." actionLabel="Back to home" onAction={() => navigate('/')} />
    </PageTransition>
  );
}

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <PageTransition>
      <EmptyState icon={<ExploreOffRoundedIcon />} title="Page not found" description="The page you are looking for does not exist or has moved." actionLabel="Back to home" onAction={() => navigate('/')} />
    </PageTransition>
  );
}

export function ComingSoon({ title }: { title: string }) {
  return (
    <PageTransition>
      <EmptyState icon={<ConstructionRoundedIcon />} title={title} description="This screen is being built." />
      <Button sx={{ display: 'none' }} />
    </PageTransition>
  );
}
