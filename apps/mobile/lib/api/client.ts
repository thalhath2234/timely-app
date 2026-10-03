import {
  getToken,
  getRefreshToken,
  clearToken,
  emitSessionExpired,
  setSession,
} from "../auth/session";
import { enqueueMutation, getOfflineQueueUser, replayQueuedMutations } from "../offlineQueue";
import { isOffline } from "../networkState";
import { DEFAULT_PROBE_TIMEOUT_MS, parseHealthPayload, serverStore, type ServerHealth } from "../server";

/** `ApiError.code` when no server has been paired yet (release builds only). */
export const NO_SERVER_CODE = "no-server";
export const NO_SERVER_MESSAGE = "Connect to your Timely desktop first";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    if (code) this.code = code;
  }
}

export function isNoServerError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === NO_SERVER_CODE;
}

/**
 * Dev builds fall back to the emulator/simulator address when nothing has
 * been paired. Metro removes this branch (and the module behind it) from
 * production bundles, so release APKs carry no development URL.
 */
export function devApiUrl(): string {
  if (__DEV__) {
    const dev = require("./bundledUrl") as typeof import("./bundledUrl");
    return dev.resolveDevApiUrl();
  }
  return "";
}

let activeApiUrl: string | null = null;
let resolvingApiUrl: Promise<string> | null = null;

/**
 * The address every request goes to. Memoized; the ServerProvider sets it on
 * launch and whenever a different known address answers. Before the provider
 * runs, the remembered address from SecureStore is used.
 */
export async function getApiUrl(): Promise<string> {
  if (activeApiUrl) return activeApiUrl;
  if (!resolvingApiUrl) {
    resolvingApiUrl = (async () => {
      const config = await serverStore.load();
      const remembered = config?.active || config?.urls[0] || "";
      const url = remembered || devApiUrl();
      if (!url) throw new ApiError(NO_SERVER_MESSAGE, 0, NO_SERVER_CODE);
      activeApiUrl = url;
      return url;
    })().finally(() => {
      resolvingApiUrl = null;
    });
  }
  return resolvingApiUrl;
}

/** The memoized address, or "" when nothing has resolved yet. Prefer `getApiUrl()`. */
export function getApiUrlSync(): string {
  return activeApiUrl ?? "";
}

/** Replace the memoized address (null forgets it so the next call resolves again). */
export function setActiveApiUrl(url: string | null) {
  activeApiUrl = url ? url.replace(/\/+$/, "") : null;
  resolvingApiUrl = null;
}

/** Ngrok's free tier serves an interstitial unless every request opts out. */
export function tunnelHeaders(baseUrl: string): Record<string, string> {
  return baseUrl.includes("ngrok") ? { "ngrok-skip-browser-warning": "true" } : {};
}

/**
 * `GET ${url}/health`. Resolves the contract payload for 200 ("ok") and 503
 * ("degraded"); anything else, including a non-Timely answer, rejects.
 */
export async function apiHealth(
  url: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ServerHealth> {
  const base = url.replace(/\/+$/, "");
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(`${base}/health`, {
      headers: { Accept: "application/json", ...tunnelHeaders(base) },
      signal: controller.signal,
    });
    if (response.status !== 200 && response.status !== 503) {
      throw new ApiError(`${base} answered ${response.status}`, response.status);
    }
    const health = parseHealthPayload(await response.json().catch(() => null));
    if (!health) throw new ApiError(`${base} is not a Timely server`, response.status);
    return health;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message || body.error || fallback;
  } catch {
    return fallback;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
  queueIfOffline?: boolean;
  response?: boolean;
};

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = await getRefreshToken();
    const baseUrl = await getApiUrl().catch(() => "");
    if (!refreshToken || !baseUrl) return false;
    const headers: Record<string, string> = { "Content-Type": "application/json", ...tunnelHeaders(baseUrl) };
    const response = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      await clearToken();
      return false;
    }
    const data = (await response.json()) as { token?: string; refreshToken?: string };
    if (!data.token) return false;
    await setSession(data.token, data.refreshToken);
    return true;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function api<T>(path: string, options: RequestOptions = {}, retried = false): Promise<T> {
  const baseUrl = await getApiUrl();
  const { method = "GET", body, auth = true, queueIfOffline = false } = options;
  const headers: Record<string, string> = { ...options.headers, ...tunnelHeaders(baseUrl) };
  const multipart = body instanceof FormData;
  if (body !== undefined && !multipart) headers["Content-Type"] = "application/json";

  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  if (queueIfOffline && isOffline() && getOfflineQueueUser()) {
    enqueueMutation(path, method, body);
    return { queued: true } as T;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    });
  } catch (error) {
    if (queueIfOffline && getOfflineQueueUser()) {
      enqueueMutation(path, method, body);
      return { queued: true } as T;
    }
    throw error;
  }

  if (response.status === 401 && auth && !retried && path !== "/auth/refresh") {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return api<T>(path, options, true);
    }
    emitSessionExpired();
    throw new ApiError("Session expired", 401);
  }

  if (!response.ok) {
    throw new ApiError(await readError(response, `${method} ${path} failed`), response.status);
  }

  if (options.response) return response as T;
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

let flushInFlight: Promise<void> | null = null;

export function flushOfflineQueue(): Promise<void> {
  if (isOffline() || !getOfflineQueueUser()) return Promise.resolve();
  // Startup, sign-in, and reconnect can all ask for a replay at once; one pass
  // at a time keeps a queued change from being sent twice.
  if (flushInFlight) return flushInFlight;
  flushInFlight = replayQueuedMutations(
    (item) => api(item.path, { method: item.method, body: item.body, queueIfOffline: false }),
    // The server definitively rejected this stale mutation; do not retry it forever.
    (error) => error instanceof ApiError && error.status >= 400 && error.status < 500,
  )
    .then(() => undefined)
    .finally(() => {
      flushInFlight = null;
    });
  return flushInFlight;
}

export function unwrap<T>(payload: T | { [k: string]: T }, key: string): T {
  if (payload && typeof payload === "object" && key in (payload as object)) {
    return (payload as Record<string, T>)[key];
  }
  return payload as T;
}
