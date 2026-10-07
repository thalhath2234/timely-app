import { Marked, type Token, type Tokens, type TokenizerAndRendererExtension } from "marked";
import type { DocContent } from "./documents";

/**
 * Markdown -> Tiptap document, shared by the web and mobile apps.
 *
 * This is the inverse of the API's `richtext.ToMarkdown`, so a doc exported
 * as .md and imported again comes back as the same doc. Both sides follow the
 * same mapping (see docs/markdown.md):
 *
 *   headings 1-6, paragraphs, bullet / ordered / task lists (nested),
 *   blockquotes, fenced code with language, horizontal rules, GFM tables
 *   (first row is the header, `<br>` is a line break, `\|` a pipe), images,
 *   **bold**, *italic*, ~~strike~~, `code`, [links](url), ==highlight==,
 *   <u>underline</u>, hard breaks, a paragraph holding only `<br>` is an
 *   empty paragraph, [@Label](timely://task/id) is a mention and
 *   [Label](timely://doc/id) a subpage link.
 */

type Attrs = Record<string, unknown>;
type Mark = { type: string; attrs?: Attrs };
export type MarkdownNode = {
  type: string;
  text?: string;
  attrs?: Attrs;
  marks?: Mark[];
  content?: MarkdownNode[];
};

export interface FromMarkdownOptions {
  /** Treat single newlines as line breaks (chat text) instead of spaces. */
  breaks?: boolean;
}

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
  const value = (raw ?? "").trim().split(/\s+/)[0].toLowerCase();
  if (!value) return "";
  return LANGUAGE_ALIASES[value] ?? value;
}

const MENTION_TYPES = new Set(["task", "project", "doc", "sheet"]);
const mentionHrefRe = /^timely:\/\/([a-z]+)\/(.+)$/;

const highlightExtension: TokenizerAndRendererExtension = {
  name: "highlight",
  level: "inline",
  start(src) {
    const index = src.indexOf("==");
    return index < 0 ? undefined : index;
  },
  tokenizer(src) {
    const match = /^==(?=[^\s=])([^\n]*?[^\s\\])==(?!=)/.exec(src);
    if (!match) return undefined;
    return {
      type: "highlight",
      raw: match[0],
      text: match[1],
      tokens: this.lexer.inlineTokens(match[1]),
    };
  },
  renderer: () => "",
};

const parser = new Marked({ gfm: true, extensions: [highlightExtension] });

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X"
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const brTagRe = /^<br\s*\/?>$/i;

