import { fromMarkdown } from "@/app/utils/markdown";
import { formatPlainText } from "@timely/contract/importFormat";
import { getImportFormat } from "@/app/utils/api/decisions";

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

export async function readMarkdownFile(file: File) {
  // Plain text with no Markdown is formatted from each line's type when smart
  // suggestions are on [54]; otherwise it imports as it always has.
  const source = await formatPlainText(await file.text(), getImportFormat);
  return parseMarkdownFile(file.name, source);
}

/** How long that note stays up. It names a limit and what to change, which
 * takes longer to read than a usual toast. */
export const IMPORT_ERROR_MS = 12_000;

/** The note for a file that could not be imported: which file, then why. */
export function importErrorMessage(file: File, error: unknown) {
  const reason = error instanceof Error ? error.message.trim() : "";
  if (!reason) return `Could not import “${file.name}”. Try again.`;
  const sentence = `${reason.charAt(0).toUpperCase()}${reason.slice(1)}`;
  return `Could not import “${file.name}”. ${sentence}${/[.!?]$/.test(sentence) ? "" : "."}`;
}
