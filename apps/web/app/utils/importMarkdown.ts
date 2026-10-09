import { fromMarkdown } from "@/app/utils/markdown";
import { getImportFormat, type ImportLineKind } from "@/app/utils/api/decisions";

export function titleFromMarkdownFile(name: string) {
  return name.replace(/\.(md|markdown|txt)$/i, "").trim() || "Imported note";
}

export function parseMarkdownFile(name: string, source: string) {
  const parsed = fromMarkdown(source);
  return {
    title: titleFromMarkdownFile(name),
    content: parsed.content,
    plainText: parsed.plainText,
  };
}

const MARKDOWN_LINE = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\||---\s*$|\[[ xX]\]\s|!\[)/;
const MARKDOWN_INLINE = /\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\)/;
const MIN_LINES = 3;
const MAX_LINES = 80;
const FORMAT_WAIT_MS = 12_000;

/** The non-empty lines of a plain-text file, or null when it already has
 * Markdown structure or is too short or long to ask about. */
export function plainLines(source: string): string[] | null {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < MIN_LINES || lines.length > MAX_LINES) return null;
  if (lines.some((line) => MARKDOWN_LINE.test(line) || MARKDOWN_INLINE.test(line))) return null;
  return lines;
}

const prefix: Record<ImportLineKind, string> = { heading: "## ", bullet: "- ", numbered: "1. ", quote: "> ", paragraph: "" };

/** Markdown for plain lines given each line's block type. Lines of one list
 * stay together; every other line is its own block. */
export function linesToMarkdown(lines: string[], kinds: ImportLineKind[]) {
  let out = "";
  lines.forEach((line, i) => {
    const kind = kinds[i] ?? "paragraph";
    const sameList = i > 0 && (kind === "bullet" || kind === "numbered") && kinds[i - 1] === kind;
    if (i > 0) out += sameList ? "\n" : "\n\n";
    out += prefix[kind] + line;
  });
  return out;
}

/** Plain text with no Markdown in it is ambiguous: a line may be a heading, a
 * list item or a quote. When smart suggestions are on they read each line's
 * type [54]; otherwise, or if that fails, the text imports as it always has. */
async function formatPlainText(source: string) {
  const lines = plainLines(source);
  if (!lines) return source;
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FORMAT_WAIT_MS));
    const result = await Promise.race([getImportFormat(lines), timeout]);
    if (!result?.available || result.kinds.length !== lines.length) return source;
    if (result.kinds.every((kind) => kind === "paragraph")) return source;
    return linesToMarkdown(lines, result.kinds);
  } catch {
    return source;
  }
}

export async function readMarkdownFile(file: File) {
  const source = await formatPlainText(await file.text());
  return parseMarkdownFile(file.name, source);
}
