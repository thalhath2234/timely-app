import type { MentionMatch, MentionTarget } from "./api/decisions";

/** The rows "Link to an item" offers, as on the web: Jev's pick first (when
 * it was sure), then the other close items without repeating it. */
export function mentionChoices(result: MentionMatch | null | undefined): { target: MentionTarget; best: boolean }[] {
  if (!result) return [];
  const best = result.match;
  const others = (result.options ?? []).filter((o) => !best || o.kind !== best.kind || o.id !== best.id);
  return [...(best ? [{ target: best, best: true }] : []), ...others.map((target) => ({ target, best: false }))];
}

/**
 * Helpers the doc editor's WebView runs, kept here as source so a Node test
 * can run the same code. They mirror the web editor:
 * - propertyText: the properties block text with one key set, replacing the
 *   key's line when it is there (setDocProperty in web frontmatter.tsx).
 * - mentionSpaceAfter: whether a linked mention needs a space after it, given
 *   the character that follows (mentionLink.tsx).
 * Plain JS only: it is pasted into the editor page as is.
 */
export const DOC_EDITOR_HELPERS_JS = String.raw`
function propertyText(current, key, value) {
  const line = key + ": " + value;
  if (!current || !current.trim()) return line;
  const lines = current.split("\n");
  const at = lines.findIndex((l) => l.split(":")[0].trim().toLowerCase() === key.toLowerCase());
  if (at >= 0) lines[at] = line;
  else lines.push(line);
  return lines.join("\n");
}
function mentionSpaceAfter(next) {
  return next === "" || /^[\p{L}\p{N}]/u.test(next);
}
`;
