/**
 * The Assistant tab: chats and Bots in one inbox. One place builds its links,
 * and maps the old /chat and /bots URLs and notification targets onto it.
 * Pure, so scripts/bots.test.mjs runs it under Node.
 */

export type AssistantTarget = { chat?: string; bot?: string; thread?: string };

export const ASSISTANT_PATH = "/assistant";

function query(pairs: [string, string | undefined][]): string {
  const q = new URLSearchParams();
  for (const [k, v] of pairs) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** /assistant, /assistant?chat=<id>, /assistant?bot=<id> (&thread=<id> opens that Bot thread). */
export function assistantHref(target: AssistantTarget = {}): string {
  return ASSISTANT_PATH + query([["chat", target.chat], ["bot", target.bot], ["thread", target.thread]]);
}

/**
 * Where an old /chat or /bots URL now lands, or null when the path is neither.
 * Deep links keep their target: /chat?id=X -> ?chat=X, /bots?bot=Y -> ?bot=Y,
 * and /bots?new=1&starter=S keeps both params.
 */
export function legacyToAssistant(pathname: string, search = ""): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(search);
  if (path === "/chat") {
    return assistantHref({ chat: params.get("id") || params.get("chat") || params.get("chatId") || undefined });
  }
  if (path === "/bots") {
    const bot = params.get("bot") || undefined;
    if (bot) return assistantHref({ bot, thread: params.get("thread") || undefined });
    return ASSISTANT_PATH + query([["new", params.get("new") === "1" ? "1" : undefined], ["starter", params.get("starter") || undefined]]);
  }
  return null;
}

/** The fields of a notification's payload that decide where it opens. */
export type AssistantNotification = {
  category?: string;
  entityType?: string;
  entityId?: string;
  chatId?: string;
  botId?: string;
  data?: Record<string, unknown>;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * A bot alert opens its Bot (the Assistant when it names none); a chat
 * notification opens its chat. Null for anything else.
 */
export function notificationToAssistant(payload: AssistantNotification): string | null {
  const d = payload.data ?? {};
  const chat =
    str(payload.chatId) ?? str(d.chatId) ?? (payload.entityType === "chat" ? str(payload.entityId) : undefined);
  if (chat) return assistantHref({ chat });
  if ((payload.category ?? str(d.category)) === "bot") {
    const bot = str(payload.botId) ?? str(d.botId) ?? (payload.entityType === "bot" ? str(payload.entityId) : undefined);
    return assistantHref({ bot });
  }
  return null;
}
