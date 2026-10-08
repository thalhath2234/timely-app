import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { EMBED_PROVIDERS, embedInfo, linkHost } from "@timely/contract/embeds";
import { getLinkPreview } from "@/app/utils/api/docs";

/**
 * Embeds (a YouTube video, Spotify song, Figma file... shown in the doc) and
 * bookmarks (a link card with the page's title and description). Both are
 * blocks with no text of their own; see apps/api/internal/richtext/embeds.go
 * for their Markdown.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    linkBlocks: {
      /** Adds an empty embed or bookmark that asks for its link. */
      insertLinkBlock: (type: "embed" | "bookmark") => ReturnType;
    };
  }
}

const LINK_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

function isWebLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

type PosGetter = () => number | undefined;

function setAttrs(editor: Editor, getPos: PosGetter, attrs: Record<string, unknown>) {
  const pos = getPos();
  if (typeof pos !== "number") return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
}

function removeNode(editor: Editor, getPos: PosGetter) {
  const pos = getPos();
  if (typeof pos !== "number") return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
}

/** The "paste a link" box an empty embed or bookmark shows. */
function linkForm(
  editor: Editor,
  getPos: PosGetter,
  options: { placeholder: string; hint: string; submit: (value: string, fail: (message: string) => void) => void },
) {
  const form = document.createElement("form");
  form.className = "doc-link-form";
  const input = document.createElement("input");
  input.type = "url";
  input.placeholder = options.placeholder;
  input.className = "doc-link-input";
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Add";
  const hint = document.createElement("p");
  hint.className = "doc-link-hint";
  hint.textContent = options.hint;
  form.append(input, button, hint);
  const fail = (message: string) => {
    hint.textContent = message;
    hint.dataset.error = "";
    button.disabled = false;
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!isWebLink(value)) return fail("Paste a full link that starts with https://");
    button.disabled = true;
    options.submit(value, fail);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || (event.key === "Backspace" && !input.value)) {
      event.preventDefault();
      removeNode(editor, getPos);
    }
  });
  // Keep the editor from treating typing in the box as its own.
  for (const type of ["keydown", "keypress", "input", "paste", "mousedown"]) {
    form.addEventListener(type, (event) => event.stopPropagation());
  }
  if (editor.isEditable) requestAnimationFrame(() => input.focus());
  else input.disabled = true;
  return form;
}

export const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return { src: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "div[data-embed]", getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute("data-src") ?? "" }) }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-embed": "", "data-src": node.attrs.src, class: "doc-embed" })];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current: PMNode = node;
      const dom = document.createElement("div");
      dom.className = "doc-embed";
      dom.contentEditable = "false";

      const paint = () => {
        dom.replaceChildren();
        const src = String(current.attrs.src ?? "");
        const info = src ? embedInfo(src) : null;
        if (!src || !info) {
          if (src) {
            // Not a provider Timely knows: show it as a plain link.
            const link = document.createElement("a");
            link.href = src;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.className = "doc-embed-caption";
            link.textContent = src;
            dom.append(link);
            return;
          }
          dom.append(
            linkForm(editor, getPos as PosGetter, {
              placeholder: "Paste a link to embed",
              hint: `Works with ${EMBED_PROVIDERS.join(", ")}.`,
              submit: (value, fail) => {
                if (!embedInfo(value)) return fail(`That link cannot be embedded. Use ${EMBED_PROVIDERS.join(", ")}, or add it as a bookmark.`);
                setAttrs(editor, getPos as PosGetter, { src: value });
              },
            }),
          );
          return;
        }
        const frame = document.createElement("div");
        frame.className = "doc-embed-frame";
        if (info.aspect) frame.style.aspectRatio = String(info.aspect);
        if (info.height) frame.style.height = `${info.height}px`;
        const iframe = document.createElement("iframe");
        iframe.src = info.src;
        iframe.title = `${info.provider} embed`;
        iframe.loading = "lazy";
        iframe.referrerPolicy = "strict-origin-when-cross-origin";
        iframe.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
        iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms");
        frame.append(iframe);
        const caption = document.createElement("div");
        caption.className = "doc-embed-caption";
        const label = document.createElement("span");
        label.textContent = info.provider;
        const link = document.createElement("a");
        link.href = src;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.innerHTML = LINK_ICON;
        link.append(document.createTextNode(linkHost(src)));
        caption.append(label, link);
        dom.append(frame, caption);
      };
      paint();

      return {
        dom,
        update: (next) => {
          if (next.type !== current.type) return false;
          const changed = next.attrs.src !== current.attrs.src;
          current = next;
          if (changed) paint();
          return true;
        },
        stopEvent: (event) => event.target instanceof HTMLElement && Boolean(event.target.closest("form, a")),
        ignoreMutation: () => true,
      };
    };
  },

  addCommands() {
    return {
      insertLinkBlock:
        (type) =>
        ({ chain }) =>
          chain().insertContent({ type, attrs: type === "embed" ? { src: "" } : { url: "" } }).run(),
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("embedPaste"),
        props: {
          // A bare embeddable link pasted on an empty line becomes an embed.
          handlePaste(view, event) {
            const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
            if (!text || /\s/.test(text) || !embedInfo(text)) return false;
            const { $from, empty } = view.state.selection;
            if (!empty || $from.parent.type.name !== "paragraph" || $from.parent.content.size > 0) return false;
            editor.chain().focus().insertContentAt({ from: $from.before(), to: $from.after() }, { type: "embed", attrs: { src: text } }).run();
            return true;
          },
        },
      }),
    ];
  },
});

