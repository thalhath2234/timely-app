// The lines of a Bot thread in order: the person's messages (from the thread's
// own messages) between the cards the API builds (alerts, changes, answers).
// Pure, so `make test-mobile-assistant` runs it under Node.
import type { BotThreadLine } from "../../lib/api/chat";

type ThreadMessage = { id: string; role: string; kind?: string; content: string; createdAt: string };

export type ThreadRow =
  | { type: "user"; key: string; at: number; text: string; sending?: boolean }
  | { type: "line"; key: string; at: number; line: BotThreadLine };

const ms = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/** What the person typed that the API has not answered yet shows at the end, marked sending. */
export function threadRows(messages: ThreadMessage[] | undefined, items: BotThreadLine[] | undefined, sending?: string): ThreadRow[] {
  const rows: ThreadRow[] = [];
  for (const m of messages ?? []) {
    if (m.role !== "user" || m.kind || !m.content.trim()) continue;
    rows.push({ type: "user", key: `u-${m.id}`, at: ms(m.createdAt), text: m.content });
  }
  for (const line of items ?? []) rows.push({ type: "line", key: `l-${line.id}`, at: ms(line.at), line });
  rows.sort((a, b) => a.at - b.at);
  const text = sending?.trim();
  // The message is already in the thread once the server saved it: drop the local copy then.
  if (text && !rows.some((r) => r.type === "user" && r.text.trim() === text)) {
    rows.push({ type: "user", key: "u-sending", at: Number.MAX_SAFE_INTEGER, text, sending: true });
  }
  return rows;
}

/** Whether the thread has a new Bot's setup waiting for Create (the last draft_setup, not yet created). */
export function draftSetup(items: BotThreadLine[] | undefined): Extract<BotThreadLine, { kind: "draft_setup" }> | null {
  const setups = (items ?? []).filter((i): i is Extract<BotThreadLine, { kind: "draft_setup" }> => i.kind === "draft_setup");
  return setups.length ? setups[setups.length - 1] : null;
}
