import type { User } from "../types";
import { api, unwrap } from "./client";

export type AuthSession = {
  message?: string;
  token: string;
  refreshToken?: string;
  expiresIn?: number;
  user: User;
};

export function login(email: string, password: string) {
  return api<AuthSession>("/login", { method: "POST", body: { email, password }, auth: false });
}

export function register(name: string, email: string, password: string) {
  return api<AuthSession>("/register", { method: "POST", body: { name, email, password }, auth: false });
}

export function refreshSession(refreshToken: string) {
  return api<AuthSession>("/auth/refresh", {
    method: "POST",
    body: { refreshToken },
    auth: false,
  });
}

export function getMe() {
  return api<User>("/me");
}

export type UpdateMePayload = {
  name: string;
  email: string;
  currentPassword?: string;
  newPassword?: string;
};

export function updateMe(payload: UpdateMePayload) {
  return api<User>("/me", { method: "PUT", body: payload });
}

export function logout() {
  return api<{ message: string }>("/logout", { method: "POST" }).catch(() => undefined);
}

export function completeOnboarding() {
  return api("/config", {
    method: "PUT",
    body: { isOnboardingCompleted: true },
  });
}

export { unwrap };
