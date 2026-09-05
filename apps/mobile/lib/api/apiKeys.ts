import type { ApiKey, CreatedApiKey } from "../types";
import { api } from "./client";

export function listApiKeys() {
  return api<ApiKey[]>("/api-keys");
}

export function createApiKey(name: string) {
  return api<CreatedApiKey>("/api-keys", { method: "POST", body: { name } });
}

export function revokeApiKey(id: string) {
  return api<void>(`/api-keys/${id}`, { method: "DELETE" });
}
