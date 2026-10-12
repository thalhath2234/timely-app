import type { WriteRequest, WriteResult } from "@timely/contract/helpMeWrite";
import { apiFetch } from "./client";

/** Help me write: one-shot drafting on the account's AI provider. */
export async function helpMeWrite(body: WriteRequest, signal?: AbortSignal): Promise<WriteResult> {
  const res = await apiFetch("/agent/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let message = "Could not write that. Try again.";
    try {
      const data = await res.json();
      if (typeof data?.message === "string") message = data.message;
    } catch {
      // keep the fallback message
    }
    throw new Error(message);
  }
  return res.json();
}
