import type { DocContent } from "@/app/_types/types";
import { isRichContentEmpty, richToPlain } from "@/app/utils/richText";

type Attrs = Record<string, unknown>;
type Mark = { type: string; attrs?: Attrs };
type Node = {
  type?: string;
  text?: string;
  attrs?: Attrs;
  marks?: Mark[];
  content?: Node[];
};

function node(type: string, attrs?: Attrs | null, content?: Node[] | null): Node {
  const next: Node = { type };
  if (attrs) next.attrs = attrs;
  if (content) next.content = content;
  return next;
}

function textNode(text: string, marks?: Mark[]): Node {
  const next: Node = { type: "text", text };
  if (marks?.length) next.marks = marks;
  return next;
}

const headingRe = /^(#{1,6})\s+(.*)$/;
const ulRe = /^(\s*)[-*]\s+(.*)$/;
const olRe = /^(\s*)\d+\.\s+(.*)$/;
const taskRe = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/;
const hrRe = /^(\*\*\*|---|___)\s*$/;
const fenceRe = /^```([a-zA-Z0-9_+#.-]*)\s*$/;
const tableRowRe = /^\|(.+)\|$/;
const tableSepRe = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const mentionRe = /\[@([^\]]+)\]\(timely:\/\/(task|project|doc|sheet)\/([^)]+)\)/;
const linkRe = /\[([^\]]+)\]\(([^)]+)\)/;
const boldRe = /\*\*(.+?)\*\*/;
const italicRe = /\*(.+?)\*/;
const strikeRe = /~~(.+?)~~/;
const highlightRe = /==(.+?)==/;
const codeRe = /`([^`]+)`/;
const underlineRe = /<u>(.+?)<\/u>/;

/** Short fence tags people actually type, mapped to the names the editor's
 * language selector and highlighter use. Unknown values pass through. */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  golang: "go",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  htm: "html",
  jsonc: "json",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  kt: "kotlin",
  plaintext: "",
  text: "",
  txt: "",
  plain: "",
};

export function normalizeCodeLanguage(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "";
  return LANGUAGE_ALIASES[value] ?? value;
}

/** Turns markdown (MCP / edit source) into a TipTap document plus search text. */
export function fromMarkdown(src: string): { content: DocContent; plainText: string } {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const content: Node[] = [];
  const plain: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }

    const fence = trimmed.match(fenceRe);
    if (fence) {
      const lang = normalizeCodeLanguage(fence[1]);
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !fenceRe.test(lines[i].trim())) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const text = body.join("\n");
      content.push(node("codeBlock", lang ? { language: lang } : {}, [textNode(text)]));
      plain.push(text);
      continue;
    }

    if (hrRe.test(trimmed)) {
      content.push(node("horizontalRule"));
      i += 1;
      continue;
    }

    const heading = trimmed.match(headingRe);
    if (heading) {
      const [inlineNodes, p] = inline(heading[2]);
      content.push(node("heading", { level: heading[1].length }, inlineNodes));
      plain.push(p);
      i += 1;
      continue;
    }

    if (tableRowRe.test(trimmed) && i + 1 < lines.length && tableSepRe.test(lines[i + 1].trim())) {
      const [table, texts, consumed] = parseTable(lines.slice(i));
      content.push(table);
      plain.push(...texts);
      i += consumed;
      continue;
    }

    if (taskRe.test(line)) {
      const [items, texts, consumed] = parseTaskList(lines.slice(i));
      content.push(node("taskList", null, items));
      plain.push(...texts);
      i += consumed;
      continue;
    }

    if (ulRe.test(line) && !taskRe.test(line)) {
      const [items, texts, consumed] = parseList(lines.slice(i), false);
      content.push(node("bulletList", null, items));
      plain.push(...texts);
      i += consumed;
      continue;
    }

    if (olRe.test(line)) {
      const [items, texts, consumed] = parseList(lines.slice(i), true);
      content.push(node("orderedList", null, items));
      plain.push(...texts);
      i += consumed;
      continue;
    }

    if (trimmed.startsWith("> ") || trimmed === ">") {
      const [quote, texts, consumed] = parseQuote(lines.slice(i));
      content.push(quote);
      plain.push(...texts);
      i += consumed;
      continue;
    }

    const [inlineNodes, p] = inline(trimmed);
    content.push(node("paragraph", null, inlineNodes));
    plain.push(p);
    i += 1;
  }

  if (content.length === 0) content.push(node("paragraph"));
  return { content: { type: "doc", content }, plainText: plain.join("\n") };
}

