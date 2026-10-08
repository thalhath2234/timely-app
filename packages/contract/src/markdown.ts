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
 *
 * Plus the extras GitHub and Obsidian read: $math$ and $$ blocks,
 * > [!NOTE] callouts, [^footnotes], --- frontmatter at the top of the file
 * and [[wiki links]] (![[embeds]]). The Go side is apps/api/internal/richtext.
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

// $x$ and $$x$$ on one line. No space just inside the dollars, and the
// closing dollar is not followed by a digit, so "$5 and $10" stays text.
const mathInlineRe = /^\$(?:\$([^$\n]+?)\$|([^\s$](?:[^$\n]*?[^\s$\\])?))\$(?![0-9])/;

const mathInlineExtension: TokenizerAndRendererExtension = {
  name: "mathInline",
  level: "inline",
  start(src) {
    const index = src.indexOf("$");
    return index < 0 ? undefined : index;
  },
  tokenizer(src) {
    const match = mathInlineRe.exec(src);
    if (!match) return undefined;
    return { type: "mathInline", raw: match[0], latex: match[1] ?? match[2] };
  },
  renderer: () => "",
};

// $$ on its own line opens a block that the next $$ line closes; $$x$$ on
// one line is a whole block. Text after the opening $$ is the first line.
const mathBlockRe = /^\$\$[ \t]*(?:([^\n]*?)[ \t]*\$\$[ \t]*(?:\n|$)|([^\n]*)\n([\s\S]*?)\n[ \t]*\$\$[ \t]*(?:\n|$))/;

const mathBlockExtension: TokenizerAndRendererExtension = {
  name: "mathBlock",
  level: "block",
  start(src) {
    const match = /(^|\n)\$\$/.exec(src);
    return match ? match.index + match[1].length : undefined;
  },
  tokenizer(src) {
    const match = mathBlockRe.exec(src);
    if (!match) return undefined;
    const text = match[1] !== undefined
      ? match[1]
      : (match[2].trim() ? `${match[2].trim()}\n` : "") + match[3];
    return { type: "mathBlock", raw: match[0], text };
  },
  renderer: () => "",
};

/** Labels defined in the file being parsed; [^x] is a reference only when
 * x is defined, as in GitHub and Obsidian. Set per fromMarkdown call. */
let definedFootnotes = new Set<string>();

// [^label]: text, with continuation lines indented four spaces.
const footnoteDefRe = /^\[\^([^\s[\]]+)\]:(?:[ \t]+([^\n]*)|[ \t]*)(?:\n|$)((?:[ \t]*\n|(?: {4}|\t)[^\n]*(?:\n|$))*)/;

