import type { BotAnswer } from "@timely/contract/bots";
import { GENUI_CAPABILITY } from "@timely/contract/genui";
import type {
  AgentChatSettings,
  AgentChatSettingsPatch,
  ChatActivity,
  ChatEngine,
  PermissionMode,
} from "@timely/contract/agentChat";
import { apiFetch } from "./client";
import { browserTimezone } from "./schedule";

export type ChatContext = { kind: string; label: string; value: string };
/** pending → done, or failed (retry resets it), or discarded in an archived plan. */
export type ChatStepStatus = "pending" | "done" | "failed" | "discarded";
export type ChatStep = {
  tool: string;
  summary: string;
  arguments: Record<string, unknown>;
  status: ChatStepStatus | string;
  result?: Record<string, unknown>;
  before?: Record<string, unknown>;
  error?: string;
  /** A step of an Undo plan: it puts back what an applied proposal changed. */
  undo?: boolean;
};
export type ChatStatus =
  | "queued"
  | "running"
  | "approval"
  | "choose"
  | "idle"
  | "failed"
  | "stopped";
/**
 * "" is a turn, "notice" a run event, "archive" a superseded or discarded
 * plan, "similar" a pointer to an earlier chat about the same request, and
 * "steer" what the person said to a live agent run while it worked.
 */
export type ChatMessageKind = "" | "notice" | "archive" | "similar" | "steer";
export type ChatMessage = {
  imageIds?: string[];
  receipt?: ReceiptDraft;
  id: string;
  role: string;
  kind?: ChatMessageKind;
  content: string;
  createdAt: string;
  steps?: ChatStep[];
  /** Marks a proposal summary. */
  proposal?: boolean;
  /** Smart suggestions' notes on a proposal: worth a check before applying. */
  notes?: string[];
  /** The earlier chat a "similar" message points at. */
  chat?: { id: string; title: string };
  /** What the person chose on a "similar" message. */
  choice?: "move" | "stay";
  /** The bots (ids, at most 3) a person's message tagged; that turn only answers. */
  botTags?: string[];
  /** What the tagged bots know, on the reply written from them. */
  botAnswers?: BotAnswer[];
  /** A proposal Auto or Full Access applied without asking; it offers Undo. */
  autoApplied?: boolean;
  /** A reply Stop cut short: the text it had streamed. */
  cut?: boolean;
  /** "agent" on a reply or proposal the new engine wrote. */
  engine?: string;
  /** When its Undo was asked for, and the notice that records it. */
  undoneAt?: string;
  undoMessageId?: string;
};
/** A bot picked in the composer's @-picker, sent as `botTags` with one message. */
export type BotTag = { id: string; name: string };
/** GET /chats returns only these columns. */
export type ChatSummary = {
  id: string;
  title: string;
  status: ChatStatus | string;
  phase: string;
  webSearch: boolean;
  revision: number;
  unread: boolean;
  error: string;
  /** Stable code of a failure the app can offer a fix for (PROVIDER_NOT_CHOSEN). */
  errorCode?: string;
  updatedAt: string;
  createdAt: string;
};
export type Chat = {
  images?: ChatImage[];
  sensitive?: boolean;
  imageReview?: ImageReview;
  id: string;
  title: string;
  status: ChatStatus | string;
  phase: string;
  webSearch: boolean;
  /** Provider and model the current or last run used; empty before the first run. */
  provider?: string;
  model?: string;
  /** Model picked in the chat menu for later runs; empty follows the account default. */
  chosenProvider?: string;
  chosenModel?: string;
  context: ChatContext[];
  messages: ChatMessage[];
  plan: ChatStep[];
  revision: number;
  unread: boolean;
  error: string;
  /**
   * What the person can do about `error`: "settings" for a key, credit or
   * provider problem, "none" when the same request would fail again,
   * "use_classic" when the new engine could not run it, and "" (Try again)
   * otherwise.
   */
  errorAction?: "" | "settings" | "none" | "use_classic";
  /** How much the agent may change without asking, for this chat. */
  permission?: PermissionMode;
  /** The chat's own engine; "" follows Settings → Agent → Engine. */
  engine?: ChatEngine;
  /** The engine the current or last run used ("" before the first run). */
  runEngine?: "" | "classic" | "agent";
  /** A live agent run's lines and the reply streamed so far. */
  activity?: ChatActivity;
  /** Stable code of a failure the app can offer a fix for (PROVIDER_NOT_CHOSEN). */
  errorCode?: string;
  updatedAt: string;
  createdAt: string;
};
/**
 * New messages carry the browser zone; the agent uses it when no timezone is
 * saved in Working hours. client=web (web, desktop and the quick prompt) makes
 * its saved-view tools act on the web and desktop views, and `ui` says this
 * app draws reply cards. Try again sends them too, so a run retried here
 * after it started on the phone uses this device.
 */
