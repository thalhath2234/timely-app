import type { DeviceSession, User } from "@/app/_types/types";
import type {
  DeleteAccountPayload,
  DeleteAccountResult,
  UpdateMePayload,
} from "@timely/contract/account";
import { apiFetch } from "@/app/utils/api/client";

export type { DeleteAccountResult, UpdateMePayload };

export async function getMe(): Promise<User> {
  const response = await apiFetch("/me");

  if (!response.ok) {
    throw new Error("Failed to fetch user");
  }

  return response.json();
}

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

/** Permanently deletes the signed-in account and everything it owns. */
export async function deleteMe(payload: DeleteAccountPayload): Promise<DeleteAccountResult> {
  const response = await apiFetch("/me", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = "Could not delete the account";
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

export type { DeviceSession };

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

export async function revokeOtherSessions(): Promise<{ revoked: number }> {
  const response = await apiFetch("/sessions/others", { method: "DELETE" });
  if (!response.ok) {
    throw new Error("Failed to sign out other devices");
  }
  return response.json();
}
