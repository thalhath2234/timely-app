"use client";

import {
  Node as TiptapNode,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";

/*
 * Footnotes as Markdown writes them: a [^1] marker in the text and a
 * "[^1]: note" block, usually at the end of the doc.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnotes: {
      /** Adds a numbered marker at the selection and its note at the end of the doc. */
      insertFootnote: () => ReturnType;
    };
  }
}

/** The next free number: one more than the highest numeric label in use. */
export function nextFootnoteLabel(doc: PMNode) {
  let highest = 0;
  doc.descendants((node) => {
    if (node.type.name === "footnote" || node.type.name === "footnoteRef") {
      const value = Number(node.attrs.label);
      if (Number.isInteger(value) && value > highest) highest = value;
    }
  });
  return String(highest + 1);
}

const isNumber = (label: unknown) => /^\d+$/.test(String(label));

/** Labels of the markers in reading order, repeats included. */
function refLabels(doc: PMNode) {
  const labels: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "footnoteRef") labels.push(String(node.attrs.label));
  });
  return labels;
}

function countNotes(doc: PMNode) {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === "footnote") count += 1;
    return node.type.name !== "footnote";
  });
  return count;
}

/** Position of the first note or marker carrying `label`. */
export function findFootnote(doc: PMNode, type: "footnote" | "footnoteRef", label: string) {
  let found: { pos: number; node: PMNode } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === type && String(node.attrs.label) === label) found = { pos, node };
  });
  return found as { pos: number; node: PMNode } | null;
}

/**
 * Numbers footnotes 1, 2, 3 in the order their markers appear, the way
 * GitHub and Obsidian show them, and keeps the notes at the end in that
 * order. Named labels ([^source]) are left alone. Returns old -> new labels.
 */
export function renumberFootnotes(tr: Transaction) {
  const order: string[] = [];
  for (const label of refLabels(tr.doc)) {
    if (isNumber(label) && !order.includes(label)) order.push(label);
  }
  tr.doc.descendants((node) => {
    const label = String(node.attrs.label);
    if (node.type.name === "footnote" && isNumber(label) && !order.includes(label)) order.push(label);
    return node.type.name !== "footnote";
  });
  const rename = new Map(order.map((label, index) => [label, String(index + 1)]));
  tr.doc.descendants((node, pos) => {
    if (node.type.name !== "footnote" && node.type.name !== "footnoteRef") return;
    const next = rename.get(String(node.attrs.label));
    if (next && next !== String(node.attrs.label)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: next });
  });

  // Sort the notes when they sit together as one run of top-level blocks.
  const run: number[] = [];
  tr.doc.forEach((node, _offset, index) => {
    if (node.type.name === "footnote") run.push(index);
  });
  if (run.length > 1 && run[run.length - 1] - run[0] === run.length - 1) {
    const notes = run.map((index) => tr.doc.child(index));
    const rank = (node: PMNode) => (isNumber(node.attrs.label) ? Number(node.attrs.label) : Infinity);
    const sorted = [...notes].sort((a, b) => rank(a) - rank(b));
    if (sorted.some((node, i) => node !== notes[i])) {
      let from = 0;
      for (let i = 0; i < run[0]; i++) from += tr.doc.child(i).nodeSize;
      const to = from + notes.reduce((size, node) => size + node.nodeSize, 0);
      tr.replaceWith(from, to, Fragment.fromArray(sorted));
    }
  }
  return rename;
}

/** Puts the caret at the end of the note's text and scrolls to it. */
function selectNoteEnd(tr: Transaction, label: string) {
  const note = findFootnote(tr.doc, "footnote", label);
  if (!note) return false;
  tr.setSelection(TextSelection.near(tr.doc.resolve(note.pos + note.node.nodeSize - 1), -1));
  tr.scrollIntoView();
  return true;
}

/** Puts the caret just after the note's first marker and scrolls to it. */
export function selectRef(state: EditorState, label: string) {
  const ref = findFootnote(state.doc, "footnoteRef", label);
  if (!ref) return null;
  return state.tr.setSelection(TextSelection.create(state.doc, ref.pos + ref.node.nodeSize)).scrollIntoView();
}

