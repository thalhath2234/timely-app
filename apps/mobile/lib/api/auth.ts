import type { User } from "../types";
import { api, unwrap } from "./client";

export type AuthSession = {
  message?: string;
  token: string;
  user: User;
};

export function login(email: string, password: string) {
  return api<AuthSession>("/login", { method: "POST", body: { email, password }, auth: false });
}

export function register(email: string, password: string) {
  return api<AuthSession>("/register", { method: "POST", body: { email, password }, auth: false });
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
  return api<{ message: string }>("/logout", { method: "POST", auth: false }).catch(() => undefined);
}

export function completeOnboarding() {
  return api("/config", {
    method: "PUT",
    body: { isOnboardingCompleted: true },
  });
}

export { unwrap };
