/**
 * Shared JSON contract for Timely clients.
 * Task JSON always includes kind: work, reminder, or inbox.
 */
export type TaskKind = "task" | "reminder" | "inbox";
