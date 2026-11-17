import { File } from "expo-file-system";
import { GENUI_CAPABILITY } from "@timely/contract/genui";
import { api } from "./client";
import { isOffline } from "../networkState";
import { deviceTimezone } from "../format";
import type { Chat, ChatImage, PendingImage } from "../chat/types";
import type { AgentBotFields } from "@timely/contract/bots";
import type {
  AgentChatSettings,
  AgentChatSettingsPatch,
  AnswerQuestionInput,
  ChatEngine,
  HostAnswerInput,
  HostDevice,
  PermissionMode,
} from "@timely/contract/agentChat";

export function chatRequest<T = Chat>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (method !== "GET" && isOffline())
    return Promise.reject(
      new Error("Reconnect before sending messages or applying changes."),
    );
  // New messages carry the device zone; the agent uses it when no timezone
  // is saved in Working hours. client=phone makes its saved-view tools act on
  // the phone's own views, and `ui` says this app draws reply cards. Try
  // again sends them too, so a run retried here uses this device.
  const sendsDevice =
    method === "POST" &&
    (path === "" || path.endsWith("/messages") || path.endsWith("/retry"));
  if (sendsDevice && !(body instanceof FormData))
    body = {
      ...(body && typeof body === "object" ? body : {}),
      timezone: deviceTimezone(),
      client: "phone",
      ui: GENUI_CAPABILITY,
    };
  return api<T>(`/chats${path}`, { method, body, queueIfOffline: false });
}
export async function uploadChatImage(image: PendingImage): Promise<ChatImage> {
  const form = new FormData();
  // SDK 57 fetch consumes Blob-compatible Expo files; legacy URI descriptors are rejected.
  form.append("image", new File(image.uri));
  return chatRequest<ChatImage>("/images", "POST", form);
}
export const renameChat = (id: string, title: string) =>
  chatRequest(`/${encodeURIComponent(id)}`, "PATCH", { title });
export const deleteChat = (id: string) =>
  chatRequest<void>(`/${encodeURIComponent(id)}`, "DELETE");

// Chat on the agent engine (Settings → Agent → Engine and Permissions).
export const getAgentChatSettings = () =>
  api<AgentChatSettings>("/agent/chat-settings");
export const patchAgentChatSettings = (patch: AgentChatSettingsPatch) => {
  if (isOffline())
    return Promise.reject(new Error("Reconnect to change agent settings."));
  return api<AgentChatSettings>("/agent/chat-settings", {
    method: "PATCH",
    body: patch,
    queueIfOffline: false,
  });
};
/** A chat's own permission mode or engine ("" follows the account). */
export const configureChatAgent = (
  id: string,
  // `device` is the phone's unlock claim; Full Access needs it (the server refuses without).
  fields: {
    permission?: PermissionMode;
    engine?: ChatEngine;
    device?: HostDevice;
  },
) => chatRequest(`/${encodeURIComponent(id)}`, "PATCH", fields);
/** "Don't learn from this chat" (PATCH /chats/:id {noLearning}); the answer is the whole chat. */
export const setChatNoLearning = (id: string, noLearning: boolean) =>
  chatRequest(`/${encodeURIComponent(id)}`, "PATCH", { noLearning });
/**
 * Adds text to the agent run that is live in this chat (409 once it ended).
 * questionRequestId is the card this screen shows ("" for none): the text
 * answers a waiting card only when the sender read that card.
 */
export const steerChat = (id: string, text: string, questionRequestId = "") =>
  chatRequest(`/${encodeURIComponent(id)}/steer`, "POST", { text, questionRequestId });
/** Answers the question card the live run waits on, or skips it (409 once the card closed). */
export const answerQuestion = (id: string, input: AnswerQuestionInput) =>
  chatRequest(`/${encodeURIComponent(id)}/answer`, "POST", input);
/** Puts back what an auto-applied proposal changed; messageId is that proposal's message. */
export const undoChatChange = (
  id: string,
  revision: number,
  messageId: string,
) =>
  chatRequest(`/${encodeURIComponent(id)}/undo`, "POST", {
    revision,
    messageId,
  });

/**
 * Answers the host card the chat waits on (Run once, Allow for this chat,
 * Deny). 409 once it was answered or changed; 403 when the phone did not
 * unlock or the account's rule sends the answer to the desktop window.
 */
export const answerHostCard = (id: string, input: HostAnswerInput) =>
  chatRequest(`/${encodeURIComponent(id)}/host-approval`, "POST", input);
/** "Undo this change": restores the checkpoint a host call left (409 once it is gone). */
export const undoHostChange = (id: string, checkpointId: string) =>
  chatRequest<{ restored: string[] }>(
    `/${encodeURIComponent(id)}/host-undo`,
    "POST",
    { checkpointId },
  );
