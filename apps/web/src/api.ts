/** Thin fetch wrapper: same-origin cookies, CSRF header on writes, JSON errors. */
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { message?: string | string[]; reason?: string; issues?: { path: string; message: string }[] },
  ) {
    super(
      body.issues?.length
        ? body.issues.map((i) => `${i.path}: ${i.message}`).join('; ')
        : Array.isArray(body.message)
          ? body.message.join('; ')
          : (body.message ?? `Request failed (${status})`),
    );
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}
