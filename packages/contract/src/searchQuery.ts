/**
 * What the apps' search boxes send. Keyword hits are asked for as the words
 * change; the semantic search and smart suggestions, which cost an embedding
 * and a model call each, wait until the typing has settled.
 */

/** The longest search the apps send, in characters. A pasted page made a
 * URL the server refused (HTTP 431), and nothing past this changes what is found. */
export const MAX_SEARCH_QUERY = 500;

/** How long after the last key press keyword hits are asked for, in ms. */
export const SEARCH_DEBOUNCE_MS = 250;

/** How long the words must stay the same before the semantic search and
 * smart suggestions are asked, in ms: a pause between words is shorter. */
export const SEARCH_SETTLE_MS = 700;

/** A search as the apps send it: trimmed, and clipped to MAX_SEARCH_QUERY
 * characters without cutting a character (an emoji, say) in two. */
export function searchQueryText(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length <= MAX_SEARCH_QUERY) return trimmed;
  return Array.from(trimmed).slice(0, MAX_SEARCH_QUERY).join("").trim();
}
