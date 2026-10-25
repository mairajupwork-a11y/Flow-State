export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const IS_DEMO = import.meta.env.MODE === 'demo';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (IS_DEMO) {
    // The shareable demo runs the real API in this browser (see src/demo/backend.js).
    const { demoFetch } = await import('../demo/backend.js');
    const out = await demoFetch(method, path, body);
    if (out.status >= 400) throw new ApiError(out.status, out.data?.error ?? `Request failed (${out.status}).`);
    return out.data as T;
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'workmars' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'You appear to be offline. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status}).`);
  return data as T;
}

/** Sends one file as the raw request body (attachments). */
async function upload<T>(path: string, file: File): Promise<T> {
  if (IS_DEMO) throw new ApiError(400, 'File uploads aren’t available in the demo.');
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Requested-With': 'workmars' },
      body: file,
    });
  } catch {
    throw new ApiError(0, 'You appear to be offline. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? (res.status === 413 ? 'That file is too large (10 MB max).' : `Upload failed (${res.status}).`));
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  upload,
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};
