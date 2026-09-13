import { ApiKey, CreatedApiKey } from "@/app/_types/types";
import { apiFetch } from "./client";

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return typeof body?.message === "string" ? body.message : fallback;
  } catch {
    return fallback;
  }
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const response = await apiFetch("/api-keys", {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load API keys"));
  }
  return response.json();
}

export async function createApiKey(name: string): Promise<CreatedApiKey> {
  const response = await apiFetch("/api-keys", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to create API key"));
  }
  return response.json();
}

export async function revokeApiKey(id: string): Promise<void> {
  const response = await apiFetch(`/api-keys/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to revoke API key"));
  }
}