function parseList(lines: string[], ordered: boolean): [Node[], string[], number] {
  const items: Node[] = [];
  const texts: string[] = [];
  let consumed = 0;
  while (consumed < lines.length) {
    const line = lines[consumed];
    let rest = "";
    if (ordered) {
      const m = line.match(olRe);
      if (!m) break;
      rest = m[2];
    } else {
      if (taskRe.test(line)) break;
      const m = line.match(ulRe);
      if (!m) break;
      rest = m[2];
    }
    const [inlineNodes, p] = inline(rest);
    items.push(node("listItem", null, [node("paragraph", null, inlineNodes)]));
    texts.push(p);
    consumed += 1;
  }
  return [items, texts, consumed || 1];
}

function parseTaskList(lines: string[]): [Node[], string[], number] {
  const items: Node[] = [];
  const texts: string[] = [];
  let consumed = 0;
  while (consumed < lines.length) {
    const m = lines[consumed].match(taskRe);
    if (!m) break;
    const [inlineNodes, p] = inline(m[3]);
    items.push(node("taskItem", { checked: m[2].toLowerCase() === "x" }, [node("paragraph", null, inlineNodes)]));
    texts.push(p);
    consumed += 1;
  }
  return [items, texts, consumed || 1];
}

function parseQuote(lines: string[]): [Node, string[], number] {
  const paras: Node[] = [];
  const texts: string[] = [];
  let consumed = 0;
  while (consumed < lines.length) {
    const trimmed = lines[consumed].trim();
    if (!trimmed.startsWith(">")) break;
    const rest = trimmed.replace(/^>\s?/, "").trim();
    consumed += 1;
    if (!rest) continue;
    const [inlineNodes, p] = inline(rest);
    paras.push(node("paragraph", null, inlineNodes));
    texts.push(p);
  }
  return [node("blockquote", null, paras.length ? paras : [node("paragraph")]), texts, consumed || 1];
}

