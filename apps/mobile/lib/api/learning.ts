import type {
  LearnedSkillsResponse,
  LearningEvent,
  LearningEventsResponse,
  LearningSettings,
  LearningSettingsPatch,
  MemoryEdit,
  MemoryView,
  PendingItem,
} from "@timely/contract/agentLearning";
import { ALREADY_UNDONE } from "@timely/contract/agentLearning";
import { api, ApiError } from "./client";
import { isOffline } from "../networkState";

/**
 * What the agent learned (plan 9b.4), as the phone shows it: the chat chip
 * and Keep / Discard card, and Settings → Agent → What Timely learned
 * (Activity, About you, Waiting for you, the two switches). Skills are
 * managed on web and desktop, so the phone only counts them.
 */

/** A staged change from GET /agent/learning/pending; the worker also sends a one-line summary. */
export type PendingView = PendingItem & { summary?: string };

function write<T>(path: string, method: string, body?: unknown): Promise<T> {
  if (isOffline()) return Promise.reject(new Error("Reconnect to change what Timely learned."));
  return api<T>(path, { method, body, queueIfOffline: false });
}

export const getLearningSettings = () => api<LearningSettings>("/agent/learning/settings");
export const patchLearningSettings = (patch: LearningSettingsPatch) =>
  write<LearningSettings>("/agent/learning/settings", "PATCH", patch);

/** One page of the feed, newest first; `before` is the createdAt of the last event shown. */
export function getLearningEvents(params: { conversationId?: string; status?: string; before?: string; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (params.conversationId) query.set("conversationId", params.conversationId);
  if (params.status) query.set("status", params.status);
  if (params.before) query.set("before", params.before);
  if (params.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return api<LearningEventsResponse>(`/agent/learning/events${qs ? `?${qs}` : ""}`);
}

/** Takes a change back: a skill through its ledger, a memory entry to what it was. */
/** Undo one change. One a later Undo already took back (the same skill's newer change) is done, not an error: null. */
export async function undoLearning(eventId: string): Promise<{ event: LearningEvent; result: unknown } | null> {
  try {
    return await write<{ event: LearningEvent; result: unknown }>(`/agent/learning/events/${encodeURIComponent(eventId)}/undo`, "POST");
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.message === ALREADY_UNDONE) return null;
    throw err;
  }
}

export const getLearnedSkills = () => api<LearnedSkillsResponse>("/agent/learning/skills");

export const getLearnedMemory = () => api<MemoryView>("/agent/learning/memory");
export const editLearnedMemory = (edit: MemoryEdit) => write<unknown>("/agent/learning/memory", "POST", edit);

export const getPendingLearning = () => api<{ pending: PendingView[] }>("/agent/learning/pending");
export const decidePendingLearning = (pendingId: string, choice: "keep" | "discard") =>
  write<{ event: LearningEvent; result: unknown }>(`/agent/learning/pending/${encodeURIComponent(pendingId)}`, "POST", { choice });
