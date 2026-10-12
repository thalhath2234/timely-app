import type { WriteRequest, WriteResult } from "@timely/contract/helpMeWrite";
import { api } from "./client";

/** Help me write: one-shot drafting on the account's AI provider. */
export function helpMeWrite(body: WriteRequest) {
  return api<WriteResult>("/agent/write", { method: "POST", body });
}
