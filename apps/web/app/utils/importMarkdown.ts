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
