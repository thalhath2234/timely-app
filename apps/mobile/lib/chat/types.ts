import type { BotAnswer } from "@timely/contract/bots";
import type { AnsweredQuestion, ChatActivity, ChatEngine, ChatQuestion, PermissionMode } from "@timely/contract/agentChat";

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
  /** A step of an Undo: it puts back what an auto-applied proposal changed. */
  undo?: boolean;
};
/** "" is a turn, "notice" a run event, "archive" a superseded or discarded plan,
 * "steer" what the person typed into a live agent run, "question" a question
 * card the agent asked, with what came back. */
export type ChatMessageKind = "" | "notice" | "archive" | "similar" | "steer" | "question";
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
  /** The person's answer to a "similar" message; empty while the run waits. */
  choice?: "move" | "stay";
  /** The bots (ids, at most 3) a person's message tagged; that turn only answers. */
  botTags?: string[];
  /** What the tagged bots know, on the reply written from them. */
  botAnswers?: BotAnswer[];
  /** A proposal Auto or Full Access applied without asking; Undo reverses it until undoneAt is set. */
  autoApplied?: boolean;
  /** A reply Stop cut short: the text it had streamed. */
  cut?: boolean;
  /** "agent" on a reply or proposal the new engine wrote. */
  engine?: string;
  /** The agent run that wrote it: that turn's learning events carry the same runId. */
  agentRun?: string;
  undoneAt?: string;
  /** The notice the undo added. */
  undoMessageId?: string;
  /** A "question" message's card: what was asked and answered, and how its wait ended. */
  question?: AnsweredQuestion;
};
/** A bot picked in the composer's @-picker, sent as `botTags` with one message. */
export type BotTag = { id: string; name: string };
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
  /**
   * What the person can do about `error`: "settings" for a key, credit or
   * provider problem, "none" when the same request would fail again, and
   * "" (Try again) otherwise, and "use_classic" when the agent engine
   * could not start (Use classic for this chat, then Try again).
   */
  errorAction?: "" | "settings" | "none" | "use_classic";
  /** Set with some errors, such as "provider_not_chosen" (ADR 0020). */
  errorCode?: string;
  /** How much the agent may change without asking; Supervised on older servers. */
  permission?: PermissionMode;
  /** The chat's own engine ("" follows Settings → Agent → Engine) and the current or last run's. */
  engine?: ChatEngine;
  runEngine?: "" | "classic" | "agent";
  /** A live agent run's activity lines and the reply streamed so far. */
  activity?: ChatActivity;
  /** "Don't learn from this chat": its runs write nothing to memory or skills and past-chat search skips it. */
  noLearning?: boolean;
  /** The question card the live run waits on (the chat stays running); `{}` when none waits. */
  question?: ChatQuestion;
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
  /** Smart-suggestion notes on the draft; unlike issues they never block Apply. */
  hints?: string[];
  /** Where smart suggestions would record the receipt; the person's pick wins. */
  suggestedDestination?: ReceiptDestination;
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
  /** Bots picked with "@" for this message only. */
  botTags?: BotTag[];
  /** Permission picked before the conversation exists; unset uses the account's default for new chats. */
  permission?: PermissionMode;
  requestId?: string;
  conversationId?: string;
};
