import { apiFetch } from "./client";

export type ChatContext = { kind: string; label: string; value: string };
export type ChatStep = {
  tool: string;
  summary: string;
  arguments: Record<string, unknown>;
  status: string;
  result?: Record<string, unknown>;
  before?: Record<string, unknown>;
  error?: string;
};
export type ChatMessage = {
  imageIds?: string[];
  receipt?: ReceiptDraft;
  id: string;
  role: string;
  content: string;
  createdAt: string;
  steps?: ChatStep[];
};
export type Chat = {
  images?: ChatImage[];
  sensitive?: boolean;
  imageReview?: ImageReview;
  id: string;
  title: string;
  status: string;
  phase: string;
  webSearch: boolean;
  context: ChatContext[];
  messages: ChatMessage[];
  plan: ChatStep[];
  revision: number;
  unread: boolean;
  error: string;
  updatedAt: string;
  createdAt: string;
};
export async function chatRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
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
