import type { BotAnswer } from "@timely/contract/bots";
import { GENUI_CAPABILITY } from "@timely/contract/genui";
import type {
  AgentChatSettings,
  AgentChatSettingsPatch,
  AnsweredQuestion,
  AnswerQuestionInput,
  ChatActivity,
  ChatEngine,
  ChatQuestion,
  ClosedHost,
  FullAccessRecord,
  HostAnswerInput,
  HostGrant,
  HostRequest,
  PermissionMode,
} from "@timely/contract/agentChat";
import { newChatAccess } from "@timely/contract/agentChat";
import type { AgentBotFields } from "@/app/_types/types";
import { apiFetch } from "./client";
import { browserTimezone } from "./schedule";
import { desktopShell } from "./instance";

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
  | "host_approval"
  | "choose"
  | "idle"
  | "failed"
  | "stopped";
/**
 * "" is a turn, "notice" a run event, "archive" a superseded or discarded
 * plan, "similar" a pointer to an earlier chat about the same request,
 * "steer" what the person said to a live agent run while it worked, and
 * "question" a question card the agent asked, with what came back, and
 * "host" a host card (command, file, browser or MCP tool) that closed, or a
 * host call that left a checkpoint "Undo this change" can restore.
 */
export type ChatMessageKind =
  | ""
  | "notice"
  | "archive"
  | "similar"
  | "steer"
  | "question"
  | "host";
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
  /** The agent run that wrote it: its learning events carry the same run id. */
  agentRun?: string;
  /** When its Undo was asked for, and the notice that records it. */
  undoneAt?: string;
  undoMessageId?: string;
  /** A "question" message's card: what was asked and answered, and how its wait ended. */
  question?: AnsweredQuestion;
  /** A "host" message's card: how it closed, who answered and its checkpoint. */
  host?: ClosedHost;
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
  /** The question card the live run waits on; `{}` when none waits. */
  question?: ChatQuestion;
  /** The host card the chat waits on (status host_approval); `{}` when none waits. */
  hostRequest?: HostRequest;
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
  /** "Don't learn from this chat": no skills or memory are written from it,
   * and past-chat search leaves it out. */
  noLearning?: boolean;
  /** A live agent run's lines and the reply streamed so far. */
  activity?: ChatActivity;
  /** The question card the live run waits on (status stays running); `{}` when none waits. */
  question?: ChatQuestion;
  /** The host card the chat waits on (status host_approval); `{}` when none waits. */
  hostRequest?: HostRequest;
  /** What "Allow for this chat" allowed here; each can be removed. */
  hostGrants?: HostGrant[];
  /** The step-up that turned Full Access on for this chat (`{}` when none). */
  fullAccess?: FullAccessRecord;
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

/** A chat request that answered 404: the conversation is gone (deleted elsewhere). */
export const isChatGone = (error: unknown): boolean =>
  !!error &&
  typeof error === "object" &&
  (error as { status?: unknown }).status === 404;

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
    // The status travels with the error: a 404 on a chat means it was deleted.
    throw Object.assign(
      new Error(
        error.message || "Couldn't update this conversation. Try again.",
      ),
      { status: res.status },
    );
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
export const renameChat = (id: string, title: string) =>
  chatRequest<Chat>(`/${encodeURIComponent(id)}`, "PATCH", { title });
/** "Don't learn from this chat" (PATCH {noLearning}). */
export const setChatNoLearning = (id: string, noLearning: boolean) =>
  chatRequest<Chat>(`/${encodeURIComponent(id)}`, "PATCH", { noLearning });
export const deleteChat = (id: string) =>
  chatRequest<void>(`/${encodeURIComponent(id)}`, "DELETE");

/** Says something to a live agent run; it reads it before its next step. */
export const steerChat = (id: string, text: string) =>
  chatRequest<Chat>(`/${encodeURIComponent(id)}/steer`, "POST", { text });

/**
 * Answers the question card the live run waits on, or skips it. 409 "This
 * question was already closed" once the card no longer waits.
 */
export const answerQuestion = (id: string, input: AnswerQuestionInput) =>
  chatRequest<Chat>(`/${encodeURIComponent(id)}/answer`, "POST", input);

