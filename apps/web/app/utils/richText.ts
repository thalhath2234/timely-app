import { DocContent, MentionAttrs, MentionEntityType } from "@/app/_types/types";

/**
 * Descriptions written before rich text existed are plain strings, so they are
 * promoted to a paragraph-per-line document the first time one is opened.
 */
export function toRichContent(
  rich: DocContent | null | undefined,
  plainText: string | null | undefined,
): DocContent {
  if (rich && typeof rich.type === "string") return rich;

  const lines = (plainText ?? "").split("\n").filter((line) => line.trim());
  if (lines.length === 0) return {};

  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  };
}

export function richToPlain(content: DocContent | null | undefined): string {
  if (!content) return "";
  const lines: string[] = [];

  const walk = (node: { type?: string; text?: string; content?: unknown[]; attrs?: { label?: string } } | undefined) => {
    if (!node) return;
    if (node.type === "text" && node.text) {
      lines[lines.length - 1] = (lines[lines.length - 1] ?? "") + node.text;
      return;
    }
    if (node.type === "mention") {
      lines[lines.length - 1] = (lines[lines.length - 1] ?? "") + `@${node.attrs?.label ?? "mention"}`;
      return;
    }
    if (node.type === "paragraph" || node.type === "heading") {
      lines.push("");
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        walk(child as { type?: string; text?: string; content?: unknown[] });
      }
    }
  };

  walk(content);
  return lines.join("\n").trim();
}

export function isRichContentEmpty(content: DocContent | null | undefined) {
  if (!content || typeof content.type !== "string") return true;
  const blocks = content.content;
  if (!Array.isArray(blocks) || blocks.length === 0) return true;

  return blocks.every((block) => {
    const node = block as { content?: unknown[] };
    return !Array.isArray(node.content) || node.content.length === 0;
  });
}

interface WalkNode {
  type?: string;
  attrs?: Partial<MentionAttrs>;
  content?: WalkNode[];
  marks?: unknown[];
  text?: string;
}

/** Walks a TipTap document and returns every @mention chip found in it. */
export function extractMentions(
  content: DocContent | null | undefined,
): MentionAttrs[] {
  if (!content) return [];

  const found: MentionAttrs[] = [];
  const seen = new Set<string>();

  const walk = (node: WalkNode | null | undefined) => {
    if (!node) return;

    if (node.type === "mention" && node.attrs?.id) {
      const entityType = (node.attrs.entityType ?? "doc") as MentionEntityType;
      const key = `${entityType}:${node.attrs.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        found.push({
          id: node.attrs.id,
          label: node.attrs.label ?? "Untitled",
          entityType,
        });
      }
    }

    node.content?.forEach(walk);
  };

  walk(content as WalkNode);
  return found;
}
