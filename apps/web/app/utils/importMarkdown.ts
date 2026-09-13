import { fromMarkdown } from "@/app/utils/markdown";

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
  const source = await file.text();
  return parseMarkdownFile(file.name, source);
}
