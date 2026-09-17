import type { DocContent } from "../../lib/types";

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
    .tiptap ul, .tiptap ol { padding-left: 1.3em; margin: 0 0 0.75em; }
    .tiptap blockquote { border-left: 3px solid ${t.primary}; margin: 0 0 0.75em; padding: 0 0 0 12px; color: ${t.accentForeground}; }
    .tiptap pre { position: relative; background: ${t.muted}; border: 1px solid ${t.border}; border-radius: 10px; padding: 36px 12px 12px; overflow-x: auto; color: ${t.foreground}; }
    .tiptap code { font-family: ui-monospace, "Cascadia Code", "Fira Code", Menlo, monospace; font-size: 13.5px; }
    .tiptap p code { background: ${t.muted}; color: ${t.accentForeground}; padding: 0.1em 0.35em; border-radius: 4px; }
    .code-copy { position: absolute; top: 8px; right: 8px; background: ${t.muted}; color: ${t.mutedForeground}; border: 1px solid ${t.border}; border-radius: 6px; font-size: 11px; font-weight: 600; padding: 4px 8px; }
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
    .tiptap p.is-editor-empty:first-child::before,
    .tiptap .is-empty::before { color: ${t.mutedForeground}; content: attr(data-placeholder); float: left; height: 0; pointer-events: none; }
  </style>
</head>
<body>
  <div id="editor"></div>
  <script type="module">
    import { Editor, Node, Extension, InputRule, wrappingInputRule } from "https://esm.sh/@tiptap/core@3.29.2";
    import StarterKit from "https://esm.sh/@tiptap/starter-kit@3.29.2";
    import { TableKit } from "https://esm.sh/@tiptap/extension-table@3.29.2";
    import TaskList from "https://esm.sh/@tiptap/extension-task-list@3.29.2";
    import TaskItem from "https://esm.sh/@tiptap/extension-task-item@3.29.2";
    import Highlight from "https://esm.sh/@tiptap/extension-highlight@3.29.2";
    import { Placeholder } from "https://esm.sh/@tiptap/extensions@3.29.2";

    const placeholder = ${embed(placeholder)};
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
        const quote = this.editor.schema.nodes.blockquote;
        if (quote) {
          rules.push(wrappingInputRule({ find: /^>\\s$/, type: quote }));
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
      const before = view.state.doc.textBetween(Math.max(0, from - 8), from, "\\n", "\\n");
      if (before && !/[.!?]\s+$/.test(before) && !/[\\n\\r]$/.test(before)) return false;
      view.dispatch(view.state.tr.insertText(text.toUpperCase(), from, to));
      return true;
    }

    function enhanceCodeBlocks() {
      document.querySelectorAll("pre").forEach((pre) => {
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

    function send(payload) {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }

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
        },
      });
      triggerText();
      scrollCaret();
    }

    const editor = new Editor({
      element: document.getElementById("editor"),
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
        }),
        Placeholder.configure({
          showOnlyCurrent: false,
          placeholder: ({ editor: ed, pos }) => {
            if (!ed.isEmpty || pos !== 0) return "";
            return placeholder;
          },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Highlight,
        TableKit.configure({ table: { resizable: false } }),
        Mention,
        ExtraShortcuts,
      ],
      content: ${embed(initial)},
      editorProps: {
        attributes: { class: "tiptap", autocapitalize: "sentences", spellcheck: "true" },
        handleTextInput(view, from, to, text) { return capitalizeTyped(view, from, to, text); },
      },
      onCreate() { send({ type: "ready" }); reportSelection(); enhanceCodeBlocks(); },
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
      deleteTable: true, headerRow: true, headerCol: true,
      merge: true, split: true,
    };

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
        const chain = editor.chain().focus();
        const range = payload && payload.from != null && payload.from >= 0 ? { from: payload.from, to: payload.to } : null;
        if (range && !TABLE_CMDS[name]) chain.deleteRange(range);
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
          case "hr": chain.setHorizontalRule(); break;
          case "table": chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }); break;
          case "addRowBefore": chain.addRowBefore(); break;
          case "addRowAfter": chain.addRowAfter(); break;
          case "deleteRow": chain.deleteRow(); break;
          case "addColBefore": chain.addColumnBefore(); break;
          case "addColAfter": chain.addColumnAfter(); break;
          case "deleteCol": chain.deleteColumn(); break;
          case "deleteTable": chain.deleteTable(); break;
          case "headerRow": chain.toggleHeaderRow(); break;
          case "headerCol": chain.toggleHeaderColumn(); break;
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
          case "merge": chain.mergeCells(); break;
          case "split": chain.splitCell(); break;
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
