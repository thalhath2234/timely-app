"use client";

import {
  Node as TiptapNode,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";

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
          if (dispatch) {
            tr.replaceSelectionWith(footnoteRef.create({ label }));
            const end = tr.doc.content.size;
            tr.insert(end, footnote.create({ label }, paragraph.create()));
            tr.setSelection(TextSelection.create(tr.doc, end + 2));
            tr.scrollIntoView();
          }
          return true;
        },
    };
  },
});

function FootnoteView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper className="doc-footnote" data-footnote={String(node.attrs.label)}>
      <span className="doc-footnote-label" contentEditable={false} title="Footnote">
        {String(node.attrs.label)}
      </span>
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
      // Backspace on an empty note removes the note block.
      Backspace: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty || $from.parent.type.name !== "paragraph" || $from.parent.textContent) return false;
        if ($from.depth < 2 || $from.node(-1).type.name !== this.name || $from.node(-1).childCount !== 1) return false;
        return this.editor.commands.lift("paragraph");
      },
    };
  },
});