/** Removes one "Allow for this chat" grant; the answer is the whole chat. */
export const removeHostGrant = (id: string, key: string) =>
  chatRequest(
    `/${encodeURIComponent(id)}/host-grants/${encodeURIComponent(key)}`,
    "DELETE",
  );

// ── Bot threads (phase 6): one per Bot, plus the thread a new Bot starts as ──

/** A Review card on an alert: a Timely write the run proposed, held until Approve. */
export type BotReviewCard = {
  state: string;
  summary: string;
  steps: string[];
  conversationId?: string;
  messageId?: string;
};

export type BotThreadSummary = {
  id: string;
  kind: "bot_thread";
  /** Empty for a new-Bot draft. */
  botId?: string;
  draft?: boolean;
  title: string;
  status: string;
  unread: boolean;
  updatedAt: string;
  parkedSteps: number;
  pendingChanges: number;
  reviewCards: number;
  needsYou: boolean;
  /** The thread's own turn is answering the last message. */
  working?: boolean;
};

export type BotThreadLine =
  | { kind: "alert"; id: string; at: string; alertId: string; title: string; body: string; url?: string; review?: BotReviewCard }
  | { kind: "change"; id: string; at: string; before: string; after: string; undoToken: string; undone?: boolean }
  | {
      kind: "pending_change";
      id: string;
      at: string;
      before: string;
      after: string;
      reason: "browser_site" | "memory" | "permission" | "egress" | "mcp";
      /** "pending" until the person answers. */
      state?: string;
    }
  | { kind: "answer"; id: string; at: string; text: string }
  | { kind: "draft_setup"; id: string; at: string; name: string; fields: AgentBotFields };

export type BotThreadView = {
  thread: Chat;
  summary: BotThreadSummary;
  items: BotThreadLine[];
};

const threadPath = (id: string) => `/chat/bot-threads/${encodeURIComponent(id)}`;

function writeThread<T>(path: string, body?: unknown): Promise<T> {
  if (isOffline()) return Promise.reject(new Error("Reconnect to change a Bot."));
  return api<T>(path, { method: "POST", body, queueIfOffline: false });
}

export async function listBotThreads(): Promise<BotThreadSummary[]> {
  const body = await api<{ threads?: BotThreadSummary[] } | undefined>("/chat/bot-threads");
  return body?.threads ?? [];
}

/** A Bot's thread (made when it has none), or a draft thread by its own id. */
export const getBotThread = (botOrDraftId: string) => api<BotThreadView>(threadPath(botOrDraftId));

/** Starts the thread a new Bot begins as; a request is its first message. */
export const startBotDraft = (content?: string) =>
  writeThread<BotThreadView>("/chat/bot-threads", { content, timezone: deviceTimezone(), client: "phone" });

/** The person's message in a Bot thread: it changes the Bot at once, or answers from its history. */
export const sendThreadMessage = (threadId: string, content: string, requestId: string) =>
  writeThread<Chat>(`/chats/${encodeURIComponent(threadId)}/messages`, {
    content,
    requestId,
    timezone: deviceTimezone(),
    client: "phone",
  });

/** Undo one "Changed: X -> Y" with the token its line carried. */
export const undoBotChange = (threadId: string, undoToken: string) =>
  writeThread<{ line: string }>(`${threadPath(threadId)}/undo`, { undoToken });

/** One tap on a change that widens the Bot (a new site, memory on, a looser mode). */
export const resolveBotChange = (threadId: string, itemId: string, action: "approve" | "discard") =>
  writeThread<BotThreadView>(`${threadPath(threadId)}/pending/${encodeURIComponent(itemId)}`, { action });

/** "Create" on a new Bot's whole setup. */
export const createBotFromDraft = (threadId: string) =>
  writeThread<{ botId: string; thread: BotThreadView }>(`${threadPath(threadId)}/create`);

/** "Do this in chat": a separate agent chat seeded from the alert; the same requestId gives the same chat. */
export const doAlertInChat = (alertId: string, requestId: string, request?: string) =>
  writeThread<{ conversationId: string }>(`/chat/bot-alerts/${encodeURIComponent(alertId)}/do-in-chat`, {
    request,
    requestId,
    timezone: deviceTimezone(),
    client: "phone",
  });

export type ReviewResult = { state: string; conversationId?: string; messageId?: string; error?: string };

/** Approve or discard an alert's proposed Timely write; approval applies with a receipt and Undo. */
export const reviewBotAlert = (alertId: string, action: "approve" | "discard") =>
  writeThread<ReviewResult>(`/chat/bot-alerts/${encodeURIComponent(alertId)}/review`, { action });