/** A request through the desktop window's bridge, as a chat call: the main
 * process adds the credential and stamps the device. A 401 means the window's
 * session is a refresh behind, so one normal request refreshes it first. */
async function desktopChatRequest<T>(
  op: "chat.hostApproval" | "chat.permission",
  body: Record<string, string | number | boolean | null>,
): Promise<T> {
  const shell = desktopShell();
  if (!shell) throw new Error("This works only in the Timely desktop app.");
  let result = await shell.request(op, body);
  if (result.status === 401) {
    await apiFetch("/instance").catch(() => undefined);
    result = await shell.request(op, body);
  }
  if (!result.ok) {
    const message =
      result.body && typeof result.body === "object" && "message" in result.body
        ? String((result.body as { message: unknown }).message)
        : "";
    throw Object.assign(
      new Error(message || "Couldn't update this conversation. Try again."),
      { status: result.status },
    );
  }
  return result.body as T;
}

/**
 * Answers the host card the chat waits on: Run once, Allow for this chat or
 * Deny. In the desktop window it goes through the shell bridge, so the
 * server records the desktop window as the device; anywhere else it is a
 * plain request. 409 once the card was answered or changed, 403 when the
 * rule or the unlock refuses.
 */
export const answerHostCard = (id: string, input: HostAnswerInput) =>
  desktopShell()
    ? desktopChatRequest<Chat>("chat.hostApproval", {
        chatId: id,
        revision: input.revision ?? 0,
        requestId: input.requestId,
        choice: input.choice,
      })
    : chatRequest<Chat>(
        `/${encodeURIComponent(id)}/host-approval`,
        "POST",
        input,
      );

/** "Undo this change": restores the checkpoint a host call left (409 once it is gone). */
export const undoHostChange = (id: string, checkpointId: string) =>
  chatRequest<{ restored: string[] }>(
    `/${encodeURIComponent(id)}/host-undo`,
    "POST",
    { checkpointId },
  );

/** Removes one "Allow for this chat" grant. */
export const removeHostGrant = (id: string, key: string) =>
  chatRequest<Chat>(
    `/${encodeURIComponent(id)}/host-grants/${encodeURIComponent(key)}`,
    "DELETE",
  );

/**
 * A chat's permission mode. Full Access needs the step-up, so in the
 * desktop window it goes through the shell bridge; a phone-sized browser
 * never turns it on.
 */
export const setChatPermission = (id: string, permission: PermissionMode) =>
  permission === "full" && desktopShell()
    ? desktopChatRequest<Chat>("chat.permission", { chatId: id, permission })
    : chatRequest<Chat>(`/${encodeURIComponent(id)}`, "PATCH", { permission });

/**
 * Starts a chat. In the desktop window a chat that should start in Full
 * Access is created Supervised and then turned to Full Access through the
 * shell bridge (newChatAccess); when that step fails the chat keeps the
 * stricter mode and its chip says so.
 */
export async function createChat(
  body: Record<string, unknown>,
  chosen: PermissionMode | null,
  accountDefault: PermissionMode,
): Promise<Chat> {
  const { create, thenFull } = newChatAccess(
    chosen,
    accountDefault,
    Boolean(desktopShell()),
  );
  const made = await chatRequest<Chat>("", "POST", {
    ...body,
    ...(create ? { permission: create } : {}),
  });
  if (!thenFull) return made;
  return setChatPermission(made.id, "full").catch(() => made);
}

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
/**
 * The desktop window sends Permissions changes through its bridge, which is
 * the step-up a Full Access default, "Allowed on any device" and host cards
 * back to any device need (the server answers 403 to anything else).
 */
export async function patchChatSettings(
  patch: AgentChatSettingsPatch,
): Promise<AgentChatSettings> {
  const shell = desktopShell();
  if (!shell) return chatSettingsRequest("PATCH", patch);
  const body: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(patch))
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      body[key] = value;
  let result = await shell.request("settings.permissions", body);
  if (result.status === 401) {
    await apiFetch("/instance").catch(() => undefined);
    result = await shell.request("settings.permissions", body);
  }
  if (!result.ok) {
    const message =
      result.body && typeof result.body === "object" && "message" in result.body
        ? String((result.body as { message: unknown }).message)
        : "";
    throw new Error(message || "Couldn't save chat settings. Try again.");
  }
  return result.body as AgentChatSettings;
}

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

