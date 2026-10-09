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

export type PlainLine = { text: string; block: number };

/** The non-empty lines of a plain-text file, each with the index of the
 * blank-line-separated block it sits in, or null when the file already has
 * Markdown structure or is too short or long to ask about. */
export function plainLines(source: string): PlainLine[] | null {
  const lines: PlainLine[] = [];
  let block = 0;
  for (const raw of source.split(/\r?\n/)) {
    const text = raw.trim();
    if (!text) {
      if (lines.length && lines[lines.length - 1].block === block) block += 1;
      continue;
    }
    lines.push({ text, block });
  }
  if (lines.length < MIN_LINES || lines.length > MAX_LINES) return null;
  if (lines.some(({ text }) => MARKDOWN_LINE.test(text) || MARKDOWN_INLINE.test(text))) return null;
  return lines;
}

const prefix: Record<ImportLineKind, string> = { heading: "## ", bullet: "- ", numbered: "1. ", quote: "> ", paragraph: "" };

/** Markdown for plain lines given each line's block type. Lines of one list
 * stay together, and paragraph lines of one block stay one paragraph (a
 * hard-wrapped line is not a new paragraph); every other line is its own
 * block. */
export function linesToMarkdown(lines: PlainLine[], kinds: ImportLineKind[]) {
  let out = "";
  lines.forEach((line, i) => {
    const kind = kinds[i] ?? "paragraph";
    const previous = kinds[i - 1] ?? "paragraph";
    const sameBlock = i > 0 && lines[i - 1].block === line.block;
    const together =
      sameBlock && ((kind === "paragraph" && previous === "paragraph") || ((kind === "bullet" || kind === "numbered") && previous === kind));
    if (i > 0) out += together ? "\n" : "\n\n";
    out += prefix[kind] + line.text;
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
    const result = await Promise.race([getImportFormat(lines.map((line) => line.text)), timeout]);
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
