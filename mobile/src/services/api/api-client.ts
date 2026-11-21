import { getApiBaseUrl, getEnvAccessToken, getEnvDevEmail } from "@/config/env";

export class ApiError extends Error {
  readonly status: number;
  readonly isNetworkError: boolean;
  readonly code?: string;

  constructor(
    message: string,
    opts: { status?: number; isNetworkError?: boolean; code?: string } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status ?? 0;
    this.isNetworkError = opts.isNetworkError ?? false;
    this.code = opts.code;
  }
}

let inMemoryAccessToken: string | null = getEnvAccessToken();

type UnauthorizedHandler = (status: number, message: string) => void;
let onUnauthorizedCallback: UnauthorizedHandler | null = null;

export function setAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
}

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

export function registerUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorizedCallback = handler;
}

const REQUEST_TIMEOUT_MS = 12_000;

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (inMemoryAccessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${inMemoryAccessToken}`);
  }

  try {
    const response = await fetch(url, {
      ...init,
      headers,
      signal: init.signal ?? controller.signal,
    });

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { message: text };
      }
    }

    if (!response.ok) {
      const msg =
        (parsed as { message?: string | string[] })?.message ??
        `Request failed with status ${response.status}`;
      const normalizedMsg = Array.isArray(msg) ? msg.join(", ") : msg;
      const code = (parsed as { code?: string })?.code;

      if (response.status === 401 && onUnauthorizedCallback) {
        onUnauthorizedCallback(response.status, normalizedMsg);
      }

      throw new ApiError(normalizedMsg, { status: response.status, code });
    }

    return parsed as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(
        "The request timed out. Check that the Orvia API is running and reachable.",
        { isNetworkError: true, code: "TIMEOUT" },
      );
    }
    throw new ApiError(
      `Could not reach the Orvia server at ${baseUrl}.`,
      { isNetworkError: true, code: "NETWORK_ERROR" },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const apiClient = {
  getBaseUrl: getApiBaseUrl,
  get: <T>(path: string, init?: RequestInit) =>
    apiRequest<T>(path, { ...init, method: "GET" }),
  post: <T>(path: string, body?: unknown, init?: RequestInit) =>
    apiRequest<T>(path, {
      ...init,
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : init?.body,
    }),
  patch: <T>(path: string, body?: unknown, init?: RequestInit) =>
    apiRequest<T>(path, {
      ...init,
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : init?.body,
    }),
  put: <T>(path: string, body?: unknown, init?: RequestInit) =>
    apiRequest<T>(path, {
      ...init,
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : init?.body,
    }),
  delete: <T>(path: string, init?: RequestInit) =>
    apiRequest<T>(path, { ...init, method: "DELETE" }),
};

export async function ensureDevSessionIfConfigured(): Promise<boolean> {
  if (inMemoryAccessToken) return true;
  const devEmail = getEnvDevEmail();
  if (!devEmail) return false;

  try {
    const res = await apiClient.post<{ accessToken?: string }>("/auth/dev/token", {
      email: devEmail,
    });
    if (res?.accessToken) {
      setAccessToken(res.accessToken);
      return true;
    }
  } catch {
    // Dev tools may be disabled on the API; caller stays unauthenticated.
  }
  return false;
}
