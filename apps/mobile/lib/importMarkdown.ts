import { formatPlainText } from "@timely/contract/importFormat";
import { getImportFormat } from "./api/decisions";
import { fromMarkdown } from "./markdown";

/** A picked Markdown or text file as doc content. While smart suggestions are
 * on, plain text with no Markdown is formatted from each line's type [54];
 * otherwise, or if that fails, it imports as it always has. */
export async function parseImportedText(source: string, smart: boolean) {
  return fromMarkdown(smart ? await formatPlainText(source, getImportFormat) : source);
}
