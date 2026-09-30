import type { User } from "../types";
import * as SecureStore from "expo-secure-store";

const USER_KEY = "timely.session.user";
const TOKEN_KEY = "timely.session.token";
const REFRESH_KEY = "timely.session.refresh";

let memoryToken: string | null = null;
let memoryRefresh: string | null = null;
const expiredListeners = new Set<() => void>();

export function onSessionExpired(listener: () => void) {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
}

export function emitSessionExpired() {
  for (const listener of expiredListeners) listener();
}

export async function getToken() {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}

export async function getRefreshToken() {
  if (memoryRefresh) return memoryRefresh;
  try {
    memoryRefresh = await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    memoryRefresh = null;
  }
  return memoryRefresh;
}

export async function setToken(token: string) {
  memoryToken = token;
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function setRefreshToken(token: string) {
  memoryRefresh = token;
  await SecureStore.setItemAsync(REFRESH_KEY, token);
}

export async function setSession(access: string, refresh?: string | null) {
  await setToken(access);
  if (refresh) await setRefreshToken(refresh);
}

export async function getCachedUser(): Promise<User | null> {
  try { const value = await SecureStore.getItemAsync(USER_KEY); const user = value ? JSON.parse(value) : null; return user?.id && user?.email ? user : null; } catch { return null; }
}
export async function setCachedUser(user: User) {
  try { await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)); } catch { /* In-memory sessions still work if device storage is unavailable. */ }
}

export async function clearToken() {
  await SecureStore.deleteItemAsync(USER_KEY).catch(() => undefined);
  memoryToken = null;
  memoryRefresh = null;
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // ignore
  }
  try {
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  } catch {
    // ignore
  }
}