export const FootnoteRef = TiptapNode.create({
  name: "footnoteRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      label: {
        default: "1",
        parseHTML: (element) => element.getAttribute("data-label") ?? "1",
        renderHTML: (attributes) => ({ "data-label": attributes.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "sup[data-footnote-ref]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "sup",
      mergeAttributes(HTMLAttributes, {
        "data-footnote-ref": "",
        class: "doc-footnote-ref",
        title: `Footnote ${node.attrs.label}`,
      }),
      `[${node.attrs.label}]`,
    ];
  },

  // Markers carry no words worth searching.
  renderText() {
    return "";
  },

  addCommands() {
    return {
      insertFootnote:
        () =>
        ({ state, tr, dispatch }) => {
          const label = nextFootnoteLabel(state.doc);
          const { footnoteRef, footnote, paragraph } = state.schema.nodes;
          if (!footnoteRef || !footnote || !paragraph) return false;
          if (!state.selection.$to.parent.inlineContent || state.selection.$to.parent.type.spec.code) return false;
          if (dispatch) {
            // The marker goes after any selected words instead of replacing them.
            tr.insert(state.selection.to, footnoteRef.create({ label }));
            // New notes join the others so they stay together at the end.
            let at = tr.doc.content.size;
            tr.doc.forEach((node, offset) => {
              if (node.type.name === "footnote") at = offset + node.nodeSize;
            });
            tr.insert(at, footnote.create({ label }, paragraph.create()));
            const renamed = renumberFootnotes(tr);
            selectNoteEnd(tr, renamed.get(label) ?? label);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("footnoteLinks"),
        props: {
          // Clicking a marker goes to its note.
          handleClickOn: (view, _pos, node) => {
            if (node.type.name !== "footnoteRef") return false;
            const tr = view.state.tr;
            if (!selectNoteEnd(tr, String(node.attrs.label))) return false;
            view.dispatch(tr);
            view.focus();
            return true;
          },
          handleDOMEvents: {
            // Hovering a marker shows the note's text.
            mouseover: (view, event) => {
              const el = (event.target as HTMLElement | null)?.closest?.("sup.doc-footnote-ref") as HTMLElement | null;
              if (!el) return false;
              const label = el.dataset.label ?? "";
              const note = findFootnote(view.state.doc, "footnote", label);
              el.title = note?.node.textContent.trim() || `Footnote ${label}`;
              return false;
            },
          },
        },
        // Deleting a marker deletes its note, and the rest renumber.
        appendTransaction: (transactions, oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          if (transactions.some((tr) => tr.getMeta("preventUpdate"))) return null;
          const before = refLabels(oldState.doc);
          const after = refLabels(newState.doc);
          if (before.join("\u0000") === after.join("\u0000")) return null;
          // Whole-doc swaps (loading, importing) change notes too; leave those.
          if (countNotes(oldState.doc) !== countNotes(newState.doc)) return null;
          const tr = newState.tr;
          const gone = new Set(before.filter((label) => !after.includes(label)));
          const doomed: { pos: number; size: number }[] = [];
          newState.doc.descendants((node, pos) => {
            if (node.type.name === "footnote" && gone.has(String(node.attrs.label))) doomed.push({ pos, size: node.nodeSize });
            return node.type.name !== "footnote";
          });
          for (const { pos, size } of doomed.reverse()) tr.delete(pos, pos + size);
          renumberFootnotes(tr);
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});

function FootnoteView({ node, editor }: NodeViewProps) {
  const label = String(node.attrs.label);
  // The number leads back to where the note is referenced.
  const back = () => {
    const tr = selectRef(editor.state, label);
    if (!tr) return;
    editor.view.dispatch(tr);
    editor.view.focus();
  };
  return (
    <NodeViewWrapper className="doc-footnote" data-footnote={label}>
      <button
        type="button"
        className="doc-footnote-label"
        contentEditable={false}
        title="Back to the text"
        onMouseDown={(event) => event.preventDefault()}
        onClick={back}
      >
        {label}
      </button>
      <NodeViewContent className="doc-footnote-body" />
    </NodeViewWrapper>
  );
}

export const Footnote = TiptapNode.create({
  name: "footnote",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      label: {
        default: "1",
        parseHTML: (element) => element.getAttribute("data-label") ?? "1",
        renderHTML: (attributes) => ({ "data-label": attributes.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-footnote]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-footnote": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteView);
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
        const doomed: { pos: number; size: number }[] = [];
        state.doc.descendants((node, pos) => {
          if ((node.type.name === "footnote" || node.type.name === "footnoteRef") && String(node.attrs.label) === label) {
            doomed.push({ pos, size: node.nodeSize });
          }
        });
        const ref = doomed.find((item) => state.doc.nodeAt(item.pos)?.type.name === "footnoteRef");
        for (const { pos, size } of doomed.reverse()) tr.delete(pos, pos + size);
        renumberFootnotes(tr);
        // Back to where the marker was, or the end of the doc.
        const at = ref ? tr.mapping.map(ref.pos) : tr.doc.content.size;
        tr.setSelection(TextSelection.near(tr.doc.resolve(at), -1)).scrollIntoView();
        view.dispatch(tr);
        return true;
      },
    };
  },
});
