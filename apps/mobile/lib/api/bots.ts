import type {
  AlertView,
  BotDetail,
  BotInput,
  BotPatch,
  BotSettings,
  BotsList,
  BotView,
  FeedbackInput,
  PreviewInput,
  PreviewResult,
  RunResult,
  SourceKeyView,
} from "@timely/contract/bots";
import { api } from "./client";

/** `POST /bots/:id/snooze`: a preset span, a time, or `until: null` to stop snoozing. */
export type SnoozeBody = { for: "day" | "week" } | { until: string | null };

// Failures throw ApiError with the server's message, code and HTTP status,
// so an editor page can tell a refused edit (400) from a failed one.
const bot = (id: string) => `/bots/${encodeURIComponent(id)}`;

export async function listBots(): Promise<BotsList> {
  const body = await api<Partial<BotsList> | undefined>("/bots");
  return {
    bots: body?.bots ?? [],
    summary: body?.summary ?? { checksToday: 0, alertsToday: 0, nextCheckAt: null },
  };
}

export const getBot = (id: string) => api<BotDetail>(bot(id));

export const createBot = (input: BotInput) => api<BotView>("/bots", { method: "POST", body: input });

export const updateBot = (id: string, patch: BotPatch) => api<BotView>(bot(id), { method: "PATCH", body: patch });

export const deleteBot = (id: string) => api<void>(bot(id), { method: "DELETE" });

export const pauseBot = (id: string) => api<BotView>(`${bot(id)}/pause`, { method: "POST" });

/** Resume, and "Turn on" for a bot an outside app made. */
export const resumeBot = (id: string) => api<BotView>(`${bot(id)}/resume`, { method: "POST" });

export const snoozeBot = (id: string, body: SnoozeBody) => api<BotView>(`${bot(id)}/snooze`, { method: "POST", body });

/** Check now: 202 with when the check runs. A paused bot answers 409 (ApiError with its code). */
export const runBot = (id: string) => api<RunResult>(`${bot(id)}/run`, { method: "POST" });

/** Useful / Not useful on an alert; `{feedback: null}` takes the answer back. */
export const rateAlert = (botId: string, alertId: string, body: FeedbackInput) =>
  api<AlertView>(`${bot(botId)}/alerts/${encodeURIComponent(alertId)}/feedback`, { method: "POST", body });

export const forgetLesson = (botId: string, lessonId: string) =>
  api<void>(`${bot(botId)}/lessons/${encodeURIComponent(lessonId)}`, { method: "DELETE" });

/** Reads the watches once without saving anything. */
export const previewBot = (input: PreviewInput) => api<PreviewResult>("/bots/preview", { method: "POST", body: input });

/** Site logos as data URIs, for the sites the person watches; null when a site has none. */
export async function botIcons(sites: string[]): Promise<Record<string, string | null>> {
  if (!sites.length) return {};
  const query = new URLSearchParams({ sites: sites.join(",") });
  const body = await api<{ icons?: Record<string, string | null> } | undefined>(`/bots/icons?${query}`);
  return body?.icons ?? {};
}

export async function listSourceKeys(): Promise<SourceKeyView[]> {
  const body = await api<{ keys?: SourceKeyView[] } | undefined>("/bots/keys");
  return body?.keys ?? [];
}

/** Saves a price source key after the source accepts it. The key never comes back. */
export const setSourceKey = (source: string, key: string) =>
  api<SourceKeyView>(`/bots/keys/${encodeURIComponent(source)}`, { method: "POST", body: { key } });

export const removeSourceKey = (source: string) =>
  api<void>(`/bots/keys/${encodeURIComponent(source)}`, { method: "DELETE" });

export const getBotDefaults = () => api<BotSettings>("/bots/defaults");

export const setBotDefaults = (settings: BotSettings) =>
  api<BotSettings>("/bots/defaults", { method: "PUT", body: settings });
