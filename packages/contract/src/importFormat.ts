/**
 * Plain-text import formatting, shared by web and mobile. Plain text with no
 * Markdown in it is ambiguous: a line may be a heading, a list item or a
 * quote. When smart suggestions are on, `POST /suggestions/import-format`
 * reads each line's type; otherwise, or if that fails, the text imports as it
 * always has.
 */

/** One line's block type, as `/suggestions/import-format` returns it. */
export type ImportLineKind = "heading" | "bullet" | "numbered" | "quote" | "paragraph";
export type ImportFormat = { available: boolean; kinds: ImportLineKind[] };

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

/** The source as Markdown: plain text is formatted from each line's type as
 * `ask` (the client's `/suggestions/import-format` call) reads it; anything
 * else, an unavailable answer, a failure or a slow reply returns the source
 * unchanged. */
export async function formatPlainText(source: string, ask: (lines: string[]) => Promise<ImportFormat>) {
  const lines = plainLines(source);
  if (!lines) return source;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), FORMAT_WAIT_MS);
    });
    const result = await Promise.race([ask(lines.map((line) => line.text)), timeout]);
    if (!result?.available || result.kinds.length !== lines.length) return source;
    if (result.kinds.every((kind) => kind === "paragraph")) return source;
    return linesToMarkdown(lines, result.kinds);
  } catch {
    return source;
  } finally {
    clearTimeout(timer);
  }
}
