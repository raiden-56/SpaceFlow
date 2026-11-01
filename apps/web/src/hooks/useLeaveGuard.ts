// Lightweight in-app navigation guard. The app uses <BrowserRouter>, where react-router's
// useBlocker is unavailable, so pages with unsaved work register a guard here and the layouts'
// navigation (sidebar, menus) asks before leaving. Browser reload / tab close is handled
// separately by the page via `beforeunload`.
import { useCallback, useEffect } from 'react';
import { useNavigate, type To } from 'react-router-dom';

type Guard = () => boolean;
let activeGuard: Guard | null = null;

/** While `active`, in-app navigation through useGuardedNavigate asks for confirmation. */
export function useLeaveGuard(active: boolean, message = 'You have unsaved changes. Leave this page and discard them?') {
  useEffect(() => {
    if (!active) return;
    const guard: Guard = () => window.confirm(message);
    activeGuard = guard;
    return () => {
      if (activeGuard === guard) activeGuard = null;
    };
  }, [active, message]);
}

/** Returns true when navigation may proceed (no guard, or the user confirmed). */
export function confirmLeave(): boolean {
  return !activeGuard || activeGuard();
}

/** navigate() that respects the active leave guard. */
export function useGuardedNavigate() {
  const navigate = useNavigate();
  return useCallback(
    (to: To) => {
      if (!confirmLeave()) return false;
      navigate(to);
      return true;
    },
    [navigate],
  );
}