function withTimezone(path: string, method: string, body: unknown) {
  const sendsDevice =
    method === "POST" &&
    (path === "" || path.endsWith("/messages") || path.endsWith("/retry"));
  return sendsDevice
    ? {
        ...(body && typeof body === "object" ? body : {}),
        timezone: browserTimezone(),
        client: "web",
        ui: GENUI_CAPABILITY,
      }
    : body;
}

export async function chatRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  body = withTimezone(path, method, body);
  const res = await apiFetch(`/chats${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(
      error.message || "Couldn't update this conversation. Try again.",
    );
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
export const renameChat = (id: string, title: string) =>
  chatRequest<Chat>(`/${encodeURIComponent(id)}`, "PATCH", { title });
export const deleteChat = (id: string) =>
  chatRequest<void>(`/${encodeURIComponent(id)}`, "DELETE");

/** Says something to a live agent run; it reads it before its next step. */
export const steerChat = (id: string, text: string) =>
  chatRequest<Chat>(`/${encodeURIComponent(id)}/steer`, "POST", { text });

/** Puts back what an auto-applied proposal changed (messageId is its summary). */
export const undoChange = (id: string, revision: number, messageId: string) =>
  chatRequest<Chat>(`/${encodeURIComponent(id)}/undo`, "POST", {
    revision,
    messageId,
  });

/** Settings → Agent: the engine and the permission defaults. */
async function chatSettingsRequest(
  method: "GET" | "PATCH",
  body?: AgentChatSettingsPatch,
): Promise<AgentChatSettings> {
  const res = await apiFetch("/agent/chat-settings", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || "Couldn't save chat settings. Try again.");
  }
  return res.json();
}
export const getChatSettings = () => chatSettingsRequest("GET");
export const patchChatSettings = (patch: AgentChatSettingsPatch) =>
  chatSettingsRequest("PATCH", patch);

export type ChatImage = {
  id: string;
  name: string;
  expiresAt: string;
  deletedAt?: string;
};
export type ReceiptItem = {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  category: string;
};
export type ReceiptDraft = {
  merchant: string;
  date: string;
  currency: string;
  category: string;
  subtotal: string;
  tax: string;
  tip: string;
  discount: string;
  total: string;
  taxIncluded: boolean;
  discountIncluded?: boolean;
  items: ReceiptItem[];
  issues: string[];
};
export type ReceiptDestination = {
  sheetId: string;
  workspaceId: string;
  title: string;
  expenseTabId: string;
  duplicateAction: string;
  duplicateRowId: string;
};
export type ReceiptDuplicate = {
  itemMatch?: string;
  sheetId: string;
  sheetTitle: string;
  tabId: string;
  rowId: string;
  merchant: string;
  date: string;
  total: string;
  currency: string;
};
export type ImageReview = {
  imageIds: string[];
  receiptId: string;
  status: string;
  text: string;
  receipt?: ReceiptDraft;
  duplicates?: ReceiptDuplicate[];
  destination?: ReceiptDestination;
  /** Smart-suggestion notes on the draft; unlike issues they never block Apply. */
  hints?: string[];
  /** Where smart suggestions would record the receipt; the person's pick wins. */
  suggestedDestination?: ReceiptDestination;
};
export async function uploadChatImage(file: File): Promise<ChatImage> {
  const form = new FormData();
  form.append("image", file);
  const res = await apiFetch("/chats/images", { method: "POST", body: form });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || "Image upload failed");
  }
  return res.json();
}
