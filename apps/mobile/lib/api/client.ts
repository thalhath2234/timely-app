import { Platform } from "react-native";
import Constants from "expo-constants";
import { BUNDLED_API_URL } from "./bundledUrl";
import {
  getToken,
  getRefreshToken,
  clearToken,
  emitSessionExpired,
  setSession,
} from "../auth/session";
import { enqueueMutation, getOfflineQueueUser, replayQueuedMutations } from "../offlineQueue";
import { isOffline } from "../networkState";

function bundledApiUrl() {
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  const fromEnv = process.env.EXPO_PUBLIC_API_URL || "";
  if (
    fromEnv.includes("10.0.2.2") ||
    fromEnv.includes("localhost") ||
    fromEnv.includes("127.0.0.1")
  ) {
    return fromEnv;
  }
  return fromEnv || extra?.apiUrl || BUNDLED_API_URL || "";
}

function fallbackApiUrl() {
  if (Platform.OS === "android" && Constants.isDevice === false) return "http://10.0.2.2:8080";
  if (Platform.OS !== "android") return "http://localhost:8080";
  return "";
}

export const API_URL = bundledApiUrl() || fallbackApiUrl();

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
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
    if (!refreshToken || !API_URL) return false;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (API_URL.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
    const response = await fetch(`${API_URL}/auth/refresh`, {
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
  if (!API_URL) {
    throw new ApiError("This install has no API URL. Rebuild the app with EXPO_PUBLIC_API_URL set.", 0);
  }
  const { method = "GET", body, auth = true, queueIfOffline = false } = options;
  const headers: Record<string, string> = { ...options.headers };
  const multipart = body instanceof FormData;
  if (body !== undefined && !multipart) headers["Content-Type"] = "application/json";
  if (API_URL.includes("ngrok")) {
    headers["ngrok-skip-browser-warning"] = "true";
  }

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
    response = await fetch(`${API_URL}${path}`, {
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