function parseTable(lines: string[]): [Node, string[], number] {
  const rows: string[][] = [];
  let consumed = 0;
  while (consumed < lines.length) {
    const trimmed = lines[consumed].trim();
    if (consumed === 1 && tableSepRe.test(trimmed)) {
      consumed += 1;
      continue;
    }
    if (!tableRowRe.test(trimmed)) break;
    rows.push(
      trimmed
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
    consumed += 1;
  }
  const tableRows: Node[] = [];
  const texts: string[] = [];
  rows.forEach((row, r) => {
    const cells = row.map((cell) => {
      const [inlineNodes, p] = inline(cell);
      texts.push(p);
      return node(r === 0 ? "tableHeader" : "tableCell", null, [node("paragraph", null, inlineNodes)]);
    });
    tableRows.push(node("tableRow", null, cells));
  });
  return [node("table", null, tableRows), texts, consumed];
}

function inline(src: string): [Node[], string] {
  if (!src) return [[], ""];
  let rest = src;
  const nodes: Node[] = [];
  let plain = "";

  while (rest) {
    if (rest.startsWith("[@")) {
      const m = rest.match(mentionRe);
      if (m && rest.startsWith(m[0])) {
        nodes.push({ type: "mention", attrs: { id: m[3], label: m[1], entityType: m[2] } });
        plain += `@${m[1]}`;
        rest = rest.slice(m[0].length);
        continue;
      }
    }
    if (rest.startsWith("[")) {
      const m = rest.match(linkRe);
      if (m && rest.startsWith(m[0]) && !rest.startsWith("[@")) {
        const [, label, href] = m;
        const [labelNodes, p] = inline(label);
        // Keep bold/italic/code inside the label and layer the link on top.
        const linkMark: Mark = { type: "link", attrs: { href } };
        for (const child of labelNodes) {
          if (child.type === "text") {
            nodes.push({ ...child, marks: [...(child.marks ?? []), linkMark] });
          } else {
            nodes.push(child);
          }
        }
        if (labelNodes.length === 0) nodes.push(textNode(p || href, [linkMark]));
        plain += p;
        rest = rest.slice(m[0].length);
        continue;
      }
    }

    const next = firstInline(rest);
    if (next.start > 0) {
      const chunk = rest.slice(0, next.start);
      nodes.push(textNode(chunk));
      plain += chunk;
      rest = rest.slice(next.start);
      continue;
    }
    if (!next.length) {
      nodes.push(textNode(rest));
      plain += rest;
      break;
    }
    const inner = rest.slice(next.innerStart, next.innerEnd);
    nodes.push(textNode(inner, [{ type: next.mark }]));
    plain += inner;
    rest = rest.slice(next.length);
  }

  return [nodes, plain];
}

function firstInline(src: string): { start: number; length: number; innerStart: number; innerEnd: number; mark: string } {
  let best = { start: src.length, length: 0, innerStart: 0, innerEnd: 0, mark: "" };
  const tryRe = (re: RegExp, mark: string) => {
    const m = re.exec(src);
    if (!m || m.index === undefined) return;
    if (m.index < best.start) {
      best = {
        start: m.index,
        length: m[0].length,
        innerStart: m.index + m[0].indexOf(m[1]),
        innerEnd: m.index + m[0].indexOf(m[1]) + m[1].length,
        mark,
      };
    }
  };
  tryRe(boldRe, "bold");
  tryRe(italicRe, "italic");
  tryRe(strikeRe, "strike");
  tryRe(highlightRe, "highlight");
  tryRe(codeRe, "code");
  tryRe(underlineRe, "underline");

  // Links and mentions are handled by the `[` branch in inline(), but only
  // when they sit at the start of the remaining text. Report their position
  // with zero length so the plain text before them is emitted first and the
  // loop comes back around with `[` at the front.
  for (const re of [mentionRe, linkRe]) {
    const m = re.exec(src);
    if (m && m.index !== undefined && m.index > 0 && m.index < best.start) {
      best = { start: m.index, length: 0, innerStart: 0, innerEnd: 0, mark: "" };
    }
  }

  if (best.start === src.length) return { start: 0, length: 0, innerStart: 0, innerEnd: 0, mark: "" };
  return best;
}

/** Walks a TipTap document back to markdown (same rules as the API). */
export function richToMarkdown(content: DocContent | null | undefined): string {
  if (!content) return "";
  return renderNodes((content.content as Node[]) ?? [], 0).trim();
}

function asNodes(value: unknown): Node[] {
  return Array.isArray(value) ? (value as Node[]) : [];
}

function renderNodes(nodes: Node[], depth: number): string {
  let out = "";
  for (const n of nodes) {
    switch (n.type) {
      case "paragraph":
        out += `${renderInline(asNodes(n.content))}\n\n`;
        break;
      case "heading": {
        const level = Number(n.attrs?.level ?? 1) || 1;
        out += `${"#".repeat(level)} ${renderInline(asNodes(n.content))}\n\n`;
        break;
      }
      case "bulletList":
        for (const item of asNodes(n.content)) {
          out += `- ${renderNodes(asNodes(item.content), depth + 1).trim()}\n`;
        }
        out += "\n";
        break;
      case "orderedList":
        asNodes(n.content).forEach((item, i) => {
          out += `${i + 1}. ${renderNodes(asNodes(item.content), depth + 1).trim()}\n`;
        });
        out += "\n";
        break;
      case "taskList":
        for (const item of asNodes(n.content)) {
          const mark = item.attrs?.checked ? "x" : " ";
          out += `- [${mark}] ${renderNodes(asNodes(item.content), depth + 1).trim()}\n`;
        }
        out += "\n";
        break;
      case "listItem":
      case "taskItem":
        out += renderNodes(asNodes(n.content), depth + 1);
        break;
      case "blockquote":
        for (const line of renderNodes(asNodes(n.content), depth + 1).trim().split("\n")) {
          out += `> ${line}\n`;
        }
        out += "\n";
        break;
      case "codeBlock":
        out += `\`\`\`${String(n.attrs?.language ?? "")}\n${renderInline(asNodes(n.content))}\n\`\`\`\n\n`;
        break;
      case "horizontalRule":
        out += "---\n\n";
        break;
      case "table":
        out += renderTable(asNodes(n.content));
        break;
      case "hardBreak":
        out += "\n";
        break;
      default:
        out += renderInline([n]);
    }
  }
  return out;
}

function renderTable(rows: Node[]): string {
  const lines: string[] = [];
  rows.forEach((row, r) => {
    const cells = asNodes(row.content).map((cell) =>
      renderNodes(asNodes(cell.content), 0).trim().replace(/\n/g, " "),
    );
    lines.push(`| ${cells.join(" | ")} |`);
    if (r === 0) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
  });
  return `${lines.join("\n")}\n\n`;
}

function renderInline(nodes: Node[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "mention") {
      const label = String(n.attrs?.label ?? "mention");
      const id = String(n.attrs?.id ?? "");
      const entity = String(n.attrs?.entityType ?? "task");
      out += `[@${label}](timely://${entity}/${id})`;
      continue;
    }
    if (n.type === "hardBreak") {
      out += "\n";
      continue;
    }
    if (n.type === "text") {
      let text = n.text ?? "";
      for (const mark of [...(n.marks ?? [])].reverse()) {
        switch (mark.type) {
          case "bold":
            text = `**${text}**`;
            break;
          case "italic":
            text = `*${text}*`;
            break;
          case "strike":
            text = `~~${text}~~`;
            break;
          case "code":
            text = `\`${text}\``;
            break;
          case "underline":
            text = `<u>${text}</u>`;
            break;
          case "highlight":
            text = `==${text}==`;
            break;
          case "link":
            text = `[${text}](${String(mark.attrs?.href ?? "")})`;
            break;
        }
      }
      out += text;
      continue;
    }
    out += renderInline(asNodes(n.content));
  }
  return out;
}

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
  if (source.trim()) return fromMarkdown(source).content;
  return content && typeof content.type === "string" ? content : { type: "doc", content: [] };
}
