// Server-Sent Events client. Obtains a short-lived ticket (EventSource cannot send headers),
// connects to /events and invalidates RTK Query tags on availability / reservation changes so
// the 3D map, 2D plan, lists and cards refresh. Reconnects with backoff; events are only hints —
// the API remains the source of truth.
import { useEffect, useRef, useState } from 'react';
import type { RealtimeEvent } from '@spaceflow/shared';
import { api, API_BASE } from './api';
import { useAppDispatch, useAppSelector } from '@/store';
import { DEMO_MODE } from '@/demo';

type Listener = (ev: RealtimeEvent) => void;
const listeners = new Set<Listener>();

export function onRealtimeEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRealtime() {
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.auth.accessToken);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const retryRef = useRef(0);
  const stoppedRef = useRef(false);

  useEffect(() => {
    // Demo mode has no event stream; mutations already invalidate the affected tags.
    if (!token || DEMO_MODE) return;
    stoppedRef.current = false;

    const connect = async () => {
      if (stoppedRef.current) return;
      try {
        const res = await fetch(`${API_BASE}/events/ticket`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-Requested-With': 'SpaceFlow' } });
        if (!res.ok) throw new Error('ticket failed');
        const { ticket } = (await res.json()) as { ticket: string };
        const es = new EventSource(`${API_BASE}/events?ticket=${encodeURIComponent(ticket)}`);
        sourceRef.current = es;
        const handle = (e: MessageEvent) => {
          try {
            const ev = JSON.parse(e.data) as RealtimeEvent;
            listeners.forEach((l) => l(ev));
            if (ev.type === 'availability.changed') {
              dispatch(api.util.invalidateTags(['Availability', 'FloorMap', 'Resources', 'Reservations', 'Dashboard', 'Resource']));
            } else if (ev.type === 'notification.created') {
              dispatch(api.util.invalidateTags(['Notifications', 'Dashboard']));
            } else if (ev.type === 'floorplan.published') {
              dispatch(api.util.invalidateTags(['Floors', 'FloorMap', 'Buildings']));
            }
          } catch {
            /* ignore malformed */
          }
        };
        for (const t of ['availability.changed', 'reservation.updated', 'notification.created', 'floorplan.published'] as const) es.addEventListener(t, handle as EventListener);
        es.onopen = () => {
          retryRef.current = 0;
          setConnected(true);
          // After a reconnect, refresh everything once in case events were missed.
          dispatch(api.util.invalidateTags(['Availability', 'FloorMap', 'Notifications']));
        };
        es.onerror = () => {
          es.close();
          setConnected(false);
          scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
      }
    };
    const scheduleReconnect = () => {
      if (stoppedRef.current) return;
      const delay = Math.min(30_000, 1000 * 2 ** retryRef.current++);
      setTimeout(connect, delay);
    };
    void connect();
    return () => {
      stoppedRef.current = true;
      sourceRef.current?.close();
      setConnected(false);
    };
  }, [token, dispatch]);

  return connected;
}