function paragraph(content: MarkdownNode[] = []): MarkdownNode {
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function withMark(marks: Mark[], mark: Mark): Mark[] {
  return marks.some((existing) => existing.type === mark.type) ? marks : [...marks, mark];
}

function withoutMark(marks: Mark[], type: string): Mark[] {
  return marks.filter((mark) => mark.type !== type);
}

function sameMarks(a: Mark[], b: Mark[]) {
  return (
    a.length === b.length &&
    a.every((mark, i) => mark.type === b[i].type && mark.attrs?.href === b[i].attrs?.href)
  );
}

class InlineBuilder {
  nodes: MarkdownNode[] = [];
  private options: FromMarkdownOptions;

  constructor(options: FromMarkdownOptions) {
    this.options = options;
  }

  text(value: string, marks: Mark[]) {
    const lines = value.split("\n");
    lines.forEach((line, index) => {
      if (index > 0) {
        if (this.options.breaks) this.nodes.push({ type: "hardBreak" });
        else line = ` ${line}`;
      }
      if (!line) return;
      // Join with the previous run when the marks match, so escapes and
      // entities do not leave a run split across several text nodes.
      const prev = this.nodes[this.nodes.length - 1];
      if (prev?.type === "text" && sameMarks(prev.marks ?? [], marks)) {
        prev.text += line;
        return;
      }
      const node: MarkdownNode = { type: "text", text: line };
      if (marks.length) node.marks = marks;
      this.nodes.push(node);
    });
  }

  tokens(tokens: Token[] | undefined, inherited: Mark[]) {
    let marks = inherited;
    for (const token of tokens ?? []) {
      switch (token.type) {
        case "text": {
          const text = token as Tokens.Text;
          if (text.tokens?.length) this.tokens(text.tokens, marks);
          else this.text(decodeEntities(text.text), marks);
          break;
        }
        case "escape":
          this.text((token as Tokens.Escape).text, marks);
          break;
        case "strong":
          this.tokens((token as Tokens.Strong).tokens, withMark(marks, { type: "bold" }));
          break;
        case "em":
          this.tokens((token as Tokens.Em).tokens, withMark(marks, { type: "italic" }));
          break;
        case "del":
          this.tokens((token as Tokens.Del).tokens, withMark(marks, { type: "strike" }));
          break;
        case "highlight":
          this.tokens((token as Tokens.Generic).tokens, withMark(marks, { type: "highlight" }));
          break;
        case "codespan":
          this.text((token as Tokens.Codespan).text, withMark(marks, { type: "code" }));
          break;
        case "br":
          this.nodes.push({ type: "hardBreak" });
          break;
        case "image": {
          const image = token as Tokens.Image;
          const attrs: Attrs = { src: image.href };
          if (image.text) attrs.alt = decodeEntities(image.text);
          if (image.title) attrs.title = image.title;
          this.nodes.push({ type: "image", attrs });
          break;
        }
        case "link": {
          const link = token as Tokens.Link;
          const mention = mentionHrefRe.exec(link.href);
          if (mention && MENTION_TYPES.has(mention[1])) {
            const label = plainOf(inlineOf(link.tokens, this.options));
            const isInline = label.startsWith("@");
            const attrs: Attrs = {
              id: mention[2],
              label: isInline ? label.slice(1) : label,
              entityType: mention[1],
            };
            if (!isInline) attrs.appearance = "page";
            this.nodes.push({ type: "mention", attrs });
            break;
          }
          this.tokens(link.tokens, withMark(marks, { type: "link", attrs: { href: link.href } }));
          break;
        }
        case "html": {
          const tag = (token as Tokens.HTML).text.trim().toLowerCase();
          if (tag === "<u>") marks = withMark(marks, { type: "underline" });
          else if (tag === "</u>") marks = withoutMark(marks, "underline");
          else if (tag === "<mark>") marks = withMark(marks, { type: "highlight" });
          else if (tag === "</mark>") marks = withoutMark(marks, "highlight");
          else if (brTagRe.test(tag)) this.nodes.push({ type: "hardBreak" });
          else this.text((token as Tokens.HTML).text, marks);
          break;
        }
        default: {
          const generic = token as Tokens.Generic;
          if (generic.tokens?.length) this.tokens(generic.tokens, marks);
          else if (typeof generic.text === "string") this.text(generic.text, marks);
        }
      }
    }
  }
}

function inlineOf(tokens: Token[] | undefined, options: FromMarkdownOptions) {
  const builder = new InlineBuilder(options);
  builder.tokens(tokens, []);
  return builder.nodes;
}

function isOnlyBreak(tokens: Token[] | undefined) {
  const meaningful = (tokens ?? []).filter(
    (token) => !(token.type === "text" && !(token as Tokens.Text).text.trim()),
  );
  return (
    meaningful.length === 1 &&
    meaningful[0].type === "html" &&
    brTagRe.test((meaningful[0] as Tokens.HTML).text.trim())
  );
}

function listItemContent(item: Tokens.ListItem, options: FromMarkdownOptions) {
  const children = blocksOf(
    item.tokens.filter((token) => token.type !== "checkbox"),
    options,
  );
  // Tiptap list items must start with a paragraph.
  if (children[0]?.type !== "paragraph") children.unshift(paragraph());
  return children;
}

function blocksOf(tokens: Token[], options: FromMarkdownOptions): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "space":
      case "def":
        break;
      case "heading": {
        const heading = token as Tokens.Heading;
        const content = inlineOf(heading.tokens, options);
        out.push({
          type: "heading",
          attrs: { level: heading.depth },
          ...(content.length ? { content } : {}),
        });
        break;
      }
      case "paragraph":
      case "text": {
        const tokens = (token as Tokens.Paragraph).tokens;
        out.push(isOnlyBreak(tokens) ? paragraph() : paragraph(inlineOf(tokens, options)));
        break;
      }
      case "code": {
        const code = token as Tokens.Code;
        const language = normalizeCodeLanguage(code.lang);
        out.push({
          type: "codeBlock",
          attrs: { language: language || null },
          ...(code.text ? { content: [{ type: "text", text: code.text }] } : {}),
        });
        break;
      }
      case "hr":
        out.push({ type: "horizontalRule" });
        break;
      case "blockquote": {
        const content = blocksOf((token as Tokens.Blockquote).tokens, options);
        out.push({ type: "blockquote", content: content.length ? content : [paragraph()] });
        break;
      }
      case "list": {
        const list = token as Tokens.List;
        const isTaskList = list.items.length > 0 && list.items.every((item) => item.task);
        if (isTaskList) {
          out.push({
            type: "taskList",
            content: list.items.map((item) => ({
              type: "taskItem",
              attrs: { checked: Boolean(item.checked) },
              content: listItemContent(item, options),
            })),
          });
          break;
        }
        const items = list.items.map((item) => {
          const content = listItemContent(item, options);
          // A checkbox in a list that is not all tasks stays visible as text.
          if (item.task) {
            const first = content[0];
            first.content = [{ type: "text", text: item.checked ? "[x] " : "[ ] " }, ...(first.content ?? [])];
          }
          return { type: "listItem", content };
        });
        if (list.ordered) {
          const start = Number(list.start);
          out.push({
            type: "orderedList",
            attrs: { start: Number.isFinite(start) && list.start !== "" ? start : 1 },
            content: items,
          });
        } else {
          out.push({ type: "bulletList", content: items });
        }
        break;
      }
      case "table": {
        const table = token as Tokens.Table;
        const row = (cells: Tokens.TableCell[], kind: string): MarkdownNode => ({
          type: "tableRow",
          content: cells.map((cell) => ({
            type: kind,
            content: [paragraph(inlineOf(cell.tokens, options))],
          })),
        });
        out.push({
          type: "table",
          content: [row(table.header, "tableHeader"), ...table.rows.map((cells) => row(cells, "tableCell"))],
        });
        break;
      }
      case "html": {
        const raw = (token as Tokens.HTML).text.trim();
        if (brTagRe.test(raw)) {
          out.push(paragraph());
          break;
        }
        // Other raw HTML has no editor equivalent; keep its source as text.
        const content: MarkdownNode[] = [];
        raw.split("\n").forEach((line, index) => {
          if (index > 0) content.push({ type: "hardBreak" });
          if (line) content.push({ type: "text", text: line });
        });
        out.push(paragraph(content));
        break;
      }
      default: {
        const generic = token as Tokens.Generic;
        if (generic.tokens?.length) out.push(paragraph(inlineOf(generic.tokens, options)));
      }
    }
  }
  return out;
}

