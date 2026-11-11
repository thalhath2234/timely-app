import type {
  LearnedSkill,
  LearningEvent,
  LearningSettings,
  LearningSettingsPatch,
  MemoryEdit,
  MemoryStore,
  MemoryView,
  PendingItem,
  SkillState,
  UpstreamChoice,
  UpstreamCompare,
  UpstreamSkill,
} from "@timely/contract/agentLearning";
import { ALREADY_UNDONE } from "@timely/contract/agentLearning";
import { apiFetch } from "./client";
import { downloadPortable } from "./portability";

/**
 * What the agent learned: GET/POST /agent/learning/* (phase 3, plan 9b.4).
 * The events and settings are Timely's own; skills, memory, pending and
 * upstream come from the account's agent worker as it sends them.
 */

async function learningRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await apiFetch(`/agent/learning${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(error.message || "Couldn't reach what Timely learned. Try again.");
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const name = (skill: string) => encodeURIComponent(skill);

export const getLearningSettings = () =>
  learningRequest<LearningSettings>("/settings");
export const patchLearningSettings = (patch: LearningSettingsPatch) =>
  learningRequest<LearningSettings>("/settings", "PATCH", patch);

export type EventsQuery = {
  conversationId?: string;
  status?: string;
  /** The createdAt of the last event already shown. */
  before?: string;
  limit?: number;
};

export async function listLearningEvents(
  query: EventsQuery = {},
): Promise<LearningEvent[]> {
  const params = new URLSearchParams();
  if (query.conversationId) params.set("conversationId", query.conversationId);
  if (query.status) params.set("status", query.status);
  if (query.before) params.set("before", query.before);
  if (query.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  const data = await learningRequest<{ events?: LearningEvent[] }>(
    `/events${qs ? `?${qs}` : ""}`,
  );
  return data.events ?? [];
}

/** What undo and Keep / Discard answer: the event as it is now. */
export type DecidedEvent = { event: LearningEvent; result: unknown };

/** Undo one change. One a later Undo already took back (the same skill's
 * newer change) is done, not an error: null. */
export async function undoLearningEvent(id: string): Promise<DecidedEvent | null> {
  try {
    return await learningRequest<DecidedEvent>(`/events/${encodeURIComponent(id)}/undo`, "POST");
  } catch (err) {
    if (err instanceof Error && err.message === ALREADY_UNDONE) return null;
    throw err;
  }
}

export async function listLearnedSkills(): Promise<LearnedSkill[]> {
  const data = await learningRequest<{ skills?: LearnedSkill[] }>("/skills");
  return data.skills ?? [];
}

/** One ledger entry of a skill's history. */
export type SkillHistoryEntry = {
  id: string;
  ts: string | number;
  actor: string;
  action: string;
  skill: string;
  evidence?: unknown;
};

export type SkillDetail = {
  name: string;
  content: string;
  history: SkillHistoryEntry[];
  /** With an entry: that change as a unified diff. */
  diff?: string;
};

export const getLearnedSkill = (skill: string, entry?: string) =>
  learningRequest<SkillDetail>(
    `/skills/${name(skill)}${entry ? `?entry=${encodeURIComponent(entry)}` : ""}`,
  );
export const editLearnedSkill = (skill: string, content: string) =>
  learningRequest<unknown>(`/skills/${name(skill)}`, "PUT", { content });
export const setSkillState = (skill: string, state: SkillState) =>
  learningRequest<unknown>(`/skills/${name(skill)}/state`, "POST", { state });

const emptyStore: MemoryStore = { entries: [], used: 0, limit: 0 };

export async function getMemory(): Promise<MemoryView> {
  const data = await learningRequest<Partial<MemoryView>>("/memory");
  return { memory: data.memory ?? emptyStore, user: data.user ?? emptyStore };
}

/** A memory change answers the file as it is now and the events it made. */
export type MemoryEditResult = MemoryStore & {
  target: "memory" | "user";
  events?: { id?: string }[];
};

export const editMemory = (edit: MemoryEdit) =>
  learningRequest<MemoryEditResult>("/memory", "POST", edit);

export async function listPending(): Promise<PendingItem[]> {
  const data = await learningRequest<{ pending?: PendingItem[] } | PendingItem[]>(
    "/pending",
  );
  return Array.isArray(data) ? data : (data?.pending ?? []);
}

export const decidePending = (pendingId: string, choice: "keep" | "discard") =>
  learningRequest<DecidedEvent>(
    `/pending/${encodeURIComponent(pendingId)}`,
    "POST",
    { choice },
  );

export async function listUpstream(): Promise<UpstreamSkill[]> {
  const data = await learningRequest<
    { skills?: UpstreamSkill[]; upstream?: UpstreamSkill[] } | UpstreamSkill[]
  >("/upstream");
  if (Array.isArray(data)) return data;
  return data?.upstream ?? data?.skills ?? [];
}
export const compareUpstream = (skill: string) =>
  learningRequest<UpstreamCompare>(`/upstream/${name(skill)}`);
export const chooseUpstream = (skill: string, choice: UpstreamChoice) =>
  learningRequest<unknown>(`/upstream/${name(skill)}`, "POST", { choice });

/** "Download what Timely learned": the zip of learned skills and memory. */
export const downloadLearned = () =>
  downloadPortable("/agent/learning/export", "what-timely-learned.zip");
