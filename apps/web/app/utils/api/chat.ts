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
 * plan, "similar" a pointer to an earlier chat about the same request.
 */
export type ChatMessageKind = "" | "notice" | "archive" | "similar";
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
};
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
  updatedAt: string;
  createdAt: string;
};
/** New messages carry the browser zone; the agent uses it when no timezone is saved in Working hours. */
function withTimezone(path: string, method: string, body: unknown) {
  const sendsMessage =
    method === "POST" && (path === "" || path.endsWith("/messages"));
  return sendsMessage && body && typeof body === "object"
    ? { ...body, timezone: browserTimezone() }
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
