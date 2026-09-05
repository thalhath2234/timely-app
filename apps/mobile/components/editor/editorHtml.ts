import type { DocContent } from "../../lib/types";

const BLANK: DocContent = { type: "doc", content: [{ type: "paragraph" }] };

function embed(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** TipTap 3 document loaded in a WebView — same schema as the web /m editor. */
export function buildEditorHtml(content: DocContent | null | undefined, placeholder: string) {
  const initial = content && typeof content.type === "string" ? content : BLANK;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, editable=true" />
  <style>
    :root { color-scheme: dark; }
    html, body { margin: 0; padding: 0; background: #1a1b22; }
    body { min-height: 100%; }
    #editor { min-height: 70vh; padding: 4px 2px 96px; }
    .tiptap { outline: none; color: #ececf1; font-size: 16px; line-height: 1.55; font-family: ui-sans-serif, system-ui, sans-serif; }
    .tiptap p { margin: 0 0 0.75em; }
    .tiptap h1 { font-size: 26px; line-height: 1.25; font-weight: 700; margin: 0.8em 0 0.4em; }
    .tiptap h2 { font-size: 22px; line-height: 1.3; font-weight: 700; margin: 0.7em 0 0.35em; }
    .tiptap h3 { font-size: 18px; line-height: 1.35; font-weight: 600; margin: 0.6em 0 0.3em; }
    .tiptap ul, .tiptap ol { padding-left: 1.3em; margin: 0 0 0.75em; }
    .tiptap blockquote { border-left: 3px solid #8b7cf7; margin: 0 0 0.75em; padding: 0 0 0 12px; color: #d4cff5; }
    .tiptap pre { background: #25262e; border: 1px solid rgba(255,255,255,0.09); border-radius: 10px; padding: 12px; overflow-x: auto; }
    .tiptap code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13.5px; }
    .tiptap p code { background: #2c2d36; color: #d4cff5; padding: 0.1em 0.35em; border-radius: 4px; }
    .tiptap hr { border: none; border-top: 1px solid rgba(255,255,255,0.12); margin: 16px 0; }
    .tiptap mark { background: #3a3558; color: #d4cff5; }
    .tiptap a { color: #8b7cf7; }
    .tiptap table { border-collapse: collapse; width: 100%; margin: 0 0 0.9em; }
    .tiptap th, .tiptap td { border: 1px solid rgba(255,255,255,0.12); padding: 8px; vertical-align: top; min-width: 72px; }
    .tiptap th { background: #2c2d36; font-weight: 600; }
    .tiptap ul[data-type="taskList"] { list-style: none; padding-left: 0; }
    .tiptap ul[data-type="taskList"] li { display: flex; gap: 8px; align-items: flex-start; }
    .tiptap ul[data-type="taskList"] input { margin-top: 4px; }
    .mention { color: #8b7cf7; font-weight: 600; background: #3a3558; border-radius: 6px; padding: 0 4px; }
    .tiptap p.is-editor-empty:first-child::before,
    .tiptap .is-empty::before { color: #9a9aa8; content: attr(data-placeholder); float: left; height: 0; pointer-events: none; }
  </style>
</head>
<body>
  <div id="editor"></div>
  <script type="module">
    import { Editor, Node } from "https://esm.sh/@tiptap/core@3.29.2";
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
        };
      },
      parseHTML() { return [{ tag: "span[data-mention]" }]; },
      renderHTML({ HTMLAttributes }) {
        return ["span", { ...HTMLAttributes, "data-mention": "", class: "mention" }, "@" + (HTMLAttributes.label || "mention")];
      },
      renderText({ node }) { return "@" + (node.attrs.label || "mention"); },
    });

    function send(payload) {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }

    function triggerText() {
      const { $from } = editor.state.selection;
      const text = $from.parent.textBetween(0, $from.parentOffset, undefined, "\\ufffc");
      const slash = text.match(/(?:^|\\s)\\/([^\\s]*)$/);
      const mention = text.match(/(?:^|\\s)@([^\\s]*)$/);
      const fromBase = $from.start();
      if (slash) {
        send({ type: "slash", query: slash[1], from: fromBase + slash.index + (slash[0].startsWith(" ") ? 1 : 0), to: $from.pos });
      } else if (mention) {
        send({ type: "mention", query: mention[1], from: fromBase + mention.index + (mention[0].startsWith(" ") ? 1 : 0), to: $from.pos });
      } else {
        send({ type: "hidePickers" });
      }
    }

    const editor = new Editor({
      element: document.getElementById("editor"),
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
        }),
        Placeholder.configure({ placeholder }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Highlight,
        TableKit.configure({ table: { resizable: false } }),
        Mention,
      ],
      content: ${embed(initial)},
      editorProps: { attributes: { class: "tiptap" } },
      onCreate() { send({ type: "ready" }); },
      onUpdate({ editor }) {
        send({ type: "change", content: editor.getJSON(), plainText: editor.getText() });
        triggerText();
      },
      onSelectionUpdate() { triggerText(); },
    });

    window.__timely = {
      set(content) { editor.commands.setContent(content, { emitUpdate: false }); },
      cmd(name, payload) {
        const chain = editor.chain().focus();
        const range = payload && payload.from != null ? { from: payload.from, to: payload.to } : null;
        if (range) chain.deleteRange(range);
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
          case "bold": chain.toggleBold(); break;
          case "italic": chain.toggleItalic(); break;
          case "strike": chain.toggleStrike(); break;
          case "highlight": chain.toggleHighlight(); break;
          case "inlineCode": chain.toggleCode(); break;
          case "mentionChar": chain.insertContent("@"); break;
          case "mention":
            chain.insertContent([
              { type: "mention", attrs: payload.attrs },
              { type: "text", text: " " },
            ]);
            break;
        }
        chain.run();
      },
    };
    send({ type: "ready" });
  </script>
</body>
</html>`;
}
