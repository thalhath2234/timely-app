// Payload check for Bot alert pop-ups ("alert:notify"). Kept free of Electron
// imports so scripts/electron-guards.test.mjs can exercise it directly.

export type AlertPayload = { id: string; title: string; body: string };

const NOTIFICATION_ID = /^ntf_[0-9a-f-]+$/;
const TITLE_MAX = 100;
const BODY_MAX = 200;

/** Clips by code point, so an emoji or other surrogate pair is never split. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : Array.from(text).slice(0, max).join("");
}

/** The renderer's alert, or null when it is not a notification id with text. */
export function parseAlertPayload(p: unknown): AlertPayload | null {
  if (!p || typeof p !== "object") return null;
  const { id, title, body } = p as Record<string, unknown>;
  if (typeof id !== "string" || id.length > 64 || !NOTIFICATION_ID.test(id)) return null;
  if (typeof title !== "string" || typeof body !== "string" || !title.trim()) return null;
  return { id, title: clip(title, TITLE_MAX), body: clip(body, BODY_MAX) };
}
