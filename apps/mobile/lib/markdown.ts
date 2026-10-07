import type { DocContent } from "./types";
import { fromMarkdown } from "@timely/contract/markdown";
import { isRichContentEmpty, richToPlain } from "./richText";

export { fromMarkdown, normalizeCodeLanguage } from "@timely/contract/markdown";

type Node = { type?: string };

function isFlattenedMarkdown(content: DocContent | null | undefined) {
  const blocks = content?.content;
  if (!Array.isArray(blocks) || blocks.length === 0) return false;
  const onlyParagraphs = blocks.every((block) => (block as Node).type === "paragraph");
  if (!onlyParagraphs) return false;
  const text = richToPlain(content);
  return /^(#{1,6}\s|\|.+\||```|[-*]\s+\[[ xX]?\])/m.test(text) || text.includes("| ---");
}

/** Prefer the structured TipTap tree; fall back to markdown in plainText. */
export function resolveDocContent(
  content: DocContent | null | undefined,
  plainText?: string | null,
): DocContent {
  if (!isRichContentEmpty(content) && !isFlattenedMarkdown(content)) {
    return content as DocContent;
  }
  const source = isFlattenedMarkdown(content) ? richToPlain(content) : (plainText ?? "");
  if (source.trim()) return fromMarkdown(source, { breaks: true }).content;
  return content && typeof content.type === "string" ? content : { type: "doc", content: [] };
}
