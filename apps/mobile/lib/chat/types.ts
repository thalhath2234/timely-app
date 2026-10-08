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
/** "" is a turn, "notice" a run event, "archive" a superseded or discarded plan. */
export type ChatMessageKind = "" | "notice" | "archive";
export type ChatMessage = {
  imageIds?: string[];
  receipt?: ReceiptDraft;
  id: string;
  role: string;
  kind?: ChatMessageKind;
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

export type PendingImage = {
  uri: string;
  name: string;
  type: string;
  uploaded?: ChatImage;
};
export type AssistantDraft = {
  text: string;
  context: ChatContext[];
  webSearch: boolean;
  /** Model picked before the conversation exists; empty uses the default. */
  provider?: string;
  model?: string;
  images: PendingImage[];
  requestId?: string;
  conversationId?: string;
};