export const Bookmark = Node.create({
  name: "bookmark",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return { url: { default: "" }, title: { default: "" }, description: { default: "" } };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-bookmark]",
        getAttrs: (el) => {
          const element = el as HTMLElement;
          return {
            url: element.getAttribute("data-url") ?? "",
            title: element.getAttribute("data-title") ?? "",
            description: element.getAttribute("data-description") ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-bookmark": "",
        "data-url": node.attrs.url,
        "data-title": node.attrs.title,
        "data-description": node.attrs.description,
        class: "doc-bookmark",
      }),
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current: PMNode = node;
      const dom = document.createElement("div");
      dom.className = "doc-bookmark";
      dom.contentEditable = "false";

      const paint = () => {
        dom.replaceChildren();
        const url = String(current.attrs.url ?? "");
        if (!url) {
          dom.append(
            linkForm(editor, getPos as PosGetter, {
              placeholder: "Paste a link to bookmark",
              hint: "Timely reads the page's title and description.",
              submit: (value) => {
                void getLinkPreview(value)
                  .catch(() => ({ title: "", description: "" }))
                  .then((preview) => setAttrs(editor, getPos as PosGetter, { url: value, title: preview.title, description: preview.description }));
              },
            }),
          );
          return;
        }
        const card = document.createElement("a");
        card.className = "doc-bookmark-card";
        card.href = url;
        card.target = "_blank";
        card.rel = "noopener noreferrer";
        const title = document.createElement("span");
        title.className = "doc-bookmark-title";
        title.textContent = String(current.attrs.title || linkHost(url));
        card.append(title);
        if (current.attrs.description) {
          const description = document.createElement("span");
          description.className = "doc-bookmark-description";
          description.textContent = String(current.attrs.description);
          card.append(description);
        }
        const host = document.createElement("span");
        host.className = "doc-bookmark-host";
        host.innerHTML = LINK_ICON;
        host.append(document.createTextNode(url.replace(/^https?:\/\//, "")));
        card.append(host);
        dom.append(card);
      };
      paint();

      return {
        dom,
        update: (next) => {
          if (next.type !== current.type) return false;
          const changed = ["url", "title", "description"].some((key) => next.attrs[key] !== current.attrs[key]);
          current = next;
          if (changed) paint();
          return true;
        },
        stopEvent: (event) => event.target instanceof HTMLElement && Boolean(event.target.closest("form")),
        ignoreMutation: () => true,
      };
    };
  },
});
