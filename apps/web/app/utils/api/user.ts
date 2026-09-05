import { User } from "@/app/_types/types";

export async function getMe(): Promise<User> {
  const response = await fetch("http://localhost:8080/me", {
    credentials: "include",
  });

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
  const response = await fetch("http://localhost:8080/me", {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = "Failed to update profile";
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) message = payload.message;
    } catch {
      // keep fallback
    }
    throw new Error(message);
  }

  return response.json();
}
