import type { ChecklistTasksRequest, ChecklistTasksResult } from "@timely/contract/docChecklist";
import type { WriteRequest, WriteResult } from "@timely/contract/helpMeWrite";
import { api } from "./client";

/** Help me write: one-shot drafting on the account's AI provider. */
export function helpMeWrite(body: WriteRequest) {
  return api<WriteResult>("/agent/write", { method: "POST", body });
}

/** Titles and brief descriptions for checklist items about to become tasks,
 * all in one request, on the account's default AI model. The phone client
 * cannot abort a request; the caller's deadline drops a late answer. */
export function checklistTaskDrafts(body: ChecklistTasksRequest) {
  return api<ChecklistTasksResult>("/agent/checklist-tasks", { method: "POST", body });
}
