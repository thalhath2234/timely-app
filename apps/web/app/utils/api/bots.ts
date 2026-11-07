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
import { EMPTY_BOTS_SUMMARY } from "@timely/contract/bots";
import { apiFetch } from "./client";
import { codedError } from "./codedError";

/** `POST /bots/:id/snooze`: a preset span, a time, or `until: null` to stop snoozing. */
export type SnoozeBody = { for: "day" | "week" } | { until: string | null };

/**
 * Sends one Bots request; a failure throws the server's message and code,
 * with the HTTP `status`, so autosave can tell a refused edit (400) from a
 * failed one.
 */
async function request<T>(
  path: string,
  fallback: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await apiFetch(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!res.ok) {
    const error = await codedError(res, fallback);
    throw Object.assign(error, { status: res.status });
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const bot = (id: string) => `/bots/${encodeURIComponent(id)}`;

export async function listBots(): Promise<BotsList> {
  const body = await request<Partial<BotsList>>(
    "/bots",
    "Could not load your bots",
  );
  return {
    bots: body.bots ?? [],
    // A field the server leaves out reads as its empty value.
    summary: { ...EMPTY_BOTS_SUMMARY, ...body.summary },
  };
}

export const getBot = (id: string) =>
  request<BotDetail>(bot(id), "Could not load this bot");

export const createBot = (input: BotInput) =>
  request<BotView>("/bots", "Could not create the bot", "POST", input);

export const updateBot = (id: string, patch: BotPatch) =>
  request<BotView>(bot(id), "Could not save the bot", "PATCH", patch);

export const deleteBot = (id: string) =>
  request<void>(bot(id), "Could not delete the bot", "DELETE");

export const pauseBot = (id: string) =>
  request<BotView>(`${bot(id)}/pause`, "Could not pause the bot", "POST");

/** Resume, and "Turn on" for a bot an outside app made. */
export const resumeBot = (id: string) =>
  request<BotView>(`${bot(id)}/resume`, "Could not turn the bot on", "POST");

export const snoozeBot = (id: string, body: SnoozeBody) =>
  request<BotView>(
    `${bot(id)}/snooze`,
    "Could not snooze the bot",
    "POST",
    body,
  );

/** Check now: 202 with when the check runs. A paused bot answers 409, thrown as a coded error. */
export const runBot = (id: string) =>
  request<RunResult>(`${bot(id)}/run`, "Could not check the bot now", "POST");

/** Useful / Not useful on an alert; `{feedback: null}` takes the answer back. */
export const rateAlert = (
  botId: string,
  alertId: string,
  body: FeedbackInput,
) =>
  request<AlertView>(
    `${bot(botId)}/alerts/${encodeURIComponent(alertId)}/feedback`,
    "Could not save your answer",
    "POST",
    body,
  );

export const forgetLesson = (botId: string, lessonId: string) =>
  request<void>(
    `${bot(botId)}/lessons/${encodeURIComponent(lessonId)}`,
    "Could not forget the lesson",
    "DELETE",
  );

/** Reads the watches once without saving anything. */
export const previewBot = (input: PreviewInput) =>
  request<PreviewResult>(
    "/bots/preview",
    "Could not read the page",
    "POST",
    input,
  );

/** Site logos as data URIs, for the sites the person watches; null when a site has none. */
export async function botIcons(
  sites: string[],
): Promise<Record<string, string | null>> {
  if (!sites.length) return {};
  const query = new URLSearchParams({ sites: sites.join(",") });
  const body = await request<{ icons?: Record<string, string | null> }>(
    `/bots/icons?${query}`,
    "Could not load site logos",
  );
  return body.icons ?? {};
}

export async function listSourceKeys(): Promise<SourceKeyView[]> {
  const body = await request<{ keys?: SourceKeyView[] }>(
    "/bots/keys",
    "Could not load price source keys",
  );
  return body.keys ?? [];
}

/** Saves a price source key after the source accepts it. The key never comes back. */
export const setSourceKey = (source: string, key: string) =>
  request<SourceKeyView>(
    `/bots/keys/${encodeURIComponent(source)}`,
    "Could not save the key",
    "POST",
    { key },
  );

export const removeSourceKey = (source: string) =>
  request<void>(
    `/bots/keys/${encodeURIComponent(source)}`,
    "Could not remove the key",
    "DELETE",
  );

export const getBotDefaults = () =>
  request<BotSettings>("/bots/defaults", "Could not load alert defaults");

export const setBotDefaults = (settings: BotSettings) =>
  request<BotSettings>(
    "/bots/defaults",
    "Could not save alert defaults",
    "PUT",
    settings,
  );