// ── Bot threads: where a Bot is changed by talking to it ──

/** The Review card an alert carries when its run proposed a Timely write. */
export type BotReviewCard = {
  state: string;
  summary: string;
  steps: string[];
  conversationId?: string;
  messageId?: string;
};

/** One line of a Bot thread (GET /chat/bot-threads/:id). */
export type BotThreadLine = {
  kind: "alert" | "change" | "pending_change" | "answer" | "draft_setup";
  id: string;
  at: string;
  alertId?: string;
  title?: string;
  body?: string;
  url?: string;
  review?: BotReviewCard;
  before?: string;
  after?: string;
  undoToken?: string;
  undone?: boolean;
  /** pending_change: browser_site, memory, permission, egress or mcp. */
  reason?: string;
  /** pending_change: pending, approved or discarded. */
  state?: string;
  text?: string;
  name?: string;
  fields?: AgentBotFields;
};

/** Why a thread needs the person, as counts. */
export type BotThreadSummary = {
  id: string;
  kind: "bot_thread";
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
};

export type BotThreadView = {
  thread: Chat;
  summary: BotThreadSummary;
  items: BotThreadLine[];
};

async function threadRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw Object.assign(
      new Error(error.message || "Couldn't update this Bot thread. Try again."),
      { status: res.status },
    );
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const threadPath = (id: string) =>
  `/chat/bot-threads/${encodeURIComponent(id)}`;

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export const listBotThreads = () =>
  threadRequest<{ threads: BotThreadSummary[] }>("/chat/bot-threads").then(
    (body) => body.threads ?? [],
  );

/** A Bot's thread (made when it has none), or a draft thread by its own id. */
export const getBotThread = (id: string) =>
  threadRequest<BotThreadView>(threadPath(id));

/** A new Bot starts as its thread; `content` is its first message. */
export const newBotDraft = (content?: string) =>
  threadRequest<BotThreadView>("/chat/bot-threads", "POST", {
    content: content ?? "",
    timezone: browserTimezone(),
  });

/** A message to a Bot thread; its reply arrives on the thread. */
export const sendBotThread = (conversationId: string, content: string) =>
  chatRequest<Chat>(`/${encodeURIComponent(conversationId)}/messages`, "POST", {
    content,
    requestId: newRequestId(),
  });

/** Undo one "Changed: X -> Y"; the person's own tap may put back reach they had. */
export const undoBotChange = (threadId: string, undoToken: string) =>
  threadRequest<{ line: string }>(`${threadPath(threadId)}/undo`, "POST", {
    undoToken,
  });

/** One tap on a change that widens the Bot (a new site, memory on, a looser mode). */
export const resolveBotPending = (
  threadId: string,
  itemId: string,
  action: "approve" | "discard",
) =>
  threadRequest<BotThreadView>(
    `${threadPath(threadId)}/pending/${encodeURIComponent(itemId)}`,
    "POST",
    { action },
  );

/** Create the Bot a draft thread shows, once. */
export const createBotFromDraft = (threadId: string) =>
  threadRequest<{ botId: string; thread: BotThreadView }>(
    `${threadPath(threadId)}/create`,
    "POST",
  );

/** "Do this in chat": a separate agent chat seeded with the alert's request. */
export const doAlertInChat = (alertId: string, request?: string) =>
  threadRequest<{ conversationId: string }>(
    `/chat/bot-alerts/${encodeURIComponent(alertId)}/do-in-chat`,
    "POST",
    { request: request ?? "", requestId: newRequestId() },
  );

/** Approve or Discard the Review card of an alert's proposed write. */
export const reviewBotAlert = (
  alertId: string,
  action: "approve" | "discard",
) =>
  threadRequest<unknown>(
    `/chat/bot-alerts/${encodeURIComponent(alertId)}/review`,
    "POST",
    { action },
  );
