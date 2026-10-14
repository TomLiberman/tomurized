// Thin fetch wrapper for the tomurized-api backend (same-origin /api/*,
// proxied by nginx in production and by the vite dev proxy in `npm run dev`).

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string): Promise<T> => request<T>(path);

export const apiPut = <T = { ok: boolean }>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const apiPost = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const apiPatch = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const apiDelete = <T = { ok: boolean }>(path: string): Promise<T> =>
  request<T>(path, { method: 'DELETE' });

export const apiUpload = <T>(path: string, form: FormData): Promise<T> =>
  request<T>(path, { method: 'POST', body: form });

export interface ServerLimits {
  maxUploadMb?: number;
  maxRestoreMb?: number;
}

/** The server's request-size limits (MB). An oversized request is rejected
 *  before its body is read, which browsers only surface as "Failed to fetch" —
 *  so sizes are checked against these BEFORE sending. */
export const fetchServerLimits = async (): Promise<ServerLimits> =>
  (await apiGet<{ limits?: ServerLimits }>('/health')).limits ?? {};

export const MB = 1024 * 1024;
