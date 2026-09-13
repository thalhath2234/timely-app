const TOKEN_KEY = "timely.accessToken";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "/api-proxy";

export function apiUrl(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${suffix}`;
}

export function getAccessToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAccessToken(token: string | undefined | null) {
  try {
    if (!token) sessionStorage.removeItem(TOKEN_KEY);
    else sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // private mode can throw
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const response = await fetch(apiUrl("/auth/refresh"), {
      method: "POST",
      credentials: "include",
      headers: { "ngrok-skip-browser-warning": "true" },
    });
    if (!response.ok) {
      setAccessToken(null);
      return false;
    }
    const data = (await response.json()) as { token?: string };
    if (data.token) setAccessToken(data.token);
    return Boolean(data.token);
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function apiFetch(path: string, init: RequestInit = {}, retried = false) {
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  headers.set("ngrok-skip-browser-warning", "true");

  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: init.credentials ?? "include",
    headers,
  });

  if (
    response.status === 401 &&
    !retried &&
    path !== "/auth/refresh" &&
    path !== "/logout" &&
    path !== "/login" &&
    path !== "/register"
  ) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiFetch(path, init, true);
    }
  }

  return response;
}