function plainOf(nodes: MarkdownNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === "text") return node.text ?? "";
      if (node.type === "hardBreak") return "\n";
      if (node.type === "mention") {
        const label = String(node.attrs?.label ?? "");
        return node.attrs?.appearance === "page" ? label : `@${label}`;
      }
      if (node.type === "image") return String(node.attrs?.alt ?? "");
      return plainOf(node.content);
    })
    .join("");
}

function blockTexts(nodes: MarkdownNode[], out: string[]) {
  for (const node of nodes) {
    const hasBlocks = node.content?.some((child) => child.type !== "text" && child.type !== "hardBreak" && child.type !== "mention" && child.type !== "image");
    if (node.type === "codeBlock" || !hasBlocks) {
      const text = plainOf(node.content);
      if (text) out.push(text);
    } else {
      blockTexts(node.content ?? [], out);
    }
  }
}

/** Turns Markdown into a Tiptap document plus its plain text for search. */
export function fromMarkdown(
  src: string,
  options: FromMarkdownOptions = {},
): { content: DocContent; plainText: string } {
  const tokens = parser.lexer(src.replace(/\r\n?/g, "\n"));
  const content = blocksOf(tokens, options);
  if (content.length === 0) content.push(paragraph());
  const texts: string[] = [];
  blockTexts(content, texts);
  return { content: { type: "doc", content }, plainText: texts.join("\n") };
}
