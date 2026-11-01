/**
 * How the apps read smart search answers, shared by web and mobile: what the
 * palette offers to make from the search words, and how long an item's
 * Related list is kept.
 */

export const SMART_CREATE_KINDS = ["doc", "sheet", "task", "project", "event"] as const;
export type SmartCreateKind = (typeof SMART_CREATE_KINDS)[number];
export type SmartCreate = { kind: SmartCreateKind; title: string };

/** The server's offer to make something ("make a budget sheet"), or
 * undefined when it has no title or names a kind the apps cannot make: one
 * for "folder" used to read `Create undefined “…”`, and choosing it did
 * nothing. Read where the answer enters each app. */
export function smartCreate(value: unknown): SmartCreate | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { kind, title } = value as { kind?: unknown; title?: unknown };
  const name = typeof title === "string" ? title.trim() : "";
  if (!name || !(SMART_CREATE_KINDS as readonly unknown[]).includes(kind)) return undefined;
  return { kind: kind as SmartCreateKind, title: name };
}

/** A found Related list is kept this long. */
export const RELATED_KEEP_MS = 10 * 60 * 1000;
const RELATED_RETRY_MS = 10_000;
const RELATED_RETRIES = 3;

type RelatedState = { data?: readonly unknown[] | null; dataUpdateCount: number };

/** How long a Related answer stays fresh: a found list for ten minutes, an
 * empty one not at all. An item saved a moment ago is not indexed yet, so
 * its first answer is often empty; that answer used to be kept for ten
 * minutes while the items it is related to were found seconds later. */
export function relatedStaleTime(state: Pick<RelatedState, "data">): number {
  return state.data?.length ? RELATED_KEEP_MS : 0;
}

/** When an open item asks again for an empty Related list: every ten
 * seconds, three times after the first answer, while it stays empty. */
export function relatedRefetchInterval(state: RelatedState): number | false {
  return !state.data?.length && state.dataUpdateCount > 0 && state.dataUpdateCount <= RELATED_RETRIES ? RELATED_RETRY_MS : false;
}
