import { getAccessToken, setAccessToken } from './auth-store';

const API_URL = import.meta.env.VITE_API_URL;
export const API_PREFIX = '/api/v0';

export interface ApiErrorBody {
  error: string;
  message: string;
  status_code: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: ApiErrorBody,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseErrorResponse(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return new ApiError(res.status, body.message, body);
  } catch {
    const text = await res.text().catch(() => res.statusText);
    return new ApiError(res.status, text);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const doFetch = (token: string | null) =>
    fetch(`${API_URL}${API_PREFIX}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });

  let res = await doFetch(getAccessToken());

  if (res.status === 401) {
    const refreshRes = await fetch(`${API_URL}${API_PREFIX}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (refreshRes.ok) {
      const { access } = await refreshRes.json();
      setAccessToken(access);
      res = await doFetch(access);
    } else {
      setAccessToken(null);
      throw new ApiError(401, 'Session expired');
    }
  }

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
