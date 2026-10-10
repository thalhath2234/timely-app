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
 *   top-level key's line (and its nested value) when it is there
 *   (setDocProperty in web frontmatter.tsx).
 * - mentionSpaceAfter: whether a linked mention needs a space after it, given
 *   the character that follows (mentionLink.tsx).
 * Plain JS only: it is pasted into the editor page as is.
 */
export const DOC_EDITOR_HELPERS_JS = String.raw`
function propertyText(current, key, value) {
  const line = key + ": " + value;
  if (!current || !current.trim()) return line;
  const lines = current.split("\n");
  // Only an unindented top-level key matches, never a nested key or a list line.
  const at = lines.findIndex((l) => {
    const m = /^(?!-\s)(?!#)([^\s:][^:]*):(?:\s|$)/.exec(l);
    return !!m && m[1].trimEnd().toLowerCase() === key.toLowerCase();
  });
  if (at < 0) {
    lines.push(line);
    return lines.join("\n");
  }
  // The key's old nested value (indented or list lines under it) goes too.
  let end = at + 1;
  while (end < lines.length && /^(\s+\S|-(\s|$))/.test(lines[end])) end++;
  lines.splice(at, end - at, line);
  return lines.join("\n");
}
function mentionSpaceAfter(next) {
  return next === "" || /^[\p{L}\p{N}]/u.test(next);
}
`;
