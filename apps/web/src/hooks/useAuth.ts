import { useCallback } from 'react';
import type { Permission } from '@spaceflow/shared';
import { useAppSelector } from '@/store';
import { isAdminUser } from '@/store/authSlice';

export function useAuth() {
  const { user, accessToken, bootstrapping } = useAppSelector((s) => s.auth);
  const can = useCallback((perm: Permission) => !!user?.permissions.includes(perm), [user]);
  return {
    user,
    isAuthenticated: !!accessToken && !!user,
    bootstrapping,
    can,
    isAdmin: isAdminUser(user),
    isApprover: !!user?.permissions.includes('reservation:approve'),
  };
}