const footnoteDefExtension: TokenizerAndRendererExtension = {
  name: "footnoteDef",
  level: "block",
  start(src) {
    const match = /(^|\n)\[\^/.exec(src);
    return match ? match.index + match[1].length : undefined;
  },
  tokenizer(src) {
    const match = footnoteDefRe.exec(src);
    if (!match) return undefined;
    const continuation = match[3].replace(/^(?: {4}|\t)/gm, "");
    const body = `${match[2] ?? ""}\n${continuation}`;
    return {
      type: "footnoteDef",
      raw: match[0],
      label: match[1],
      tokens: this.lexer.blockTokens(body),
    };
  },
  renderer: () => "",
};

const footnoteRefExtension: TokenizerAndRendererExtension = {
  name: "footnoteRef",
  level: "inline",
  start(src) {
    const index = src.indexOf("[^");
    return index < 0 ? undefined : index;
  },
  tokenizer(src) {
    const match = /^\[\^([^\s[\]]+)\]/.exec(src);
    if (!match || !definedFootnotes.has(match[1])) return undefined;
    return { type: "footnoteRef", raw: match[0], label: match[1] };
  },
  renderer: () => "",
};

// [[Page]], [[Page|alias]] and ![[Page]]; inside a table cell the separator
// may still be written \|.
const wikiLinkRe = /^(!?)\[\[((?:\\\||[^[\]|\n])+?)(?:\\?\|((?:\\\||[^[\]|\n])*))?\]\]/;

const wikiLinkExtension: TokenizerAndRendererExtension = {
  name: "wikiLink",
  level: "inline",
  start(src) {
    const index = src.indexOf("[[");
    if (index < 0) return undefined;
    return index > 0 && src[index - 1] === "!" ? index - 1 : index;
  },
  tokenizer(src) {
    const match = wikiLinkRe.exec(src);
    if (!match) return undefined;
    return {
      type: "wikiLink",
      raw: match[0],
      embed: match[1] === "!",
      target: match[2].replace(/\\\|/g, "|"),
      alias: match[3]?.replace(/\\\|/g, "|") ?? "",
    };
  },
  renderer: () => "",
};

const parser = new Marked({
  gfm: true,
  extensions: [
    highlightExtension,
    mathInlineExtension,
    mathBlockExtension,
    footnoteDefExtension,
    footnoteRefExtension,
    wikiLinkExtension,
  ],
});

const frontmatterRe = /^---\n((?:.*\n)*?)---(?:\n|$)/;
const calloutHeadRe = /^\[!([A-Za-z]+)\][ \t]*(.*?)[ \t]*$/;

/** Resolves backslash escapes and entities in text taken from a raw line. */
function unescapeRaw(text: string) {
  return decodeEntities(text.replace(/\\([!-/:-@[-`{-~])/g, "$1"));
}

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
        case "mathInline":
          this.nodes.push({ type: "mathInline", attrs: { latex: String((token as Tokens.Generic).latex) } });
          break;
        case "footnoteRef":
          this.nodes.push({ type: "footnoteRef", attrs: { label: String((token as Tokens.Generic).label) } });
          break;
        case "wikiLink": {
          const link = token as Tokens.Generic;
          const attrs: Attrs = { target: String(link.target), embed: Boolean(link.embed) };
          if (link.alias) attrs.alias = String(link.alias);
          this.nodes.push({ type: "wikiLink", attrs });
          break;
        }
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

/** A block holding verbatim text (a formula, frontmatter) as one text node. */
function rawBlock(type: string, text: string): MarkdownNode {
  return text ? { type, content: [{ type: "text", text }] } : { type };
}

/** A quote whose first line is [!KIND] or [!KIND] Title is a callout. The
 * marker may be a paragraph of its own (how the exporter writes it) or the
 * first line of the body's paragraph (how people type it). */
function calloutOf(quote: Tokens.Blockquote, options: FromMarkdownOptions): MarkdownNode | null {
  const [first, ...rest] = quote.tokens;
  if (first?.type !== "paragraph") return null;
  const text = (first as Tokens.Paragraph).text;
  const newline = text.indexOf("\n");
  const head = newline < 0 ? text : text.slice(0, newline);
  const match = calloutHeadRe.exec(head);
  if (!match) return null;
  const attrs: Attrs = { kind: match[1].toLowerCase(), title: match[2] ? unescapeRaw(match[2]) : null };
  const content: MarkdownNode[] = [];
  if (newline >= 0) content.push(...blocksOf(parser.lexer(text.slice(newline + 1)), options));
  content.push(...blocksOf(rest, options));
  return { type: "callout", attrs, content: content.length ? content : [paragraph()] };
}

// Toggles are HTML <details> with a plain-text <summary> (see
// richtext/blocks.go): the opening tag, the body blocks, then </details>.
const detailsOpenRe = /^<details(\s+open(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)?\s*>\s*<summary>([\s\S]*?)<\/summary>\s*(<\/details>)?$/i;
const detailsCloseRe = /^<\/details>$/i;

function detailsNode(summary: string, open: boolean, body: MarkdownNode[]): MarkdownNode {
  return {
    type: "details",
    attrs: { open },
    content: [
      summary ? { type: "detailsSummary", content: [{ type: "text", text: summary }] } : { type: "detailsSummary" },
      ...(body.length ? body : [paragraph()]),
    ],
  };
}

/** Reads a toggle starting at tokens[start]; returns it and the index of the
 * closing tag, or null when there is no closing tag (then it is raw HTML). */
function detailsAt(tokens: Token[], start: number, options: FromMarkdownOptions): [MarkdownNode, number] | null {
  const token = tokens[start];
  if (token.type !== "html") return null;
  const match = detailsOpenRe.exec((token as Tokens.HTML).text.trim());
  if (!match) return null;
  const summary = decodeEntities(match[2].trim());
  const open = match[1] !== undefined;
  if (match[3]) return [detailsNode(summary, open, []), start];
  const body: MarkdownNode[] = [];
  for (let i = start + 1; i < tokens.length; i += 1) {
    const current = tokens[i];
    if (current.type === "html" && detailsCloseRe.test((current as Tokens.HTML).text.trim())) {
      return [detailsNode(summary, open, body), i];
    }
    const nested = containerAt(tokens, i, options);
    if (nested) {
      body.push(nested[0]);
      i = nested[1];
      continue;
    }
    body.push(...blocksOf([current], options));
  }
  return null;
}

const columnsOpenRe = /^<!--\s*columns\s*-->$/;
const columnBreakRe = /^<!--\s*column\s*-->$/;
const columnsCloseRe = /^<!--\s*\/columns\s*-->$/;

function columnNode(body: MarkdownNode[]): MarkdownNode {
  return { type: "column", content: body.length ? body : [paragraph()] };
}

/** Reads columns starting at tokens[start] (`<!-- columns -->`, blocks,
 * `<!-- column -->` between columns, `<!-- /columns -->`); see
 * apps/api/internal/richtext/columns.go. */
function columnsAt(tokens: Token[], start: number, options: FromMarkdownOptions): [MarkdownNode, number] | null {
  const token = tokens[start];
  if (token.type !== "html" || !columnsOpenRe.test((token as Tokens.HTML).text.trim())) return null;
  const columns: MarkdownNode[] = [];
  let body: MarkdownNode[] = [];
  for (let i = start + 1; i < tokens.length; i += 1) {
    const current = tokens[i];
    if (current.type === "html") {
      const raw = (current as Tokens.HTML).text.trim();
      if (columnsCloseRe.test(raw)) {
        columns.push(columnNode(body));
        return [{ type: "columns", content: columns }, i];
      }
      if (columnBreakRe.test(raw)) {
        columns.push(columnNode(body));
        body = [];
        continue;
      }
    }
    const nested = containerAt(tokens, i, options);
    if (nested) {
      body.push(nested[0]);
      i = nested[1];
      continue;
    }
    body.push(...blocksOf([current], options));
  }
  return null;
}

/** A block written over several tokens: a toggle or columns. */
function containerAt(tokens: Token[], start: number, options: FromMarkdownOptions) {
  return detailsAt(tokens, start, options) ?? columnsAt(tokens, start, options);
}

/** Links Timely can show as an embed (see embeds.ts, which builds the
 * player from the match). Kept here so this module has no value imports;
 * keep in step with apps/api/internal/richtext/embeds.go. */
export const EMBED_PATTERNS: { provider: string; pattern: RegExp }[] = [
  { provider: "YouTube", pattern: /^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)([\w-]{11})/i },
  { provider: "YouTube", pattern: /^https?:\/\/youtu\.be\/([\w-]{11})/i },
  { provider: "Vimeo", pattern: /^https?:\/\/(?:www\.)?vimeo\.com\/(?:video\/)?(\d+)/i },
  { provider: "Loom", pattern: /^https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([0-9a-f]+)/i },
  { provider: "Spotify", pattern: /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show|artist)\/(\w+)/i },
  { provider: "Figma", pattern: /^https?:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|board)\/\w+/i },
  { provider: "CodePen", pattern: /^https?:\/\/codepen\.io\/([\w-]+)\/(?:pen|full|details|embed)\/(\w+)/i },
];

export function isEmbedUrl(link: string) {
  return EMBED_PATTERNS.some(({ pattern }) => pattern.test(link));
}

const BOOKMARK_MARKER = "<!-- bookmark -->";

/** A paragraph that is only an embeddable image (`![](https://youtu.be/...)`)
 * or only a bookmark link (`[Title](url "description")<!-- bookmark -->`).
 * See embeds.ts and apps/api/internal/richtext/embeds.go. */
function linkBlockOf(tokens: Token[] | undefined, options: FromMarkdownOptions): MarkdownNode | null {
  const [first, second, ...rest] = tokens ?? [];
  if (!first || rest.length) return null;
  if (first.type === "image" && !second && isEmbedUrl((first as Tokens.Image).href)) {
    return { type: "embed", attrs: { src: (first as Tokens.Image).href } };
  }
  if (first.type === "link" && second?.type === "html" && (second as Tokens.HTML).text.trim() === BOOKMARK_MARKER) {
    const link = first as Tokens.Link;
    const title = plainOf(inlineOf(link.tokens, options));
    return {
      type: "bookmark",
      attrs: { url: link.href, title: title === link.href ? "" : title, description: link.title ?? "" },
    };
  }
  return null;
}

function blocksOf(tokens: Token[], options: FromMarkdownOptions): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const toggle = containerAt(tokens, index, options);
    if (toggle) {
      out.push(toggle[0]);
      index = toggle[1];
      continue;
    }
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
        const link = linkBlockOf(tokens, options);
        if (link) {
          out.push(link);
          break;
        }
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
        const callout = calloutOf(token as Tokens.Blockquote, options);
        if (callout) {
          out.push(callout);
          break;
        }
        const content = blocksOf((token as Tokens.Blockquote).tokens, options);
        out.push({ type: "blockquote", content: content.length ? content : [paragraph()] });
        break;
      }
      case "mathBlock":
        out.push(rawBlock("mathBlock", String((token as Tokens.Generic).text)));
        break;
      case "footnoteDef": {
        const def = token as Tokens.Generic;
        const content = blocksOf(def.tokens ?? [], options);
        out.push({
          type: "footnote",
          attrs: { label: String(def.label) },
          content: content.length ? content : [paragraph()],
        });
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
      if (node.type === "mathInline") return String(node.attrs?.latex ?? "");
      if (node.type === "wikiLink") return String(node.attrs?.alias || node.attrs?.target || "");
      if (node.type === "footnoteRef") return "";
      return plainOf(node.content);
    })
    .join("");
}

const INLINE_TYPES = new Set(["text", "hardBreak", "mention", "image", "mathInline", "footnoteRef", "wikiLink"]);

function blockTexts(nodes: MarkdownNode[], out: string[]) {
  for (const node of nodes) {
    if (node.type === "bookmark") {
      const text = `${node.attrs?.title ?? ""} ${node.attrs?.description ?? ""}`.trim();
      if (text) out.push(text);
      continue;
    }
    const hasBlocks = node.content?.some((child) => !INLINE_TYPES.has(child.type));
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
  let source = src.replace(/\r\n?/g, "\n");
  const content: MarkdownNode[] = [];
  const front = frontmatterRe.exec(source);
  if (front) {
    content.push(rawBlock("frontmatter", front[1].replace(/\n$/, "")));
    source = source.slice(front[0].length);
  }
  definedFootnotes = new Set(
    [...source.matchAll(/^\[\^([^\s[\]]+)\]:(?:[ \t]|$)/gm)].map((match) => match[1]),
  );
  content.push(...blocksOf(parser.lexer(source), options));
  if (content.length === 0) content.push(paragraph());
  const texts: string[] = [];
  blockTexts(content, texts);
  return { content: { type: "doc", content }, plainText: texts.join("\n") };
}
