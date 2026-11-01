import { API_BASE } from '@/services/api';
import { store } from '@/store';
import { apiFetch } from '@/demo';

/** Authenticated fetch for non-JSON endpoints (CSV / ICS downloads, templates). */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = store.getState().auth.accessToken;
  return apiFetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Requested-With': 'SpaceFlow' },
  });
}

export async function downloadFile(path: string, fileName: string) {
  const res = await authFetch(path);
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) message = j.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}
