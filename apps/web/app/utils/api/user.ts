import { User } from "@/app/_types/types";
import { apiFetch } from "@/app/utils/api/client";

export async function getMe(): Promise<User> {
  const response = await apiFetch("/me");

  if (!response.ok) {
    throw new Error("Failed to fetch user");
  }

  return response.json();
}

export type UpdateMePayload = {
  name: string;
  email: string;
  currentPassword?: string;
  newPassword?: string;
};

export async function updateMe(payload: UpdateMePayload): Promise<User> {
  const response = await apiFetch("/me", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = "Failed to update profile";
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // keep fallback
    }
    throw new Error(message);
  }

  return response.json();
}

export type DeviceSession = {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  current: boolean;
};

export async function listSessions(): Promise<DeviceSession[]> {
  const response = await apiFetch("/sessions");
  if (!response.ok) {
    throw new Error("Failed to load sessions");
  }
  return response.json();
}

export async function revokeSession(id: string): Promise<void> {
  const response = await apiFetch(`/sessions/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error("Failed to sign out that device");
  }
}
