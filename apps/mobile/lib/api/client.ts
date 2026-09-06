import { Platform } from "react-native";
import Constants from "expo-constants";
import { BUNDLED_API_URL } from "./bundledUrl";
import { getToken, clearToken, emitSessionExpired } from "../auth/session";

function bundledApiUrl() {
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  return BUNDLED_API_URL || process.env.EXPO_PUBLIC_API_URL || extra?.apiUrl || "";
}

function fallbackApiUrl() {
  // 10.0.2.2 is the emulator host only. Never use it on a phone.
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
};

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!API_URL) {
    throw new ApiError("This install has no API URL. Rebuild the app with EXPO_PUBLIC_API_URL set.", 0);
  }
  const { method = "GET", body, auth = true } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (API_URL.includes("ngrok")) {
    headers["ngrok-skip-browser-warning"] = "true";
  }

  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && auth) {
    await clearToken();
    emitSessionExpired();
    throw new ApiError("Session expired", 401);
  }

  if (!response.ok) {
    throw new ApiError(await readError(response, `${method} ${path} failed`), response.status);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function unwrap<T>(payload: T | { [k: string]: T }, key: string): T {
  if (payload && typeof payload === "object" && key in (payload as object)) {
    return (payload as Record<string, T>)[key];
  }
  return payload as T;
}
