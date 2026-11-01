import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Alert, Snackbar, type AlertColor } from '@mui/material';

interface Toast {
  id: number;
  message: string;
  severity: AlertColor;
  action?: ReactNode;
}

interface ToastApi {
  show: (message: string, severity?: AlertColor, action?: ReactNode) => void;
  success: (message: string, action?: ReactNode) => void;
  error: (message: string, action?: ReactNode) => void;
  info: (message: string, action?: ReactNode) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Toast[]>([]);
  const show = useCallback((message: string, severity: AlertColor = 'info', action?: ReactNode) => {
    setQueue((q) => [...q, { id: ++counter, message, severity, action }]);
  }, []);
  const value = useMemo<ToastApi>(
    () => ({
      show,
      success: (m, a) => show(m, 'success', a),
      error: (m, a) => show(m, 'error', a),
      info: (m, a) => show(m, 'info', a),
    }),
    [show],
  );
  const current = queue[0];
  const close = () => setQueue((q) => q.slice(1));
  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        key={current?.id}
        open={!!current}
        autoHideDuration={current?.severity === 'error' ? 8000 : 4500}
        onClose={(_e, reason) => reason !== 'clickaway' && close()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {current ? (
          <Alert onClose={close} severity={current.severity} variant="filled" action={current.action} sx={{ minWidth: 280, alignItems: 'center' }} role={current.severity === 'error' ? 'alert' : 'status'}>
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
