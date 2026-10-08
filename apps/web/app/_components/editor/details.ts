import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

/**
 * Toggle block (Notion's toggle, HTML <details>): a one-line summary that
 * folds the blocks under it. Stored as `details` (attr `open`) holding a
 * plain-text `detailsSummary` and then one or more blocks; Markdown is
 * <details><summary> (see apps/api/internal/richtext/blocks.go).
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    details: {
      /** Turns the caret's block into the summary of a new open toggle, or
       * unwraps the toggle the caret is in. */
      toggleDetails: () => ReturnType;
    };
  }
}

function findDetails(state: { selection: { $from: { depth: number; node: (d: number) => PMNode; before: (d: number) => number } } }) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "details") return { node, pos: $from.before(depth) };
  }
  return null;
}

export const DetailsSummary = Node.create({
  name: "detailsSummary",
  content: "text*",
  marks: "",
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: "summary" }, { tag: "div[data-details-summary]" }];
  },
  // A real <summary> is a button to the browser, which will not put the
  // caret in it, so the editor draws a div.
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "doc-details-summary", "data-details-summary": "" }), 0];
  },
});

export const Details = Node.create({
  name: "details",
  // Above the default keymap, so Enter and Backspace on the summary are ours.
  priority: 1000,
  group: "block",
  content: "detailsSummary block+",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element: HTMLElement) => element.hasAttribute("open"),
        renderHTML: (attrs: { open?: boolean }) => (attrs.open ? { open: "" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "details" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["details", mergeAttributes(HTMLAttributes, { class: "doc-details" }), 0];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement("div");
      dom.className = "doc-details";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "doc-details-toggle";
      button.contentEditable = "false";
      button.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
      const content = document.createElement("div");
      content.className = "doc-details-body";
      dom.append(button, content);

      const paint = () => {
        dom.toggleAttribute("data-open", Boolean(current.attrs.open));
        button.setAttribute("aria-expanded", String(Boolean(current.attrs.open)));
        button.setAttribute("aria-label", current.attrs.open ? "Fold" : "Unfold");
      };
      paint();

      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos !== "number") return;
        const open = !current.attrs.open;
        const { tr } = editor.state;
        tr.setNodeMarkup(pos, undefined, { ...current.attrs, open });
        tr.setMeta("addToHistory", false);
        // Folding with the caret inside hides it; put it on the summary.
        if (!open) {
          const { from } = editor.state.selection;
          if (from > pos + current.firstChild!.nodeSize && from < pos + current.nodeSize) {
            tr.setSelection(TextSelection.create(tr.doc, pos + current.firstChild!.nodeSize));
          }
        }
        editor.view.dispatch(tr);
      });

      return {
        dom,
        contentDOM: content,
        update: (next) => {
          if (next.type !== current.type) return false;
          current = next;
          paint();
          return true;
        },
        ignoreMutation: (mutation) => button.contains(mutation.target as globalThis.Node),
      };
    };
  },

  addCommands() {
    return {
      toggleDetails:
        () =>
        ({ state, tr, dispatch }) => {
          const schema = state.schema;
          const found = findDetails(state);
          if (found) {
            // Unwrap: the summary becomes a paragraph, the body stays.
            const summary = found.node.firstChild!;
            const blocks: PMNode[] = [schema.nodes.paragraph.create(null, summary.content)];
            found.node.forEach((child, _offset, index) => {
              if (index > 0) blocks.push(child);
            });
            if (dispatch) {
              tr.replaceWith(found.pos, found.pos + found.node.nodeSize, blocks);
              tr.setSelection(TextSelection.near(tr.doc.resolve(found.pos + 1)));
              dispatch(tr.scrollIntoView());
            }
            return true;
          }
          const { $from } = state.selection;
          const block = $from.parent;
          if (!block.isTextblock || block.type.spec.code || $from.depth < 1) return false;
          const text = block.textContent;
          const node = schema.nodes.details.create({ open: true }, [
            schema.nodes.detailsSummary.create(null, text ? schema.text(text) : null),
            schema.nodes.paragraph.create(),
          ]);
          if (dispatch) {
            const start = $from.before();
            tr.replaceWith(start, $from.after(), node);
            tr.setSelection(TextSelection.create(tr.doc, start + 2 + text.length));
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    // Folded bodies are hidden, and the browser's own caret moves get lost
    // around hidden text, so moves into, out of and along a folded toggle's
    // summary are done here.
    const summaryEnd = (detailsPos: number, details: PMNode) => detailsPos + details.firstChild!.nodeSize;
    const inFoldedSummary = (editor: Editor) => {
      const { $from } = editor.state.selection;
      if ($from.parent.type.name !== "detailsSummary") return null;
      const pos = $from.before($from.depth - 1);
      const details = editor.state.doc.nodeAt(pos);
      return details && !details.attrs.open ? { pos, details } : null;
    };
    const leaveForward = (editor: Editor) => {
      const folded = inFoldedSummary(editor);
      if (!folded) return false;
      const { state } = editor;
      if (editor.state.selection.$from.parentOffset < folded.details.firstChild!.content.size) return false;
      const after = folded.pos + folded.details.nodeSize;
      const tr = state.tr;
      if (after >= tr.doc.content.size || !tr.doc.resolve(after).nodeAfter?.isTextblock) {
        tr.insert(after, state.schema.nodes.paragraph.create());
      }
      tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
      editor.view.dispatch(tr.scrollIntoView());
      return true;
    };
    // The caret is at the start of a block right after a folded toggle.
    const foldedBefore = (editor: Editor, anywhereOnLine = false) => {
      const { $from, empty } = editor.state.selection;
      if (!empty || (!anywhereOnLine && $from.parentOffset > 0) || $from.depth < 1) return null;
      const before = editor.state.doc.resolve($from.before()).nodeBefore;
      if (!before || before.type.name !== "details" || before.attrs.open) return null;
      return { pos: $from.before() - before.nodeSize, details: before };
    };
    const enterFromBelow = (editor: Editor, removeEmpty: boolean, anywhereOnLine = false) => {
      const folded = foldedBefore(editor, anywhereOnLine);
      if (!folded) return false;
      const { $from } = editor.state.selection;
      const tr = editor.state.tr;
      if (removeEmpty && $from.parent.content.size === 0) tr.delete($from.before(), $from.after());
      tr.setSelection(TextSelection.create(tr.doc, summaryEnd(folded.pos, folded.details)));
      editor.view.dispatch(tr.scrollIntoView());
      return true;
    };
    return {
      Home: ({ editor }) => editor.state.selection.$from.parent.type.name === "detailsSummary" && editor.commands.selectTextblockStart(),
      End: ({ editor }) => editor.state.selection.$from.parent.type.name === "detailsSummary" && editor.commands.selectTextblockEnd(),
      ArrowDown: ({ editor }) => {
        const folded = inFoldedSummary(editor);
        if (!folded) return false;
        editor.commands.selectTextblockEnd();
        return leaveForward(editor);
      },
      ArrowRight: ({ editor }) => leaveForward(editor),
      ArrowUp: ({ editor }) => editor.view.endOfTextblock("up") && enterFromBelow(editor, false, true),
      ArrowLeft: ({ editor }) => enterFromBelow(editor, false),
      // Enter on the summary opens the toggle and moves into its body.
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.name !== "detailsSummary") return false;
        const detailsPos = $from.before($from.depth - 1);
        const details = state.doc.nodeAt(detailsPos);
        if (!details) return false;
        const bodyStart = detailsPos + 1 + details.firstChild!.nodeSize;
        const tr = state.tr;
        if (!details.attrs.open) tr.setNodeMarkup(detailsPos, undefined, { ...details.attrs, open: true });
        const first = details.child(1);
        if (!(first.type.name === "paragraph" && first.content.size === 0)) {
          tr.insert(bodyStart, state.schema.nodes.paragraph.create());
        }
        tr.setSelection(TextSelection.create(tr.doc, bodyStart + 1));
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
      // Backspace at the start of the summary unwraps the toggle.
      Backspace: ({ editor }) => {
        if (enterFromBelow(editor, true)) return true;
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== "detailsSummary" || $from.parentOffset > 0) return false;
        return editor.commands.toggleDetails();
      },
    };
  },
});
