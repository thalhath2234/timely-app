import type { DocContent } from "../../lib/types";
import { EMBED_PATTERNS } from "@timely/contract/markdown";
import { DOC_EDITOR_HELPERS_JS } from "../../lib/docEditorJev";

const BLANK: DocContent = { type: "doc", content: [{ type: "paragraph" }] };

function embed(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** TipTap 3 document loaded in a WebView — same schema as the web /m editor. */
export function buildEditorHtml(
  content: DocContent | null | undefined,
  placeholder: string,
  theme?: {
    mode: "light" | "dark";
    background: string;
    foreground: string;
    muted: string;
    mutedForeground: string;
    primary: string;
    accent: string;
    accentForeground: string;
    border: string;
  },
  /** The server address; uploaded images are stored as "/files/<id>". */
  apiBase = "",
) {
  const initial = content && typeof content.type === "string" ? content : BLANK;
  const t = theme ?? {
    mode: "dark" as const,
    background: "#1a1b22",
    foreground: "#ececf1",
    muted: "#2c2d36",
    mutedForeground: "#9a9aa8",
    primary: "#8b7cf7",
    accent: "#3a3558",
    accentForeground: "#d4cff5",
    border: "rgba(255,255,255,0.09)",
  };
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, editable=true" />
  <style>
    :root { color-scheme: ${t.mode}; }
    html, body { margin: 0; padding: 0; background: ${t.background}; }
    body { min-height: 100%; }
    #editor { min-height: 70vh; padding: 4px 2px 120px; box-sizing: border-box; }
    .tiptap { outline: none; color: ${t.foreground}; font-size: 16px; line-height: 1.55; font-family: ui-sans-serif, system-ui, sans-serif; }
    .tiptap p { margin: 0 0 0.75em; }
    .tiptap h1 { font-size: 26px; line-height: 1.25; font-weight: 700; margin: 0.8em 0 0.4em; }
    .tiptap h2 { font-size: 22px; line-height: 1.3; font-weight: 700; margin: 0.7em 0 0.35em; }
    .tiptap h3 { font-size: 18px; line-height: 1.35; font-weight: 600; margin: 0.6em 0 0.3em; }
    .tiptap h4 { font-size: 16px; line-height: 1.4; font-weight: 600; margin: 0.6em 0 0.3em; }
    .tiptap h5 { font-size: 15px; line-height: 1.4; font-weight: 600; margin: 0.5em 0 0.25em; }
    .tiptap h6 { font-size: 14px; line-height: 1.4; font-weight: 600; margin: 0.5em 0 0.25em; color: ${t.mutedForeground}; }
    .code-wrap { background: ${t.muted}; border: 1px solid ${t.border}; border-radius: 12px; overflow: clip; margin: 0 0 0.75em; }
    .tiptap .code-wrap pre { margin: 0; border: 0; border-radius: 0; background: transparent; }
    .code-wrap pre.is-folded { max-height: calc(36px + 3lh); overflow: hidden; padding-bottom: 0; -webkit-mask-image: linear-gradient(to bottom, #000 60%, transparent); mask-image: linear-gradient(to bottom, #000 60%, transparent); }
    .code-fold { position: sticky; bottom: 0; z-index: 2; display: flex; justify-content: center; padding: 6px; background: ${t.background}; border-top: 1px solid ${t.border}; }
    .code-fold button { background: ${t.background}; color: ${t.mutedForeground}; border: 1px solid ${t.border}; border-radius: 999px; font-size: 12px; font-weight: 600; padding: 5px 12px; }
    .mermaid-out { padding: 10px 12px; background: ${t.background}; border-top: 1px solid ${t.border}; overflow-x: auto; font-size: 13px; color: ${t.mutedForeground}; }
    .mermaid-out svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
    .mermaid-out.mermaid-error { color: #e5484d; font-family: ui-monospace, monospace; white-space: pre-wrap; }
    .tiptap img { display: inline-block; max-width: 100%; border-radius: 8px; vertical-align: bottom; }
    .tiptap ul, .tiptap ol { padding-left: 1.3em; margin: 0 0 0.75em; }
    .tiptap blockquote { border-left: 3px solid ${t.primary}; margin: 0 0 0.75em; padding: 0 0 0 12px; color: ${t.accentForeground}; }
    .tiptap pre { position: relative; background: ${t.muted}; border: 1px solid ${t.border}; border-radius: 10px; padding: 36px 12px 12px; overflow-x: auto; color: ${t.foreground}; }
    .tiptap code { font-family: ui-monospace, "Cascadia Code", "Fira Code", Menlo, monospace; font-size: 13.5px; }
    .tiptap p code { background: ${t.muted}; color: ${t.accentForeground}; padding: 0.1em 0.35em; border-radius: 4px; }
    .code-delete { position: absolute; top: 8px; right: 8px; display: flex; align-items: center; justify-content: center; width: 26px; height: 23px; padding: 0; background: ${t.muted}; color: ${t.mutedForeground}; border: 1px solid ${t.border}; border-radius: 6px; }
    .code-copy { position: absolute; top: 8px; right: 40px; background: ${t.muted}; color: ${t.mutedForeground}; border: 1px solid ${t.border}; border-radius: 6px; font-size: 11px; font-weight: 600; padding: 4px 8px; }
    .tok-keyword { color: #569cd6; }
    .tok-string { color: #ce9178; }
    .tok-comment { color: #6a9955; }
    .tok-number { color: #b5cea8; }
    .tok-type { color: #4ec9b0; }
    .tiptap hr { border: none; border-top: 1px solid ${t.border}; margin: 16px 0; }
    .tiptap mark { background: ${t.accent}; color: ${t.accentForeground}; }
    .tiptap a { color: ${t.primary}; }
    .tiptap table { border-collapse: collapse; width: 100%; margin: 0 0 0.9em; }
    .tiptap th, .tiptap td { border: 1px solid ${t.border}; padding: 8px; vertical-align: top; min-width: 72px; }
    .tiptap th { background: ${t.muted}; font-weight: 600; }
    .tiptap ul[data-type="taskList"] { list-style: none; padding-left: 0; }
    .tiptap ul[data-type="taskList"] li { display: flex; gap: 8px; align-items: flex-start; }
    .tiptap ul[data-type="taskList"] input { margin-top: 4px; }
    .mention { color: ${t.primary}; font-weight: 600; background: ${t.accent}; border-radius: 6px; padding: 0 4px; }
    .math-inline { border-radius: 4px; padding: 0 2px; }
    .math-inline.ProseMirror-selectednode, .wiki-link.ProseMirror-selectednode, .footnote-ref.ProseMirror-selectednode { background: ${t.accent}; }
    .math-empty { color: ${t.mutedForeground}; font-style: italic; font-size: 13px; }
    .math-block, .frontmatter { border: 1px solid ${t.border}; border-radius: 10px; margin: 0 0 0.75em; overflow: hidden; }
    .frontmatter { border-style: dashed; }
    .ProseMirror .block-picked { background: rgba(59, 130, 246, 0.16); border-radius: 6px; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16); }
    .props-list { display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; padding: 8px 12px 10px; font-size: 13px; }
    .props-key { color: ${t.mutedForeground}; }
    .props-values { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
    .props-chip { background: ${t.accent}; color: ${t.accentForeground}; border-radius: 999px; padding: 1px 9px; }
    .props-empty { grid-column: 1 / -1; color: ${t.mutedForeground}; }
    .block-head button + button { margin-left: 0; }
    .math-block pre, .frontmatter pre { padding: 10px 12px; border: 0; border-radius: 0; white-space: pre-wrap; }
    .math-out { padding: 12px; border-top: 1px solid ${t.border}; text-align: center; overflow-x: auto; }
    .math-out .katex-display { margin: 0; }
    .block-head { display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${t.mutedForeground}; background: ${t.muted}; }
    .block-head button { margin-left: auto; background: transparent; border: 0; color: inherit; font: inherit; }
    .details { position: relative; margin: 0 0 0.25em; padding-left: 28px; }
    .details-toggle { position: absolute; left: 0; top: 2px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: ${t.mutedForeground}; }
    .details-toggle svg { transition: transform 0.15s ease; }
    .find-match { background: color-mix(in srgb, #f5b041 35%, transparent); border-radius: 2px; }
    .find-current { background: color-mix(in srgb, #f5b041 80%, transparent); }
    .doc-columns { margin: 8px 0; }
    .doc-column { padding-left: 10px; border-left: 2px solid ${t.border}; }
    .doc-column + .doc-column { margin-top: 10px; }
    .doc-embed, .doc-bookmark { margin: 10px 0; }
    .doc-embed-frame { width: 100%; overflow: hidden; border: 1px solid ${t.border}; border-radius: 10px; background: ${t.muted}; }
    .doc-embed-frame iframe { display: block; width: 100%; height: 100%; border: 0; }
    .doc-embed-caption { display: block; margin-top: 4px; padding: 0; border: 0; background: transparent; color: ${t.mutedForeground}; font: inherit; font-size: 12px; text-align: left; }
    .doc-bookmark { position: relative; padding: 10px 12px; border: 1px solid ${t.border}; border-radius: 10px; }
    .doc-bookmark-title { padding-right: 56px; font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .doc-bookmark-description { margin-top: 2px; color: ${t.mutedForeground}; font-size: 13px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .doc-bookmark-host { margin-top: 4px; color: ${t.mutedForeground}; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .doc-bookmark-open { position: absolute; top: 8px; right: 8px; padding: 4px 10px; border: 1px solid ${t.border}; border-radius: 999px; background: transparent; color: ${t.foreground}; font: inherit; font-size: 12px; }
    .ProseMirror-selectednode.doc-embed .doc-embed-frame, .ProseMirror-selectednode.doc-bookmark { outline: 2px solid ${t.primary}; outline-offset: 2px; }
    .details[data-open] > .details-toggle svg { transform: rotate(90deg); }
    .details-summary { font-weight: 600; }
    .details:not([data-open]) > .details-body > :not(.details-summary) { display: none; }
    .callout { --callout: ${t.primary}; border-left: 3px solid var(--callout); background: color-mix(in oklab, var(--callout) 10%, transparent); border-radius: 0 8px 8px 0; padding: 8px 12px 10px; margin: 0 0 0.75em; }
    .callout[data-kind="tip"] { --callout: #2fa36b; }
    .callout[data-kind="important"] { --callout: #8957e5; }
    .callout[data-kind="warning"] { --callout: #d29922; }
    .callout[data-kind="caution"] { --callout: #e5484d; }
    .callout-head { display: flex; align-items: center; gap: 6px; color: var(--callout); font-weight: 600; margin-bottom: 4px; }
    .callout-head select { background: transparent; border: 0; color: inherit; font: inherit; font-size: 14px; padding: 0; }
    .callout-head input { flex: 1; min-width: 0; background: transparent; border: 0; color: ${t.foreground}; font: inherit; font-size: 14px; font-weight: 600; outline: none; }
    .callout-body > :last-child { margin-bottom: 0; }
    .footnote-ref { color: ${t.primary}; font-weight: 600; font-size: 0.7em; }
    .footnote { display: flex; gap: 8px; border-top: 1px solid ${t.border}; padding-top: 6px; margin: 6px 0 0; font-size: 14px; color: ${t.mutedForeground}; }
    .footnote + .footnote { border-top: 0; margin-top: 0; padding-top: 0; }
    .footnote-label { color: ${t.primary}; font-weight: 600; flex: none; min-width: 20px; }
    .footnote-body { flex: 1; min-width: 0; }
    .footnote-body > :last-child { margin-bottom: 0; }
    .wiki-link { color: ${t.primary}; font-weight: 600; background: ${t.accent}; border-radius: 6px; padding: 0 4px; text-decoration: none; white-space: nowrap; }
    .wiki-link::before { content: "[["; opacity: 0.5; }
    .wiki-link::after { content: "]]"; opacity: 0.5; }
    .wiki-link[data-embed="true"]::before { content: "![["; }
    .mermaid-out svg.map-svg { width: 100%; height: auto; max-height: 420px; }
    .map-polygon { fill: color-mix(in oklab, ${t.primary} 25%, transparent); stroke: ${t.primary}; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
    .map-line { fill: none; stroke: ${t.primary}; stroke-width: 2; vector-effect: non-scaling-stroke; }
    .map-point { fill: ${t.primary}; stroke: ${t.background}; stroke-width: 1.5; }
    .mermaid-out canvas { display: block; width: 100% !important; touch-action: none; }
    .tiptap p.is-editor-empty:first-child::before,
    .tiptap .is-empty::before { color: ${t.mutedForeground}; content: attr(data-placeholder); float: left; height: 0; pointer-events: none; }
  </style>
</head>
<body>
  <div id="editor"></div>
  <script type="module">
    import { Editor, Node, Extension, InputRule, wrappingInputRule } from "https://esm.sh/@tiptap/core@3.31.4";
    import StarterKit from "https://esm.sh/@tiptap/starter-kit@3.31.4";
    import { TableKit } from "https://esm.sh/@tiptap/extension-table@3.31.4";
    import TaskList from "https://esm.sh/@tiptap/extension-task-list@3.31.4";
    import TaskItem from "https://esm.sh/@tiptap/extension-task-item@3.31.4";
    import Highlight from "https://esm.sh/@tiptap/extension-highlight@3.31.4";
    import Image from "https://esm.sh/@tiptap/extension-image@3.31.4";
    import CodeBlock from "https://esm.sh/@tiptap/extension-code-block@3.31.4";
    import { Placeholder } from "https://esm.sh/@tiptap/extensions@3.31.4";
    import { TextSelection, Plugin, PluginKey } from "https://esm.sh/@tiptap/pm@3.31.4/state";
    import { Decoration, DecorationSet } from "https://esm.sh/@tiptap/pm@3.31.4/view";

    const placeholder = ${embed(placeholder)};

    // Uploaded images are stored as "/files/<id>" and shown from the server.
    const apiBase = ${embed(apiBase.replace(/\/+$/, ""))};
    const DocImage = Image.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          src: {
            default: null,
            parseHTML: (el) => {
              const src = el.getAttribute("src") || "";
              return apiBase && src.startsWith(apiBase + "/files/") ? src.slice(apiBase.length) : src;
            },
            renderHTML: (attrs) => ({ src: attrs.src && attrs.src.startsWith("/files/") ? apiBase + attrs.src : attrs.src }),
          },
        };
      },
    });
    // Find and replace, as on web (apps/web/app/_components/editor/findReplace.ts).
    // The app's find bar drives it with the find* commands and reads back
    // { type: "find", current, count }.
    const findKey = new PluginKey("findReplace");
    const FIND_EMPTY = { query: "", caseSensitive: false, matches: [], current: -1 };
    function findMatches(doc, query, caseSensitive) {
      const out = [];
      if (!query) return out;
      const needle = caseSensitive ? query : query.toLowerCase();
      doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        let text = "";
        node.forEach((child) => { text += child.isText ? child.text : "\\uFFFC".repeat(child.nodeSize); });
        const hay = caseSensitive ? text : text.toLowerCase();
        for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
          out.push({ from: pos + 1 + at, to: pos + 1 + at + needle.length });
        }
        return false;
      });
      return out;
    }
    function getFind(state) { return findKey.getState(state) || FIND_EMPTY; }
    function revealMatch(tr, match) {
      const $from = tr.doc.resolve(match.from);
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth);
        if (node.type.name === "details" && !node.attrs.open) tr.setNodeMarkup($from.before(depth), undefined, Object.assign({}, node.attrs, { open: true }));
      }
      tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
      return tr.scrollIntoView();
    }
    // The block the Block menu is open for is tinted, like a selected block on desktop.
    const blockPickKey = new PluginKey("blockPick");
    const BlockPick = Extension.create({
      name: "blockPick",
      addProseMirrorPlugins() {
        return [
          new Plugin({
            key: blockPickKey,
            state: {
              init: () => null,
              apply(tr, value) {
                const meta = tr.getMeta(blockPickKey);
                if (meta !== undefined) return meta;
                return value && tr.docChanged ? null : value;
              },
            },
            props: {
              decorations(state) {
                const picked = blockPickKey.getState(state);
                return picked ? DecorationSet.create(state.doc, [Decoration.node(picked.from, picked.to, { class: "block-picked" })]) : null;
              },
            },
          }),
        ];
      },
    });

    const FindReplace = Extension.create({
      name: "findReplace",
      addProseMirrorPlugins() {
        let lastSent = "";
        return [
          new Plugin({
            key: findKey,
            state: {
              init: () => FIND_EMPTY,
              apply(tr, value, _old, next) {
                const meta = tr.getMeta(findKey);
                if (!meta && (!tr.docChanged || !value.query)) return value;
                const query = meta && meta.query !== undefined ? meta.query : value.query;
                const caseSensitive = meta && meta.caseSensitive !== undefined ? meta.caseSensitive : value.caseSensitive;
                const matches = findMatches(tr.doc, query, caseSensitive);
                let current;
                if (meta && meta.current !== undefined) current = matches.length ? ((meta.current % matches.length) + matches.length) % matches.length : -1;
                else if (meta) {
                  const index = matches.findIndex((m) => m.from >= next.selection.from);
                  current = matches.length ? (index === -1 ? 0 : index) : -1;
                } else current = matches.length ? Math.min(Math.max(value.current, 0), matches.length - 1) : -1;
                return { query, caseSensitive, matches, current };
              },
            },
            props: {
              decorations(state) {
                const find = findKey.getState(state);
                if (!find || !find.matches.length) return null;
                return DecorationSet.create(state.doc, find.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === find.current ? "find-match find-current" : "find-match" })));
              },
            },
            view: () => ({
              update(view) {
                const find = getFind(view.state);
                const key = find.query ? find.current + "/" + find.matches.length : "";
                if (key === lastSent) return;
                lastSent = key;
                send({ type: "find", current: find.current, count: find.matches.length });
              },
            }),
          }),
        ];
      },
    });
    // Columns (see apps/web/app/_components/editor/columns.ts). A phone is
    // too narrow for them, so they show one under another.
    const ColumnNode = Node.create({
      name: "column",
      content: "block+",
      isolating: true,
      defining: true,
      parseHTML() { return [{ tag: "div[data-column]" }]; },
      renderHTML({ HTMLAttributes }) { return ["div", Object.assign({}, HTMLAttributes, { "data-column": "", class: "doc-column" }), 0]; },
    });
    const ColumnsNode = Node.create({
      name: "columns",
      group: "block",
      content: "column{2,4}",
      defining: true,
      parseHTML() { return [{ tag: "div[data-columns]" }]; },
      renderHTML({ HTMLAttributes }) { return ["div", Object.assign({}, HTMLAttributes, { "data-columns": "", class: "doc-columns" }), 0]; },
    });
    function toggleColumnsCmd(state, tr) {
      const { $from } = tr.selection;
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth);
        if (node.type.name !== "columns") continue;
        const pos = $from.before(depth);
        const blocks = [];
        node.forEach((column) => column.forEach((block) => blocks.push(block)));
        tr.replaceWith(pos, pos + node.nodeSize, blocks);
        tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
        return true;
      }
      if ($from.depth < 1) return false;
      const start = $from.before(1);
      const block = tr.doc.child($from.index(0));
      if (block.type.name === "frontmatter" || block.type.name === "footnote") return false;
      const schema = state.schema;
      const first = schema.nodes.column.create(null, block);
      const node = schema.nodes.columns.create(null, [first, schema.nodes.column.create(null, schema.nodes.paragraph.create())]);
      tr.replaceWith(start, start + block.nodeSize, node);
      tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1 + first.nodeSize + 1)));
      return true;
    }
    const EMBED_PATTERNS = ${embed(EMBED_PATTERNS.map(({ provider, pattern }) => ({ provider, source: pattern.source, flags: pattern.flags })))};
    // Embeds and bookmarks (see packages/contract/src/embeds.ts). They are
    // added from the app's toolbar, which asks for the link.
    function embedPlayer(link) {
      let url;
      try { url = new URL(link); } catch (e) { return null; }
      for (const item of EMBED_PATTERNS) {
        const m = new RegExp(item.source, item.flags).exec(link);
        if (!m) continue;
        switch (item.provider) {
          case "YouTube": {
            const t = url.searchParams.get("t") || url.searchParams.get("start") || "";
            const parts = /^(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s?)?$/.exec(t);
            const start = parts ? Number(parts[1] || 0) * 3600 + Number(parts[2] || 0) * 60 + Number(parts[3] || 0) : 0;
            return { provider: item.provider, src: "https://www.youtube-nocookie.com/embed/" + m[1] + (start ? "?start=" + start : ""), aspect: 16 / 9 };
          }
          case "Vimeo": return { provider: item.provider, src: "https://player.vimeo.com/video/" + m[1], aspect: 16 / 9 };
          case "Loom": return { provider: item.provider, src: "https://www.loom.com/embed/" + m[1], aspect: 16 / 9 };
          case "Spotify": {
            const kind = m[1].toLowerCase();
            return { provider: item.provider, src: "https://open.spotify.com/embed/" + kind + "/" + m[2], height: kind === "track" || kind === "episode" ? 152 : 352 };
          }
          case "Figma": return { provider: item.provider, src: "https://www.figma.com/embed?embed_host=timely&url=" + encodeURIComponent(url.href), aspect: 16 / 10 };
          default: return { provider: item.provider, src: "https://codepen.io/" + m[1] + "/embed/" + m[2] + "?default-tab=result", height: 420 };
        }
      }
      return null;
    }
    function linkHost(link) {
      try { return new URL(link).host.replace(/^www\\./, ""); } catch (e) { return link; }
    }
    function openLink(href) {
      send({ type: "openLink", href });
    }
    const EmbedNode = Node.create({
      name: "embed",
      group: "block",
      atom: true,
      selectable: true,
      addAttributes() { return { src: { default: "" } }; },
      parseHTML() { return [{ tag: "div[data-embed]", getAttrs: (el) => ({ src: el.getAttribute("data-src") || "" }) }]; },
      renderHTML({ node, HTMLAttributes }) { return ["div", Object.assign({}, HTMLAttributes, { "data-embed": "", "data-src": node.attrs.src })]; },
      addNodeView() {
        return ({ node }) => {
          const dom = document.createElement("div");
          dom.className = "doc-embed";
          dom.contentEditable = "false";
          const src = node.attrs.src || "";
          const info = src ? embedPlayer(src) : null;
          if (info) {
            const frame = document.createElement("div");
            frame.className = "doc-embed-frame";
            if (info.aspect) frame.style.aspectRatio = String(info.aspect);
            if (info.height) frame.style.height = info.height + "px";
            const iframe = document.createElement("iframe");
            iframe.src = info.src;
            iframe.title = info.provider + " embed";
            iframe.loading = "lazy";
            iframe.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
            iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-presentation allow-forms");
            frame.append(iframe);
            dom.append(frame);
          }
          const caption = document.createElement("button");
          caption.type = "button";
          caption.className = "doc-embed-caption";
          caption.textContent = src ? (info ? info.provider + " · " : "") + linkHost(src) : "Empty embed";
          if (src) caption.addEventListener("click", () => openLink(src));
          dom.append(caption);
          return { dom, ignoreMutation: () => true, stopEvent: (event) => event.target === caption };
        };
      },
    });
    const BookmarkNode = Node.create({
      name: "bookmark",
      group: "block",
      atom: true,
      selectable: true,
      addAttributes() { return { url: { default: "" }, title: { default: "" }, description: { default: "" } }; },
      parseHTML() {
        return [{ tag: "div[data-bookmark]", getAttrs: (el) => ({ url: el.getAttribute("data-url") || "", title: el.getAttribute("data-title") || "", description: el.getAttribute("data-description") || "" }) }];
      },
      renderHTML({ node, HTMLAttributes }) {
        return ["div", Object.assign({}, HTMLAttributes, { "data-bookmark": "", "data-url": node.attrs.url, "data-title": node.attrs.title, "data-description": node.attrs.description })];
      },
      addNodeView() {
        return ({ node }) => {
          const dom = document.createElement("div");
          dom.className = "doc-bookmark";
          dom.contentEditable = "false";
          const url = node.attrs.url || "";
          const title = document.createElement("div");
          title.className = "doc-bookmark-title";
          title.textContent = node.attrs.title || (url ? linkHost(url) : "Empty bookmark");
          dom.append(title);
          if (node.attrs.description) {
            const description = document.createElement("div");
            description.className = "doc-bookmark-description";
            description.textContent = node.attrs.description;
            dom.append(description);
          }
          if (url) {
            const host = document.createElement("div");
            host.className = "doc-bookmark-host";
            host.textContent = url.replace(/^https?:\\/\\//, "");
            dom.append(host);
          }
          const open = document.createElement("button");
          open.type = "button";
          open.className = "doc-bookmark-open";
          open.textContent = "Open";
          if (url) {
            open.addEventListener("click", () => openLink(url));
            dom.append(open);
          }
          return { dom, ignoreMutation: () => true, stopEvent: (event) => event.target === open };
        };
      },
    });
    const Mention = Node.create({
      name: "mention",
      group: "inline",
      inline: true,
      atom: true,
      selectable: true,
      addAttributes() {
        return {
          id: { default: null },
          label: { default: "mention" },
          entityType: { default: "doc" },
          appearance: { default: "mention" },
        };
      },
      parseHTML() { return [{ tag: "span[data-mention]" }]; },
      renderHTML({ node, HTMLAttributes }) {
        const label = node.attrs.label || "mention";
        const text = node.attrs.appearance === "page" ? label : "@" + label;
        return ["span", { ...HTMLAttributes, "data-mention": "", class: "mention" }, text];
      },
      renderText({ node }) {
        const label = node.attrs.label || "mention";
        return node.attrs.appearance === "page" ? label : "@" + label;
      },
    });


    // --- Markdown extras (docs/markdown.md): math, callouts, footnotes,
    // frontmatter and [[wiki links]]. Same JSON as the web editor. ---

    // Only the top node may hold frontmatter, and only first.
    const DocumentWithFrontmatter = Node.create({ name: "doc", topNode: true, content: "frontmatter? block+" });

    let katexLoad = null;
    function loadKatex() {
      if (!katexLoad) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://esm.sh/katex@0.16.47/dist/katex.min.css";
        document.head.appendChild(link);
        katexLoad = import("https://esm.sh/katex@0.16.47").then((mod) => mod.default || mod);
      }
      return katexLoad;
    }
    function renderMath(el, latex, displayMode) {
      latex = latex.trim();
      if (el.dataset.latex === latex && el.dataset.display === String(displayMode)) return;
      el.dataset.latex = latex;
      el.dataset.display = String(displayMode);
      if (!latex) {
        el.innerHTML = "";
        const hint = document.createElement("span");
        hint.className = "math-empty";
        hint.textContent = displayMode ? "Type TeX above, for example: \\\\frac{1}{2}" : "formula";
        el.appendChild(hint);
        return;
      }
      el.textContent = "$" + latex + "$";
      loadKatex().then((katex) => {
        if (el.dataset.latex !== latex) return;
        katex.render(latex, el, { displayMode, throwOnError: false, strict: "ignore", trust: false });
      }).catch(() => undefined);
    }

    const MathInline = Node.create({
      name: "mathInline",
      group: "inline",
      inline: true,
      atom: true,
      selectable: true,
      addAttributes() { return { latex: { default: "" } }; },
      parseHTML() { return [{ tag: "span[data-math-inline]" }]; },
      renderHTML({ node, HTMLAttributes }) {
        return ["span", { ...HTMLAttributes, "data-math-inline": "", class: "math-inline" }, "$" + node.attrs.latex + "$"];
      },
      renderText({ node }) { return node.attrs.latex; },
      addNodeView() {
        return ({ node, getPos }) => {
          const dom = document.createElement("span");
          dom.className = "math-inline";
          dom.setAttribute("contenteditable", "false");
          let current = node;
          renderMath(dom, current.attrs.latex, false);
          // Tapping asks the app for the TeX; it comes back as cmd setMath.
          dom.addEventListener("click", () => send({ type: "mathEdit", pos: getPos(), latex: current.attrs.latex }));
          return {
            dom,
            update(next) {
              if (next.type !== node.type) return false;
              current = next;
              renderMath(dom, next.attrs.latex, false);
              return true;
            },
            ignoreMutation() { return true; },
          };
        };
      },
      addInputRules() {
        return [new InputRule({
          find: /\\$([^\\s$][^$\\n]*?[^\\s$\\\\]|[^\\s$])\\$$/,
          handler: ({ state, range, match }) => {
            state.tr.replaceWith(range.from, range.to, state.schema.nodes.mathInline.create({ latex: match[1] }));
          },
        })];
      },
    });

    // Enter three times at the end of a verbatim block leaves it (as code blocks do).
    function exitOnTripleEnter(editor, name) {
      const { state } = editor;
      const { selection } = state;
      const { $from, empty } = selection;
      if (!empty || $from.parent.type.name !== name) return false;
      const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2;
      if (!isAtEnd || !$from.parent.textContent.endsWith("\\n\\n")) return false;
      return editor.chain().command(({ tr }) => { tr.delete($from.pos - 2, $from.pos); return true; }).exitCode().run();
    }

    // Properties show as key and value chips; the YAML shows only while the
    // caret is in it (Edit puts it there, Done takes it out).
    const LIST_KEYS = new Set(["tags", "tag", "aliases", "alias", "categories", "category", "keywords", "cssclasses"]);
    const unquoteValue = (value) => value.trim().replace(/^(["'])(.*)\\1$/, "$2").trim();
    function frontmatterEntries(text) {
      const entries = [];
      for (const line of text.split("\\n")) {
        const item = /^\\s*-\\s+(.*)$/.exec(line);
        if (item && entries.length) {
          const value = unquoteValue(item[1]);
          if (value) entries[entries.length - 1].values.push(value);
          continue;
        }
        const match = /^([A-Za-z0-9_-]+)\\s*:\\s*(.*)$/.exec(line);
        if (!match) continue;
        const raw = match[2].replace(/\\s+#.*$/, "").trim();
        let values;
        if (raw.startsWith("[") && raw.endsWith("]")) values = raw.slice(1, -1).split(",").map(unquoteValue);
        else if (LIST_KEYS.has(match[1].toLowerCase())) values = raw.split(",").map(unquoteValue);
        else values = [unquoteValue(raw)];
        entries.push({ key: match[1], values: values.filter(Boolean) });
      }
      return entries;
    }
    function frontmatterView({ node, getPos, editor }) {
      let current = node;
      const dom = document.createElement("div");
      dom.className = "frontmatter";
      const bar = document.createElement("div");
      bar.className = "block-head";
      bar.setAttribute("contenteditable", "false");
      const title = document.createElement("span");
      title.textContent = "Properties";
      title.style.flex = "1";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      bar.append(title, editBtn, remove);
      const list = document.createElement("div");
      list.className = "props-list";
      list.setAttribute("contenteditable", "false");
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      pre.appendChild(code);
      dom.append(bar, list, pre);
      let editing = false;
      const start = () => editor.chain().focus(getPos() + current.nodeSize - 1).scrollIntoView().run();
      const finish = () => editor.chain().focus(getPos() + current.nodeSize + 1).run();
      [editBtn, remove].forEach((btn) => btn.addEventListener("mousedown", (event) => event.preventDefault()));
      editBtn.addEventListener("click", () => (editing ? finish() : start()));
      remove.addEventListener("click", () => {
        const pos = getPos();
        editor.chain().focus().deleteRange({ from: pos, to: pos + current.nodeSize }).run();
      });
      list.addEventListener("click", start);
      const paint = () => {
        editBtn.textContent = editing ? "Done" : "Edit";
        pre.style.display = editing ? "" : "none";
        list.style.display = editing ? "none" : "";
        const entries = frontmatterEntries(current.textContent);
        list.replaceChildren();
        if (!entries.length) {
          const empty = document.createElement("div");
          empty.className = "props-empty";
          empty.textContent = "No properties yet. Tap to add key: value lines.";
          list.appendChild(empty);
        }
        entries.forEach(({ key, values }) => {
          const k = document.createElement("div");
          k.className = "props-key";
          k.textContent = key;
          const v = document.createElement("div");
          v.className = "props-values";
          if (!values.length) {
            const none = document.createElement("span");
            none.className = "props-empty";
            none.textContent = "Empty";
            v.appendChild(none);
          }
          values.forEach((value) => {
            const chip = document.createElement("span");
            chip.className = "props-chip";
            chip.textContent = value;
            v.appendChild(chip);
          });
          list.append(k, v);
        });
      };
      const check = () => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        const { from, to } = editor.state.selection;
        const next = editor.isFocused && from > pos && to < pos + current.nodeSize;
        if (next !== editing) { editing = next; paint(); }
      };
      const events = ["selectionUpdate", "focus", "blur"];
      events.forEach((name) => editor.on(name, check));
      paint();
      setTimeout(check, 0);
      return {
        dom,
        contentDOM: code,
        update(next) {
          if (next.type !== current.type) return false;
          current = next;
          if (!editing) paint();
          return true;
        },
        ignoreMutation(mutation) {
          if (mutation.type === "selection") return false;
          return !code.contains(mutation.target);
        },
        destroy() { events.forEach((name) => editor.off(name, check)); },
      };
    }

    function verbatimBlockView(className, head, drawOut) {
      return ({ node, getPos, editor }) => {
        const dom = document.createElement("div");
        dom.className = className;
        if (head) {
          const bar = document.createElement("div");
          bar.className = "block-head";
          bar.setAttribute("contenteditable", "false");
          bar.textContent = head;
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "Remove";
          remove.addEventListener("click", () => {
            const pos = getPos();
            editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
          });
          bar.appendChild(remove);
          dom.appendChild(bar);
        }
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        pre.appendChild(code);
        dom.appendChild(pre);
        let out = null;
        if (drawOut) {
          out = document.createElement("div");
          out.className = "math-out";
          out.setAttribute("contenteditable", "false");
          dom.appendChild(out);
          drawOut(out, node.textContent);
        }
        return {
          dom,
          contentDOM: code,
          update(next) {
            if (next.type !== node.type) return false;
            if (out) drawOut(out, next.textContent);
            return true;
          },
          ignoreMutation(mutation) {
            if (mutation.type === "selection") return false;
            return !code.contains(mutation.target);
          },
        };
      };
    }

    const MathBlock = Node.create({
      name: "mathBlock",
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      defining: true,
      parseHTML() { return [{ tag: "div[data-math-block]", preserveWhitespace: "full" }]; },
      renderHTML({ HTMLAttributes }) { return ["div", { ...HTMLAttributes, "data-math-block": "" }, 0]; },
      addNodeView() { return verbatimBlockView("math-block", null, (out, text) => renderMath(out, text, true)); },
      addKeyboardShortcuts() {
        return {
          Enter: () => exitOnTripleEnter(this.editor, this.name),
          Backspace: () => {
            const { $from, empty } = this.editor.state.selection;
            if (!empty || $from.parent.type.name !== this.name || $from.parent.textContent) return false;
            return this.editor.commands.clearNodes();
          },
        };
      },
    });

    const Frontmatter = Node.create({
      name: "frontmatter",
      content: "text*",
      marks: "",
      code: true,
      defining: true,
      isolating: true,
      parseHTML() { return [{ tag: "div[data-frontmatter]", preserveWhitespace: "full" }]; },
      renderHTML({ HTMLAttributes }) { return ["div", { ...HTMLAttributes, "data-frontmatter": "" }, 0]; },
      addNodeView() { return frontmatterView; },
      addKeyboardShortcuts() {
        return { Enter: () => exitOnTripleEnter(this.editor, this.name) };
      },
    });

    const CALLOUT_KINDS = { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" };


    // --- Toggle blocks: a plain-text summary that folds the blocks under it
    // (web: apps/web/app/_components/editor/details.ts). ---
    const DetailsSummary = Node.create({
      name: "detailsSummary",
      content: "text*",
      marks: "",
      defining: true,
      isolating: true,
      parseHTML() { return [{ tag: "summary" }, { tag: "div[data-details-summary]" }]; },
      renderHTML({ HTMLAttributes }) { return ["div", { ...HTMLAttributes, class: "details-summary", "data-details-summary": "" }, 0]; },
    });
    function toggleDetailsCmd(state, tr) {
      const schema = state.schema;
      const { $from } = state.selection;
      for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name !== "details") continue;
        const pos = $from.before(depth);
        const blocks = [schema.nodes.paragraph.create(null, node.firstChild.content)];
        node.forEach((child, _offset, index) => { if (index > 0) blocks.push(child); });
        tr.replaceWith(pos, pos + node.nodeSize, blocks);
        tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
        return true;
      }
      const block = $from.parent;
      if (!block.isTextblock || block.type.spec.code || $from.depth < 1) return false;
      const text = block.textContent;
      const start = $from.before();
      tr.replaceWith(start, $from.after(), schema.nodes.details.create({ open: true }, [
        schema.nodes.detailsSummary.create(null, text ? schema.text(text) : null),
        schema.nodes.paragraph.create(),
      ]));
      tr.setSelection(TextSelection.create(tr.doc, start + 2 + text.length));
      return true;
    }
    const Details = Node.create({
      name: "details",
      priority: 1000,
      group: "block",
      content: "detailsSummary block+",
      defining: true,
      addAttributes() {
        return {
          open: {
            default: true,
            parseHTML: (el) => el.hasAttribute("open"),
            renderHTML: (attrs) => (attrs.open ? { open: "" } : {}),
          },
        };
      },
      parseHTML() { return [{ tag: "details" }]; },
      renderHTML({ HTMLAttributes }) { return ["details", HTMLAttributes, 0]; },
      addNodeView() {
        return ({ node, getPos, editor }) => {
          let current = node;
          const dom = document.createElement("div");
          dom.className = "details";
          const button = document.createElement("button");
          button.type = "button";
          button.className = "details-toggle";
          button.contentEditable = "false";
          button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
          const body = document.createElement("div");
          body.className = "details-body";
          dom.append(button, body);
          const paint = () => {
            if (current.attrs.open) dom.setAttribute("data-open", "");
            else dom.removeAttribute("data-open");
            button.setAttribute("aria-expanded", String(Boolean(current.attrs.open)));
          };
          paint();
          button.addEventListener("mousedown", (event) => event.preventDefault());
          button.addEventListener("click", () => {
            const pos = getPos();
            if (typeof pos !== "number") return;
            const open = !current.attrs.open;
            const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, open });
            tr.setMeta("addToHistory", false);
            const { from } = editor.state.selection;
            const end = pos + current.firstChild.nodeSize;
            if (!open && from > end && from < pos + current.nodeSize) tr.setSelection(TextSelection.create(tr.doc, end));
            editor.view.dispatch(tr);
          });
          return {
            dom,
            contentDOM: body,
            update(next) {
              if (next.type !== current.type) return false;
              current = next;
              paint();
              return true;
            },
            ignoreMutation: (mutation) => button.contains(mutation.target),
          };
        };
      },
      addKeyboardShortcuts() {
        const foldedBefore = (ed) => {
          const { $from, empty } = ed.state.selection;
          if (!empty || $from.parentOffset > 0 || $from.depth < 1) return null;
          const before = ed.state.doc.resolve($from.before()).nodeBefore;
          if (!before || before.type.name !== "details" || before.attrs.open) return null;
          return { pos: $from.before() - before.nodeSize, details: before };
        };
        return {
          Enter: ({ editor: ed }) => {
            const { state } = ed;
            const { $from, empty } = state.selection;
            if (!empty || $from.parent.type.name !== "detailsSummary") return false;
            const pos = $from.before($from.depth - 1);
            const details = state.doc.nodeAt(pos);
            const bodyStart = pos + 1 + details.firstChild.nodeSize;
            const tr = state.tr;
            if (!details.attrs.open) tr.setNodeMarkup(pos, undefined, { ...details.attrs, open: true });
            const first = details.child(1);
            if (!(first.type.name === "paragraph" && first.content.size === 0)) tr.insert(bodyStart, state.schema.nodes.paragraph.create());
            tr.setSelection(TextSelection.create(tr.doc, bodyStart + 1));
            ed.view.dispatch(tr.scrollIntoView());
            return true;
          },
          Backspace: ({ editor: ed }) => {
            const folded = foldedBefore(ed);
            if (folded) {
              const { $from } = ed.state.selection;
              const tr = ed.state.tr;
              if ($from.parent.content.size === 0) tr.delete($from.before(), $from.after());
              tr.setSelection(TextSelection.create(tr.doc, folded.pos + folded.details.firstChild.nodeSize));
              ed.view.dispatch(tr.scrollIntoView());
              return true;
            }
            const { $from, empty } = ed.state.selection;
            if (!empty || $from.parent.type.name !== "detailsSummary" || $from.parentOffset > 0) return false;
            return ed.commands.command(({ state, tr }) => toggleDetailsCmd(state, tr));
          },
        };
      },
    });

    const Callout = Node.create({
      name: "callout",
      group: "block",
      content: "block+",
      defining: true,
      addAttributes() { return { kind: { default: "note" }, title: { default: null } }; },
      parseHTML() { return [{ tag: "div[data-callout]" }]; },
      renderHTML({ node, HTMLAttributes }) {
        return ["div", { ...HTMLAttributes, "data-callout": "", "data-kind": node.attrs.kind }, 0];
      },
      addNodeView() {
        return ({ node, getPos, editor }) => {
          const dom = document.createElement("div");
          dom.className = "callout";
          const head = document.createElement("div");
          head.className = "callout-head";
          head.setAttribute("contenteditable", "false");
          const select = document.createElement("select");
          const title = document.createElement("input");
          title.placeholder = "Title (optional)";
          const body = document.createElement("div");
          body.className = "callout-body";
          head.appendChild(select);
          head.appendChild(title);
          dom.appendChild(head);
          dom.appendChild(body);
          const setAttrs = (patch) => {
            const pos = getPos();
            editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...editor.state.doc.nodeAt(pos).attrs, ...patch }));
          };
          select.addEventListener("change", () => setAttrs({ kind: select.value }));
          title.addEventListener("input", () => setAttrs({ title: title.value || null }));
          const apply = (current) => {
            const kind = current.attrs.kind || "note";
            dom.setAttribute("data-kind", kind);
            const kinds = CALLOUT_KINDS[kind] ? Object.keys(CALLOUT_KINDS) : [...Object.keys(CALLOUT_KINDS), kind];
            select.innerHTML = "";
            for (const item of kinds) {
              const option = document.createElement("option");
              option.value = item;
              option.textContent = CALLOUT_KINDS[item] || item;
              select.appendChild(option);
            }
            select.value = kind;
            if (title.value !== (current.attrs.title || "")) title.value = current.attrs.title || "";
          };
          apply(node);
          return {
            dom,
            contentDOM: body,
            update(next) {
              if (next.type !== node.type) return false;
              apply(next);
              return true;
            },
            ignoreMutation(mutation) {
              if (mutation.type === "selection") return false;
              return !body.contains(mutation.target);
            },
            stopEvent(event) { return head.contains(event.target); },
          };
        };
      },
      addKeyboardShortcuts() {
        const leaveWhenEmpty = () => {
          const { $from, empty } = this.editor.state.selection;
          if (!empty || $from.parent.type.name !== "paragraph" || $from.parent.textContent) return false;
          if ($from.depth < 2 || $from.node(-1).type.name !== this.name) return false;
          return this.editor.commands.lift("paragraph");
        };
        return {
          Enter: () => {
            const { $from } = this.editor.state.selection;
            if ($from.depth < 2 || $from.index(-1) !== $from.node(-1).childCount - 1) return false;
            return leaveWhenEmpty();
          },
          Backspace: () => {
            const { $from } = this.editor.state.selection;
            if ($from.depth < 2 || $from.node(-1).childCount !== 1) return false;
            return leaveWhenEmpty();
          },
        };
      },
    });

    const FootnoteRef = Node.create({
      name: "footnoteRef",
      group: "inline",
      inline: true,
      atom: true,
      selectable: true,
      addAttributes() { return { label: { default: "1" } }; },
      parseHTML() { return [{ tag: "sup[data-footnote-ref]" }]; },
      renderHTML({ node, HTMLAttributes }) {
        return ["sup", { ...HTMLAttributes, "data-footnote-ref": "", "data-label": node.attrs.label, class: "footnote-ref" }, "[" + node.attrs.label + "]"];
      },
      renderText() { return ""; },
    });

    const Footnote = Node.create({
      name: "footnote",
      group: "block",
      content: "block+",
      defining: true,
      addAttributes() { return { label: { default: "1" } }; },
      parseHTML() { return [{ tag: "div[data-footnote]" }]; },
      renderHTML({ node, HTMLAttributes }) {
        return ["div", { ...HTMLAttributes, "data-footnote": node.attrs.label }, 0];
      },
      addNodeView() {
        return ({ node }) => {
          const dom = document.createElement("div");
          dom.className = "footnote";
          dom.setAttribute("data-footnote", node.attrs.label);
          const label = document.createElement("span");
          label.className = "footnote-label";
          label.setAttribute("contenteditable", "false");
          label.textContent = "[" + node.attrs.label + "]";
          let current = node;
          // The number leads back to where the note is referenced.
          label.addEventListener("mousedown", (event) => event.preventDefault());
          label.addEventListener("click", () => {
            const ref = findFootnote(editor.state.doc, "footnoteRef", String(current.attrs.label));
            if (!ref) return;
            editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, ref.pos + ref.node.nodeSize)).scrollIntoView());
            editor.view.focus();
          });
          const body = document.createElement("div");
          body.className = "footnote-body";
          dom.appendChild(label);
          dom.appendChild(body);
          return {
            dom,
            contentDOM: body,
            update(next) {
              if (next.type !== node.type) return false;
              current = next;
              label.textContent = "[" + next.attrs.label + "]";
              dom.setAttribute("data-footnote", next.attrs.label);
              return true;
            },
            ignoreMutation(mutation) {
              if (mutation.type === "selection") return false;
              return !body.contains(mutation.target);
            },
          };
        };
      },
      addKeyboardShortcuts() {
        return {
          // Backspace in an empty note removes the footnote: the note, its
          // markers, and the gap in the numbering.
          Backspace: () => {
            const { state, view } = this.editor;
            const { $from, empty } = state.selection;
            if (!empty || $from.parent.type.name !== "paragraph" || $from.parent.textContent) return false;
            if ($from.depth < 2 || $from.node(-1).type.name !== this.name || $from.node(-1).childCount !== 1) return false;
            const label = String($from.node(-1).attrs.label);
            const tr = state.tr;
            const doomed = [];
            state.doc.descendants((n, pos) => {
              if ((n.type.name === "footnote" || n.type.name === "footnoteRef") && String(n.attrs.label) === label) doomed.push({ pos, size: n.nodeSize, ref: n.type.name === "footnoteRef" });
            });
            const ref = doomed.find((item) => item.ref);
            doomed.reverse().forEach(({ pos, size }) => tr.delete(pos, pos + size));
            renumberFootnotes(tr);
            const at = ref ? tr.mapping.map(ref.pos) : tr.doc.content.size;
            tr.setSelection(TextSelection.near(tr.doc.resolve(at), -1)).scrollIntoView();
            view.dispatch(tr);
            return true;
          },
        };
      },
      addProseMirrorPlugins() {
        return [new Plugin({
          key: new PluginKey("footnoteLinks"),
          // Deleting a marker deletes its note, and the rest renumber.
          appendTransaction: (transactions, oldState, newState) => {
            if (!transactions.some((tr) => tr.docChanged)) return null;
            if (transactions.some((tr) => tr.getMeta("preventUpdate"))) return null;
            const before = refLabels(oldState.doc);
            const after = refLabels(newState.doc);
            if (before.join("|") === after.join("|")) return null;
            // Whole-doc swaps (loading, importing) change notes too; leave those.
            if (countNotes(oldState.doc) !== countNotes(newState.doc)) return null;
            const tr = newState.tr;
            const gone = new Set(before.filter((label) => !after.includes(label)));
            const doomed = [];
            newState.doc.descendants((n, pos) => {
              if (n.type.name === "footnote" && gone.has(String(n.attrs.label))) doomed.push({ pos, size: n.nodeSize });
              return n.type.name !== "footnote";
            });
            doomed.reverse().forEach(({ pos, size }) => tr.delete(pos, pos + size));
            renumberFootnotes(tr);
            return tr.docChanged ? tr : null;
          },
        })];
      },
    });

    const isNumberLabel = (label) => /^[0-9]+$/.test(String(label));
    function refLabels(doc) {
      const labels = [];
      doc.descendants((n) => { if (n.type.name === "footnoteRef") labels.push(String(n.attrs.label)); });
      return labels;
    }
    function countNotes(doc) {
      let count = 0;
      doc.descendants((n) => { if (n.type.name === "footnote") count += 1; return n.type.name !== "footnote"; });
      return count;
    }
    function findFootnote(doc, type, label) {
      let found = null;
      doc.descendants((n, pos) => {
        if (found) return false;
        if (n.type.name === type && String(n.attrs.label) === label) found = { pos, node: n };
      });
      return found;
    }
    // Numbers footnotes 1, 2, 3 in the order their markers appear and keeps
    // the notes at the end in that order; named labels stay as they are.
    function renumberFootnotes(tr) {
      const order = [];
      refLabels(tr.doc).forEach((label) => { if (isNumberLabel(label) && !order.includes(label)) order.push(label); });
      tr.doc.descendants((n) => {
        const label = String(n.attrs.label);
        if (n.type.name === "footnote" && isNumberLabel(label) && !order.includes(label)) order.push(label);
        return n.type.name !== "footnote";
      });
      const rename = new Map(order.map((label, index) => [label, String(index + 1)]));
      tr.doc.descendants((n, pos) => {
        if (n.type.name !== "footnote" && n.type.name !== "footnoteRef") return;
        const next = rename.get(String(n.attrs.label));
        if (next && next !== String(n.attrs.label)) tr.setNodeMarkup(pos, undefined, { ...n.attrs, label: next });
      });
      const run = [];
      tr.doc.forEach((n, offset, index) => { if (n.type.name === "footnote") run.push(index); });
      if (run.length > 1 && run[run.length - 1] - run[0] === run.length - 1) {
        const notes = run.map((index) => tr.doc.child(index));
        const rank = (n) => (isNumberLabel(n.attrs.label) ? Number(n.attrs.label) : Infinity);
        const sorted = [...notes].sort((a, b) => rank(a) - rank(b));
        if (sorted.some((n, i) => n !== notes[i])) {
          let from = 0;
          for (let i = 0; i < run[0]; i++) from += tr.doc.child(i).nodeSize;
          const to = from + notes.reduce((size, n) => size + n.nodeSize, 0);
          tr.replaceWith(from, to, sorted);
        }
      }
      return rename;
    }

    function nextFootnoteLabel(doc) {
      let highest = 0;
      doc.descendants((n) => {
        if (n.type.name === "footnote" || n.type.name === "footnoteRef") {
          const value = Number(n.attrs.label);
          if (Number.isInteger(value) && value > highest) highest = value;
        }
      });
      return String(highest + 1);
    }

    const WikiLink = Node.create({
      name: "wikiLink",
      group: "inline",
      inline: true,
      atom: true,
      selectable: true,
      addAttributes() { return { target: { default: "" }, alias: { default: null }, embed: { default: false } }; },
      parseHTML() { return [{ tag: "a[data-wiki-link]" }]; },
      renderHTML({ node, HTMLAttributes }) {
        return ["a", { ...HTMLAttributes, "data-wiki-link": "", "data-target": node.attrs.target, "data-embed": node.attrs.embed ? "true" : "false", class: "wiki-link", href: "#" }, node.attrs.alias || node.attrs.target || "page"];
      },
      renderText({ node }) { return node.attrs.alias || node.attrs.target || ""; },
      addInputRules() {
        return [new InputRule({
          find: /\\[\\[([^\\[\\]|\\n]+?)(?:\\|([^\\[\\]\\n]*))?\\]\\]$/,
          handler: ({ state, range, match }) => {
            state.tr.replaceWith(range.from, range.to, state.schema.nodes.wikiLink.create({ target: match[1].trim(), alias: (match[2] || "").trim() || null, embed: false }));
          },
        })];
      },
    });

    // --- Map and 3D previews for geojson / topojson / stl code blocks ---

    function geometriesOf(value, topojson) {
      if (!value || typeof value !== "object") return [];
      if (value.type === "Topology") {
        if (!topojson) return [];
        return Object.values(value.objects || {}).flatMap((object) => geometriesOf(topojson.feature(value, object), topojson));
      }
      switch (value.type) {
        case "FeatureCollection": return (value.features || []).flatMap((item) => geometriesOf(item, topojson));
        case "Feature": return value.geometry ? geometriesOf(value.geometry, topojson) : [];
        case "GeometryCollection": return (value.geometries || []).flatMap((item) => geometriesOf(item, topojson));
        case "Point": case "MultiPoint": case "LineString": case "MultiLineString": case "Polygon": case "MultiPolygon": return [value];
        default: return [];
      }
    }
    function projectLonLat(p) {
      const phi = Math.max(-85, Math.min(85, p[1])) * Math.PI / 180;
      return [p[0], -Math.log(Math.tan(Math.PI / 4 + phi / 2)) * 180 / Math.PI];
    }
    function positionsOf(g) {
      switch (g.type) {
        case "Point": return [g.coordinates];
        case "MultiPoint": case "LineString": return g.coordinates;
        case "MultiLineString": case "Polygon": return g.coordinates.flat();
        case "MultiPolygon": return g.coordinates.flat(2);
        default: return [];
      }
    }
    function drawMapSvg(geometries) {
      const all = geometries.flatMap(positionsOf).filter((p) => Array.isArray(p) && p.length >= 2);
      if (!all.length) return null;
      const projected = all.map(projectLonLat);
      const minX = Math.min(...projected.map((p) => p[0])), maxX = Math.max(...projected.map((p) => p[0]));
      const minY = Math.min(...projected.map((p) => p[1])), maxY = Math.max(...projected.map((p) => p[1]));
      const spanX = Math.max(maxX - minX, 1e-6), spanY = Math.max(maxY - minY, 1e-6);
      const W = 640, PAD = 16, inner = W - PAD * 2;
      const H = Math.max(160, Math.min(480, Math.round(inner * spanY / spanX) + PAD * 2));
      const scale = Math.min(inner / spanX, (H - PAD * 2) / spanY);
      const ox = (W - spanX * scale) / 2, oy = (H - spanY * scale) / 2;
      const to = (p) => { const q = projectLonLat(p); return [ox + (q[0] - minX) * scale, oy + (q[1] - minY) * scale]; };
      const path = (ring) => ring.map((p, i) => (i ? "L" : "M") + to(p).map((n) => n.toFixed(1)).join(" ")).join("");
      const parts = [];
      const draw = (g) => {
        switch (g.type) {
          case "Point": { const [x, y] = to(g.coordinates); parts.push('<circle class="map-point" cx="' + x + '" cy="' + y + '" r="4"/>'); break; }
          case "MultiPoint": g.coordinates.forEach((p) => draw({ type: "Point", coordinates: p })); break;
          case "LineString": parts.push('<path class="map-line" d="' + path(g.coordinates) + '"/>'); break;
          case "MultiLineString": g.coordinates.forEach((l) => draw({ type: "LineString", coordinates: l })); break;
          case "Polygon": parts.push('<path class="map-polygon" fill-rule="evenodd" d="' + g.coordinates.map((r) => path(r) + "Z").join("") + '"/>'); break;
          case "MultiPolygon": g.coordinates.forEach((poly) => draw({ type: "Polygon", coordinates: poly })); break;
        }
      };
      geometries.forEach(draw);
      return '<svg class="map-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Map">' + parts.join("") + "</svg>";
    }
    let topojsonLoad = null;
    function drawMap(out, source) {
      source = source.trim();
      if (out.dataset.source === source) return;
      out.dataset.source = source;
      out.classList.remove("mermaid-error");
      if (!source) { out.textContent = "Paste GeoJSON or TopoJSON above to draw it."; return; }
      clearTimeout(out.__timer);
      out.__timer = setTimeout(async () => {
        try {
          const value = JSON.parse(source);
          let topojson = null;
          if (value && value.type === "Topology") {
            topojsonLoad = topojsonLoad || import("https://esm.sh/topojson-client@3.1.0");
            topojson = await topojsonLoad;
          }
          if (out.dataset.source !== source) return;
          const svg = drawMapSvg(geometriesOf(value, topojson));
          if (!svg) throw new Error("No coordinates to draw.");
          out.innerHTML = svg;
        } catch (err) {
          if (out.dataset.source !== source) return;
          out.textContent = String(err && err.message ? err.message : err).split("\\n")[0];
          out.classList.add("mermaid-error");
        }
      }, 400);
    }

    let threeLoad = null;
    function loadThree() {
      threeLoad = threeLoad || Promise.all([
        import("https://esm.sh/three@0.186.1"),
        import("https://esm.sh/three@0.186.1/examples/jsm/loaders/STLLoader.js"),
        import("https://esm.sh/three@0.186.1/examples/jsm/controls/OrbitControls.js"),
        import("https://esm.sh/three@0.186.1/examples/jsm/utils/BufferGeometryUtils.js"),
      ]).then(([three, loader, controls, utils]) => ({
        three, STLLoader: loader.STLLoader, OrbitControls: controls.OrbitControls, toCreasedNormals: utils.toCreasedNormals,
      }));
      return threeLoad;
    }
    // Each "solid <name>" is a part; a #rrggbb word in its name colors it.
    const STL_PART_COLORS = ["#8b7cf7", "#f2b880", "#6fb7e9", "#ef8fa8", "#86cf9f", "#e9cf72", "#b49a85"];
    function stlPartColor(name, index, parts) {
      const hex = /(?:^|\\s)#([0-9a-f]{6}|[0-9a-f]{3})(?=\\s|$)/i.exec(name || "");
      if (hex) return "#" + hex[1];
      return parts === 1 ? STL_PART_COLORS[0] : STL_PART_COLORS[index % STL_PART_COLORS.length];
    }
    function drawStl(out, source) {
      source = source.trim();
      if (out.dataset.source === source) return;
      out.dataset.source = source;
      out.classList.remove("mermaid-error");
      if (out.__dispose) { out.__dispose(); out.__dispose = null; }
      if (!source) { out.textContent = "Paste an ASCII STL above to show the model."; return; }
      clearTimeout(out.__timer);
      out.__timer = setTimeout(async () => {
        try {
          const { three, STLLoader, OrbitControls, toCreasedNormals } = await loadThree();
          if (out.dataset.source !== source) return;
          const geometry = new STLLoader().parse(new TextEncoder().encode(source).buffer);
          // "facet normal 0 0 0" draws black, so normals come from the triangles:
          // smooth across gentle bends, sharp at real edges.
          toCreasedNormals(geometry, 40 * Math.PI / 180);
          geometry.computeBoundingSphere();
          const sphere = geometry.boundingSphere;
          if (!sphere || !sphere.radius) throw new Error("No triangles found in the STL.");
          const width = out.clientWidth || 360, height = 260;
          const renderer = new three.WebGLRenderer({ antialias: true, alpha: true });
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
          renderer.setSize(width, height);
          out.innerHTML = "";
          out.appendChild(renderer.domElement);
          const scene = new three.Scene();
          const camera = new three.PerspectiveCamera(40, width / height, sphere.radius / 100, sphere.radius * 100);
          const distance = sphere.radius / Math.sin(camera.fov * Math.PI / 360) * 1.2;
          camera.position.set(sphere.center.x + distance * 0.6, sphere.center.y - distance * 0.6, sphere.center.z + distance * 0.5);
          camera.up.set(0, 0, 1);
          camera.lookAt(sphere.center);
          const names = (geometry.userData && geometry.userData.groupNames) || [];
          const groups = geometry.groups.length ? geometry.groups : [null];
          // Double-sided, so triangles wound the wrong way still light up.
          const materials = groups.map((_, i) => new three.MeshStandardMaterial({
            color: stlPartColor(names[i], i, groups.length), metalness: 0, roughness: 0.65, side: three.DoubleSide,
          }));
          scene.add(new three.Mesh(geometry, materials.length === 1 ? materials[0] : materials));
          scene.add(new three.HemisphereLight(0xffffff, 0x555566, 1.5));
          const sun = new three.DirectionalLight(0xffffff, 1.6);
          sun.position.set(1, -1, 2).multiplyScalar(sphere.radius * 5);
          scene.add(sun);
          const fill = new three.DirectionalLight(0xffffff, 0.6);
          fill.position.set(-1, 1, 0.5).multiplyScalar(sphere.radius * 5);
          scene.add(fill);
          const controls = new OrbitControls(camera, renderer.domElement);
          controls.target.copy(sphere.center);
          const render = () => renderer.render(scene, camera);
          controls.addEventListener("change", render);
          controls.update();
          render();
          out.__dispose = () => { controls.dispose(); renderer.dispose(); geometry.dispose(); materials.forEach((m) => m.dispose()); };
        } catch (err) {
          if (out.dataset.source !== source) return;
          out.textContent = String(err && err.message ? err.message : err).split("\\n")[0];
          out.classList.add("mermaid-error");
        }
      }, 400);
    }

    const ExtraShortcuts = Extension.create({
      name: "timelyShortcuts",
      addInputRules() {
        const bullet = this.editor.schema.nodes.bulletList;
        const task = this.editor.schema.nodes.taskList;
        const rules = [];
        if (bullet) {
          rules.push(wrappingInputRule({ find: /^\\s*\\.\\s$/, type: bullet }));
          rules.push(wrappingInputRule({ find: /^\\s*\\*\\s$/, type: bullet }));
        }
        if (task) {
          rules.push(wrappingInputRule({ find: /^\\[\\]\\s$/, type: task }));
        }
        const ordered = this.editor.schema.nodes.orderedList;
        if (ordered) {
          rules.push(wrappingInputRule({ find: /^\\s*1\\.\\s$/, type: ordered }));
        }
        // "> " starts a callout; quotes are only kept for imported Markdown.
        const callout = this.editor.schema.nodes.callout;
        if (callout) {
          rules.push(wrappingInputRule({ find: /^>\\s$/, type: callout, getAttributes: { kind: "note" } }));
        }
        rules.push(new InputRule({
          find: /^(#{1,3})\\s$/,
          handler: ({ range, chain, match }) => {
            const level = match[1].length;
            chain().deleteRange(range).setNode("heading", { level }).run();
          },
        }));
        rules.push(new InputRule({
          find: /^-\\s$/,
          handler: ({ range, chain }) => {
            chain().deleteRange(range).setHorizontalRule().run();
          },
        }));
        return rules;
      },
      addKeyboardShortcuts() {
        return {
          Space: () => {
            const { $from } = this.editor.state.selection;
            if (!$from.parent.isTextblock) return false;
            if (this.editor.isActive("bulletList") || this.editor.isActive("orderedList") || this.editor.isActive("taskList")) return false;
            if ($from.parentOffset !== 1 || $from.parent.textContent !== "-") return false;
            return this.editor.chain().focus().deleteRange({ from: $from.start(), to: $from.pos }).setHorizontalRule().run();
          },
        };
      },
    });

    function capitalizeTyped(view, from, to, text) {
      if (!/^[a-z]$/.test(text)) return false;
      // Code, formulas and properties are typed exactly as written.
      if (view.state.doc.resolve(from).parent.type.spec.code) return false;
      const before = view.state.doc.textBetween(Math.max(0, from - 8), from, "\\n", "\\n");
      if (before && !/[.!?]\\s+$/.test(before) && !/[\\n\\r]$/.test(before)) return false;
      view.dispatch(view.state.tr.insertText(text.toUpperCase(), from, to));
      return true;
    }

    function enhanceCodeBlocks() {
      document.querySelectorAll(".code-wrap pre").forEach((pre) => {
        if (pre.querySelector(".code-copy")) return;
        pre.style.position = "relative";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "code-copy";
        btn.textContent = "Copy";
        btn.addEventListener("mousedown", (event) => event.preventDefault());
        btn.addEventListener("click", () => {
          const text = pre.innerText.replace(/\\n?Copy\\n?$/, "").replace(/Copied$/, "").trim();
          navigator.clipboard.writeText(pre.querySelector("code") ? pre.querySelector("code").innerText : pre.innerText).then(() => {
            btn.textContent = "Copied";
            setTimeout(() => { btn.textContent = "Copy"; }, 1500);
          }).catch(() => undefined);
        });
        pre.appendChild(btn);
      });
    }

    // Fenced mermaid code blocks are drawn below their source. Mermaid is loaded the
    // first time a doc needs it; the source stays a normal code block.
    let mermaidLoad = null;
    let mermaidCount = 0;
    function loadMermaid() {
      if (!mermaidLoad) {
        mermaidLoad = import("https://esm.sh/mermaid@12.1.0").then((mod) => {
          const mermaid = mod.default;
          mermaid.initialize({ startOnLoad: false, securityLevel: "strict", flowchart: { htmlLabels: false }, theme: ${JSON.stringify(t.mode === "light" ? "default" : "dark")}, fontFamily: "inherit" });
          return mermaid;
        });
      }
      return mermaidLoad;
    }
    function drawDiagram(out, source) {
      source = source.trim();
      if (out.dataset.source === source) return;
      out.dataset.source = source;
      out.classList.remove("mermaid-error");
      if (!source) { out.textContent = "Type a diagram above, for example: flowchart TD; A --> B"; return; }
      clearTimeout(out.__timer);
      out.__timer = setTimeout(() => {
        loadMermaid().then((mermaid) => {
          mermaidCount += 1;
          return mermaid.render("doc-mermaid-" + mermaidCount, source);
        }).then(({ svg }) => {
          if (out.dataset.source !== source) return;
          out.innerHTML = svg;
        }).catch((err) => {
          if (out.dataset.source !== source) return;
          out.textContent = String(err && err.message ? err.message : err).split("\\n")[0];
          out.classList.add("mermaid-error");
        });
      }, 400);
    }

    // Code blocks get a wrapper so a mermaid diagram can sit under the
    // source without ProseMirror removing it as unknown DOM.
    const DiagramCodeBlock = CodeBlock.extend({
      addNodeView() {
        return ({ node, getPos, editor }) => {
          const dom = document.createElement("div");
          dom.className = "code-wrap";
          const pre = document.createElement("pre");
          const code = document.createElement("code");
          pre.appendChild(code);
          // Trash button next to Copy removes the whole block.
          const del = document.createElement("button");
          del.type = "button";
          del.className = "code-delete";
          del.setAttribute("contenteditable", "false");
          del.setAttribute("aria-label", "Delete code block");
          del.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
          del.addEventListener("mousedown", (event) => event.preventDefault());
          del.addEventListener("click", () => {
            const pos = getPos();
            if (typeof pos !== "number") return;
            const size = editor.state.doc.nodeAt(pos).nodeSize;
            editor.chain().focus().deleteRange({ from: pos, to: pos + size }).run();
          });
          pre.appendChild(del);
          const out = document.createElement("div");
          out.className = "mermaid-out";
          out.setAttribute("contenteditable", "false");
          // Long code folds to a few lines; the bar sticks to the bottom of the
          // screen while open code scrolls past.
          const fold = document.createElement("div");
          fold.className = "code-fold";
          fold.setAttribute("contenteditable", "false");
          const foldBtn = document.createElement("button");
          foldBtn.type = "button";
          fold.appendChild(foldBtn);
          let expanded = false;
          let lines = 0;
          let foldLang = null;
          let lastText = null;
          const paintFold = (lang) => {
            foldLang = lang;
            const foldable = lines > 3;
            fold.style.display = foldable ? "" : "none";
            pre.classList.toggle("is-folded", foldable && !expanded);
            foldBtn.textContent = expanded ? "Collapse code" : "Show all " + lines + " lines";
          };
          foldBtn.addEventListener("mousedown", (event) => event.preventDefault());
          foldBtn.addEventListener("click", () => {
            expanded = !expanded;
            paintFold(foldLang);
            if (!expanded) dom.scrollIntoView({ block: "nearest" });
          });
          dom.appendChild(pre);
          dom.appendChild(fold);
          dom.appendChild(out);
          const apply = (current) => {
            const lang = current.attrs.language;
            code.className = lang ? "language-" + lang : "";
            lines = current.textContent.split("\\n").length;
            // Editing the code opens it, so typing never disappears under the fold.
            if (lastText !== null && lastText !== current.textContent) expanded = true;
            lastText = current.textContent;
            paintFold(lang);
            if (lang === "mermaid") {
              out.style.display = "";
              drawDiagram(out, current.textContent);
            } else if (lang === "geojson" || lang === "topojson") {
              out.style.display = "";
              drawMap(out, current.textContent);
            } else if (lang === "stl") {
              out.style.display = "";
              drawStl(out, current.textContent);
            } else {
              out.style.display = "none";
            }
          };
          apply(node);
          return {
            dom,
            contentDOM: code,
            update(next) {
              if (next.type !== node.type) return false;
              apply(next);
              return true;
            },
            ignoreMutation(mutation) {
              if (mutation.type === "selection") return false;
              return !code.contains(mutation.target);
            },
          };
        };
      },
    });

    function send(payload) {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }

    ${DOC_EDITOR_HELPERS_JS}

    function inTable() {
      return editor.isActive("table") || editor.isActive("tableCell") || editor.isActive("tableHeader");
    }

    function scrollCaret() {
      try {
        const { from } = editor.state.selection;
        const coords = editor.view.coordsAtPos(from);
        const limit = (window.visualViewport ? window.visualViewport.height : window.innerHeight) - 28;
        if (coords.bottom > limit) {
          const delta = coords.bottom - limit + 16;
          window.scrollBy(0, delta);
          document.documentElement.scrollTop += delta;
          document.body.scrollTop += delta;
        }
        const hit = editor.view.domAtPos(from);
        const node = hit.node && hit.node.nodeType === 3 ? hit.node.parentElement : hit.node;
        if (node && node.scrollIntoView) node.scrollIntoView({ block: "nearest" });
      } catch (err) {}
    }

    function triggerText() {
      const { $from } = editor.state.selection;
      const text = $from.parent.textBetween(0, $from.parentOffset, undefined, "\\ufffc");
      const slash = text.match(/(?:^|\\s)\\/([^\\s]*)$/);
      const mention = text.match(/(?:^|\\s)@([^\\s]*)$/);
      const fromBase = $from.start();
      if (slash && !inTable()) {
        send({ type: "slash", query: slash[1], from: fromBase + slash.index + (slash[0].startsWith(" ") ? 1 : 0), to: $from.pos });
      } else if (mention) {
        send({ type: "mention", query: mention[1], from: fromBase + mention.index + (mention[0].startsWith(" ") ? 1 : 0), to: $from.pos });
      } else {
        send({ type: "hidePickers" });
      }
    }

    function reportSelection() {
      send({
        type: "selection",
        selectedText: editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, "\\n"),
        inTable: inTable(),
        active: {
          bold: editor.isActive("bold"),
          italic: editor.isActive("italic"),
          strike: editor.isActive("strike"),
          highlight: editor.isActive("highlight"),
          code: editor.isActive("code"),
          link: editor.isActive("link"),
          h1: editor.isActive("heading", { level: 1 }),
          h2: editor.isActive("heading", { level: 2 }),
          h3: editor.isActive("heading", { level: 3 }),
          bullet: editor.isActive("bulletList"),
          ordered: editor.isActive("orderedList"),
          task: editor.isActive("taskList"),
          quote: editor.isActive("blockquote"),
          codeBlock: editor.isActive("codeBlock"),
          callout: editor.isActive("callout"),
          toggle: editor.isActive("details"),
          columns: editor.isActive("columns"),
          mathBlock: editor.isActive("mathBlock"),
        },
      });
      triggerText();
      scrollCaret();
    }

    const editor = new Editor({
      element: document.getElementById("editor"),
      extensions: [
        DocumentWithFrontmatter,
        StarterKit.configure({
          document: false,
          heading: { levels: [1, 2, 3, 4, 5, 6] },
          codeBlock: false,
          link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
        }),
        Placeholder.configure({
          showOnlyCurrent: false,
          includeChildren: true,
          placeholder: ({ editor: ed, pos, node }) => {
            if (node.type.name === "detailsSummary") return "Toggle";
            if (!ed.isEmpty || pos !== 0) return "";
            return placeholder;
          },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Highlight,
        DocImage.configure({ inline: true }),
        DiagramCodeBlock,
        TableKit.configure({ table: { resizable: false } }),
        Mention,
        MathInline,
        MathBlock,
        Callout,
        Details,
        DetailsSummary,
        EmbedNode,
        BookmarkNode,
        ColumnsNode,
        ColumnNode,
        FindReplace,
        BlockPick,
        FootnoteRef,
        Footnote,
        Frontmatter,
        WikiLink,
        ExtraShortcuts,
      ],
      content: ${embed(initial)},
      editorProps: {
        attributes: { class: "tiptap", autocapitalize: "sentences", spellcheck: "true" },
        handleTextInput(view, from, to, text) { return capitalizeTyped(view, from, to, text); },
      },
      onCreate({ editor }) {
        send({ type: "ready" });
        reportSelection();
        enhanceCodeBlocks();
        editor.view.dom.addEventListener("click", (event) => {
          const ref = event.target.closest && event.target.closest("sup[data-footnote-ref]");
          if (ref) {
            const found = findFootnote(editor.state.doc, "footnote", ref.getAttribute("data-label") || "");
            if (found) {
              editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(found.pos + found.node.nodeSize - 1), -1)));
              const note = document.querySelector('[data-footnote="' + CSS.escape(ref.getAttribute("data-label") || "") + '"]');
              if (note) note.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            return;
          }
          const wiki = event.target.closest && event.target.closest("a[data-wiki-link]");
          if (wiki) {
            event.preventDefault();
            send({ type: "wikilink", target: wiki.getAttribute("data-target") || "" });
          }
        }, true);
      },
      onUpdate({ editor }) {
        send({ type: "change", content: editor.getJSON(), plainText: editor.getText() });
        reportSelection();
        enhanceCodeBlocks();
      },
      onSelectionUpdate() { reportSelection(); },
      onFocus() { send({ type: "focus" }); },
      onBlur() { send({ type: "blur" }); },
    });

    const TABLE_CMDS = {
      addRowBefore: true, addRowAfter: true, deleteRow: true,
      addColBefore: true, addColAfter: true, deleteCol: true,
      deleteTable: true,
    };
    function runFind(name, payload) {
      const state = editor.state;
      const find = getFind(state);
      const tr = state.tr;
      if (name === "find") {
        editor.view.dispatch(tr.setMeta(findKey, { query: String(payload.query || ""), caseSensitive: Boolean(payload.caseSensitive) }));
        return;
      }
      if (name === "findStep") {
        if (!find.matches.length) return;
        const index = (((find.current + (payload.direction < 0 ? -1 : 1)) % find.matches.length) + find.matches.length) % find.matches.length;
        editor.view.dispatch(revealMatch(tr.setMeta(findKey, { current: index }), find.matches[index]).setMeta("addToHistory", false));
        return;
      }
      const text = String(payload.text || "");
      if (name === "replaceCurrent") {
        const match = find.matches[find.current];
        if (!match) return;
        if (text) tr.insertText(text, match.from, match.to); else tr.delete(match.from, match.to);
        tr.setMeta(findKey, { current: find.current });
        const next = findMatches(tr.doc, find.query, find.caseSensitive);
        const target = next[find.current % Math.max(next.length, 1)];
        if (target) revealMatch(tr, target);
        editor.view.dispatch(tr);
        return;
      }
      if (name === "replaceAll") {
        for (const match of find.matches.slice().reverse()) {
          if (text) tr.insertText(text, match.from, match.to); else tr.delete(match.from, match.to);
        }
        editor.view.dispatch(tr);
      }
    }
    // PDF export: the app turns this page into a PDF (expo-print). The doc
    // is copied as drawn, with folded parts open and editing controls gone.
    function exportHtml(title) {
      const source = document.querySelector(".tiptap");
      if (!source) return;
      const body = source.cloneNode(true);
      body.removeAttribute("contenteditable");
      const fields = source.querySelectorAll("input, select, textarea");
      body.querySelectorAll("input, select, textarea").forEach((field, index) => {
        const from = fields[index];
        if (from && from.type === "checkbox") {
          if (from.checked) field.setAttribute("checked", "");
          return;
        }
        const text = from ? (from.tagName === "SELECT" ? (from.selectedOptions[0] ? from.selectedOptions[0].text : "") : from.value) : "";
        if (!text) { field.remove(); return; }
        const span = document.createElement("span");
        span.className = field.className;
        span.textContent = text;
        field.replaceWith(span);
      });
      body.querySelectorAll(".doc-embed-frame, .doc-bookmark-open, .code-copy, .code-delete, .code-fold, .details-toggle, .ProseMirror-gapcursor, .ProseMirror-trailingBreak").forEach((el) => el.remove());
      body.querySelectorAll(".is-folded").forEach((el) => el.classList.remove("is-folded"));
      body.querySelectorAll(".details").forEach((el) => el.setAttribute("data-open", ""));
      body.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
      body.querySelectorAll(".code-wrap > .block-head").forEach((el) => el.remove());
      body.querySelectorAll(".block-head button").forEach((el) => el.remove());
      const styles = Array.from(document.querySelectorAll("style")).map((el) => el.textContent).join("\\n");
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((el) => '<link rel="stylesheet" href="' + el.href + '">').join("");
      const heading = document.createElement("h1");
      heading.className = "print-title";
      heading.textContent = title || "Untitled";
      const light = "html, body { background: #fff !important; color: #111 !important; } body { padding: 0 !important; } .tiptap { padding: 0 !important; color: #111; } .tiptap pre, .tiptap code, .block-head, .callout, .props-chip { background: #f3f3f5 !important; color: #111 !important; } .tiptap a, .mention, .wiki-link { color: #3730a3 !important; } .print-title { font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif; font-size: 28px; font-weight: 700; margin: 0 0 16px; } .code-wrap pre { padding-top: 12px !important; max-height: none !important; -webkit-mask-image: none !important; mask-image: none !important; } .doc-bookmark { border-color: #ddd !important; } pre, table, img, svg, .callout { break-inside: avoid; } @page { margin: 18mm 16mm; }";
      send({ type: "exportHtml", html: "<!doctype html><html><head><meta charset=\\"utf-8\\">" + links + "<style>" + styles + "</style><style>" + light + "</style></head><body>" + heading.outerHTML + body.outerHTML + "</body></html>" });
    }
    // The Block menu (BlockSheet.tsx) works on the caret's block: the
    // innermost list item, a block in a column, or else the top-level block.
    function caretBlock(state) {
      const sel = state.selection;
      if (sel.node) return sel.node.type.name === "frontmatter" ? null : { from: sel.from, to: sel.to, node: sel.node };
      const $from = sel.$from;
      let depth = 0;
      for (let d = $from.depth; d > 0; d -= 1) {
        const name = $from.node(d).type.name;
        if (name === "listItem" || name === "taskItem") { depth = d; break; }
        if (name === "column" && d < $from.depth) { depth = d + 1; break; }
      }
      if (!depth) depth = 1;
      if ($from.depth < depth) return null;
      const node = $from.node(depth);
      if (node.type.name === "frontmatter") return null;
      const from = $from.before(depth);
      return { from: from, to: from + node.nodeSize, node: node };
    }

    function markBlock(block) {
      editor.view.dispatch(editor.state.tr.setMeta(blockPickKey, block ? { from: block.from, to: block.to } : null));
    }

    function blockInfo() {
      const state = editor.state;
      const block = caretBlock(state);
      markBlock(block);
      if (!block) {
        send({ type: "blockInfo", block: null });
        return;
      }
      const $pos = state.doc.resolve(block.from);
      const index = $pos.index();
      const prev = index > 0 ? $pos.parent.child(index - 1) : null;
      const images = [];
      const addImage = (n) => { if (n.type.name === "image" && n.attrs.src) images.push({ src: n.attrs.src, alt: n.attrs.alt || "" }); };
      addImage(block.node);
      block.node.descendants(addImage);
      const kind = block.node.type.name;
      send({
        type: "blockInfo",
        block: {
          kind: kind,
          level: kind === "heading" ? block.node.attrs.level : 0,
          textual: (kind === "paragraph" || kind === "heading") && images.length === 0,
          canUp: Boolean(prev) && prev.type.name !== "frontmatter",
          canDown: index < $pos.parent.childCount - 1,
          topLevel: $pos.depth === 0,
          images: images,
          node: block.node.toJSON(),
          text: state.doc.textBetween(block.from, block.to, "\\n\\n", " "),
        },
      });
    }

    function blockAction(action) {
      const state = editor.state;
      const block = caretBlock(state);
      markBlock(null);
      if (!block) return;
      const view = editor.view;
      if (action === "delete") {
        // An emptied list or column goes too, or keeps an empty line.
        view.dispatch(state.tr.deleteRange(block.from, block.to).scrollIntoView());
        return;
      }
      if (action === "duplicate") {
        const tr = state.tr.insert(block.to, block.node.copy(block.node.content));
        tr.setSelection(TextSelection.near(tr.doc.resolve(block.to + 1)));
        view.dispatch(tr.scrollIntoView());
        return;
      }
      if (action !== "up" && action !== "down") return;
      const $pos = state.doc.resolve(block.from);
      const index = $pos.index() + (action === "up" ? -1 : 1);
      if (index < 0 || index >= $pos.parent.childCount) return;
      const sibling = $pos.parent.child(index);
      if (sibling.type.name === "frontmatter") return;
      // The caret moves with its block.
      const offset = state.selection.from - block.from;
      const tr = state.tr;
      let start;
      if (action === "up") {
        start = block.from - sibling.nodeSize;
        tr.delete(start, block.from).insert(block.to - sibling.nodeSize, sibling);
      } else {
        tr.delete(block.to, block.to + sibling.nodeSize).insert(block.from, sibling);
        start = block.from + sibling.nodeSize;
      }
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(start + offset, tr.doc.content.size))));
      view.dispatch(tr.scrollIntoView());
    }

    const FIND_CMDS = { find: true, findStep: true, replaceCurrent: true, replaceAll: true };

    const NEW_LINE_CMDS = { diagram: true, mathBlock: true, map: true, stl: true };

    window.__timely = {
      set(content) { editor.commands.setContent(content, { emitUpdate: false }); },
      cmd(name, payload) {
        if (name === "setChrome") {
          const pad = Number(payload && payload.bottomPad) || 120;
          const root = document.getElementById("editor");
          if (root) root.style.paddingBottom = pad + "px";
          requestAnimationFrame(scrollCaret);
          return;
        }
        // Find runs from the app's find bar, so it must not focus the editor.
        if (name === "exportHtml") {
          exportHtml(payload && payload.title);
          return;
        }
        if (FIND_CMDS[name]) {
          runFind(name, payload || {});
          return;
        }
        if (name === "blockInfo") {
          blockInfo();
          return;
        }
        if (name === "blockDone") {
          markBlock(null);
          return;
        }
        if (name === "blockAction") {
          blockAction(payload && payload.action);
          requestAnimationFrame(scrollCaret);
          return;
        }
        // Sets one doc property from a suggestion without moving the caret
        // or opening the keyboard.
        if (name === "setProperty") {
          const key = String((payload && payload.key) || "").trim();
          if (!key) return;
          const value = String((payload && payload.value) || "");
          const { state } = editor;
          const first = state.doc.firstChild;
          const tr = state.tr;
          if (first && first.type.name === "frontmatter") {
            tr.replaceWith(1, 1 + first.content.size, state.schema.text(propertyText(first.textContent, key, value)));
          } else {
            tr.insert(0, state.schema.nodes.frontmatter.create(null, state.schema.text(propertyText("", key, value))));
          }
          editor.view.dispatch(tr);
          return;
        }
        // "Link to an item": report the selected phrase, then swap it for
        // the picked mention if the text is still the same.
        if (name === "linkSelection") {
          const { from, to, $from, $to } = editor.state.selection;
          const text = editor.state.doc.textBetween(from, to, " ");
          const ok = Boolean(text.trim()) && $from.sameParent($to) && $from.parent.inlineContent && !$from.parent.type.spec.code;
          send({ type: "linkSelection", from, to, text, ok });
          return;
        }
        if (name === "linkMention") {
          const from = Number(payload && payload.from);
          const to = Number(payload && payload.to);
          const doc = editor.state.doc;
          const size = doc.content.size;
          if (!payload || !payload.attrs || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > size || from >= to || doc.textBetween(from, to, " ") !== payload.text) {
            send({ type: "linkStale" });
            return;
          }
          const next = to < size ? doc.textBetween(to, Math.min(to + 1, size), " ") : "";
          editor
            .chain()
            .focus()
            .insertContentAt({ from, to }, [
              { type: "mention", attrs: payload.attrs },
              ...(mentionSpaceAfter(next) ? [{ type: "text", text: " " }] : []),
            ])
            .run();
          requestAnimationFrame(scrollCaret);
          return;
        }
        const chain = editor.chain().focus();
        const range = payload && payload.from != null && payload.from >= 0 ? { from: payload.from, to: payload.to } : null;
        if (range && !TABLE_CMDS[name]) chain.deleteRange(range);
        // Blocks added from the toolbar go on a new line after the caret's
        // line instead of turning the text being written into code.
        if (!range && NEW_LINE_CMDS[name]) {
          const { $from } = editor.state.selection;
          if ($from.parent.isTextblock && $from.parent.content.size > 0) {
            const at = $from.after();
            chain.insertContentAt(at, { type: "paragraph" }).setTextSelection(at + 1);
          }
        }
        switch (name) {
          case "paragraph": chain.setParagraph(); break;
          case "h1": chain.setNode("heading", { level: 1 }); break;
          case "h2": chain.setNode("heading", { level: 2 }); break;
          case "h3": chain.setNode("heading", { level: 3 }); break;
          case "bullet": chain.toggleBulletList(); break;
          case "ordered": chain.toggleOrderedList(); break;
          case "task": chain.toggleTaskList(); break;
          case "quote": chain.toggleBlockquote(); break;
          case "code": chain.toggleCodeBlock(); break;
          case "diagram": chain.setCodeBlock({ language: "mermaid" }).insertContent("flowchart TD\\n  A[Start] --> B[Next step]"); break;
          case "callout": chain.wrapIn("callout", { kind: "note" }); break;
          case "liftCallout": chain.lift("callout"); break;
          case "toggle": chain.command(({ state, tr }) => toggleDetailsCmd(state, tr)); break;
          case "columns": chain.command(({ state, tr }) => toggleColumnsCmd(state, tr)); break;
          case "math":
            chain.insertContent({ type: "mathInline", attrs: { latex: "" } }).command(({ tr }) => {
              send({ type: "mathEdit", pos: tr.selection.from - 1, latex: "" });
              return true;
            });
            break;
          case "setMath":
            chain.command(({ tr, state }) => {
              const pos = Number(payload && payload.pos);
              const target = state.doc.nodeAt(pos);
              if (!target || target.type.name !== "mathInline") return false;
              const latex = String(payload.latex || "").trim();
              if (latex) tr.setNodeMarkup(pos, undefined, { latex });
              else tr.delete(pos, pos + 1);
              return true;
            });
            break;
          case "mathBlock": chain.setNode("mathBlock"); break;
          case "footnote":
            chain.command(({ tr, state }) => {
              const label = nextFootnoteLabel(tr.doc);
              const { $to } = tr.selection;
              if (!$to.parent.inlineContent || $to.parent.type.spec.code) return false;
              // The marker goes after any selected words instead of replacing them.
              tr.insert(tr.selection.to, state.schema.nodes.footnoteRef.create({ label }));
              let at = tr.doc.content.size;
              tr.doc.forEach((n, offset) => { if (n.type.name === "footnote") at = offset + n.nodeSize; });
              tr.insert(at, state.schema.nodes.footnote.create({ label }, state.schema.nodes.paragraph.create()));
              const renamed = renumberFootnotes(tr);
              const note = findFootnote(tr.doc, "footnote", renamed.get(label) || label);
              if (note) tr.setSelection(TextSelection.near(tr.doc.resolve(note.pos + note.node.nodeSize - 1), -1));
              tr.scrollIntoView();
              return true;
            });
            break;
          case "frontmatter":
            chain.command(({ tr, state }) => {
              const first = state.doc.firstChild;
              if (first && first.type.name === "frontmatter") {
                tr.setSelection(TextSelection.create(tr.doc, first.nodeSize - 1));
              } else {
                const text = state.schema.text("title: ");
                tr.insert(0, state.schema.nodes.frontmatter.create(null, text));
                tr.setSelection(TextSelection.create(tr.doc, text.nodeSize + 1));
              }
              tr.scrollIntoView();
              return true;
            });
            break;
          case "map": chain.setCodeBlock({ language: "geojson" }).insertContent('{\\n  "type": "Feature",\\n  "geometry": {\\n    "type": "Polygon",\\n    "coordinates": [[[-0.2, 51.45], [0.05, 51.45], [0.05, 51.6], [-0.2, 51.6], [-0.2, 51.45]]]\\n  }\\n}'); break;
          case "stl": chain.setCodeBlock({ language: "stl" }).insertContent("solid pyramid\\n  facet normal 0 0 -1\\n    outer loop\\n      vertex 0 0 0\\n      vertex 1 0 0\\n      vertex 1 1 0\\n    endloop\\n  endfacet\\n  facet normal 0 0 -1\\n    outer loop\\n      vertex 0 0 0\\n      vertex 1 1 0\\n      vertex 0 1 0\\n    endloop\\n  endfacet\\n  facet normal 0 -1 0\\n    outer loop\\n      vertex 0 0 0\\n      vertex 0.5 0.5 1\\n      vertex 1 0 0\\n    endloop\\n  endfacet\\n  facet normal 1 0 0\\n    outer loop\\n      vertex 1 0 0\\n      vertex 0.5 0.5 1\\n      vertex 1 1 0\\n    endloop\\n  endfacet\\n  facet normal 0 1 0\\n    outer loop\\n      vertex 1 1 0\\n      vertex 0.5 0.5 1\\n      vertex 0 1 0\\n    endloop\\n  endfacet\\n  facet normal -1 0 0\\n    outer loop\\n      vertex 0 1 0\\n      vertex 0.5 0.5 1\\n      vertex 0 0 0\\n    endloop\\n  endfacet\\nendsolid pyramid"); break;
          case "image":
            chain.command(({ tr, state }) => {
              const images = ((payload && payload.images) || []).map((image) => state.schema.nodes.image.create({ src: image.src, alt: image.alt || null }));
              if (images.length === 0) return false;
              const { $from } = tr.selection;
              if ($from.parent.type.name === "paragraph" && $from.parent.content.size === 0) {
                tr.replaceWith($from.pos, $from.pos, images);
              } else {
                const at = $from.depth > 0 ? $from.after() : $from.pos;
                tr.insert(at, state.schema.nodes.paragraph.create(null, images));
              }
              tr.scrollIntoView();
              return true;
            });
            break;
          case "linkBlock":
            chain.command(({ tr, state }) => {
              if (!payload || !payload.node) return false;
              const node = state.schema.nodeFromJSON(payload.node);
              const { $from } = tr.selection;
              let at;
              if ($from.parent.type.name === "paragraph" && $from.parent.content.size === 0 && $from.depth > 0) {
                at = $from.before();
                tr.replaceWith(at, $from.after(), node);
              } else {
                at = $from.depth > 0 ? $from.after() : $from.pos;
                tr.insert(at, node);
              }
              // Carry on typing on the line after it.
              const after = at + node.nodeSize;
              const next = tr.doc.nodeAt(after);
              if (!next || next.type.name !== "paragraph" || next.content.size > 0) tr.insert(after, state.schema.nodes.paragraph.create());
              tr.setSelection(TextSelection.create(tr.doc, after + 1));
              tr.scrollIntoView();
              return true;
            });
            break;
          case "hr": chain.setHorizontalRule(); break;
          case "table": chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }); break;
          case "addRowBefore": chain.addRowBefore(); break;
          case "addRowAfter": chain.addRowAfter(); break;
          case "deleteRow": chain.deleteRow(); break;
          case "addColBefore": chain.addColumnBefore(); break;
          case "addColAfter": chain.addColumnAfter(); break;
          case "deleteCol": chain.deleteColumn(); break;
          case "deleteTable": chain.deleteTable(); break;
          case "bold": chain.toggleBold(); break;
          case "italic": chain.toggleItalic(); break;
          case "strike": chain.toggleStrike(); break;
          case "highlight": chain.toggleHighlight(); break;
          case "inlineCode": chain.toggleCode(); break;
          case "setLink":
            if (payload && payload.href) {
              const href = String(payload.href);
              const label = String(payload.label || href);
              if (range) {
                chain.insertContent({ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] });
              } else {
                chain.extendMarkRange("link").setLink({ href });
              }
            }
            break;
          case "unsetLink": chain.extendMarkRange("link").unsetLink(); break;
          case "mentionChar": chain.insertContent("@"); break;
          case "mention":
            chain.insertContent([
              { type: "mention", attrs: payload.attrs },
              { type: "text", text: " " },
            ]);
            break;
        }
        chain.run();
        if (name === "mentionChar") {
          const { from } = editor.state.selection;
          send({ type: "mention", query: "", from: Math.max(0, from - 1), to: from });
        }
        requestAnimationFrame(scrollCaret);
      },
    };
    send({ type: "ready" });
  </script>
</body>
</html>`;
}
