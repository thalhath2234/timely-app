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
import { Tags } from "lucide-react";

/*
 * Frontmatter is the "---" block of key: value lines at the top of a
 * Markdown file. Obsidian shows it as page properties; GitHub as a table.
 * It is kept verbatim and can only sit first in the doc.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    frontmatter: {
      /** Puts the cursor in the properties block, creating it when missing. */
      editFrontmatter: () => ReturnType;
    };
  }
}

/** Only the top node may hold frontmatter, and only as its first child. */
export const DocumentWithFrontmatter = TiptapNode.create({
  name: "doc",
  topNode: true,
  content: "frontmatter? block+",
});

/** key: value lines, for the summary row. Anything else is left out. */
export function frontmatterEntries(text: string) {
  const entries: [string, string][] = [];
  for (const line of text.split("\n")) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (match) entries.push([match[1], match[2]]);
  }
  return entries;
}

function FrontmatterView({ node, deleteNode }: NodeViewProps) {
  const entries = frontmatterEntries(node.textContent);
  return (
    <NodeViewWrapper className="doc-frontmatter" data-frontmatter="">
      <div className="doc-frontmatter-head" contentEditable={false}>
        <Tags className="size-3.5" aria-hidden />
        <span>Properties</span>
        <span className="doc-frontmatter-summary">
          {entries.map(([key, value]) => (
            <span key={key} className="doc-frontmatter-chip">
              <b>{key}</b> {value}
            </span>
          ))}
        </span>
        <button type="button" className="doc-frontmatter-remove" onClick={deleteNode} title="Remove properties">
          Remove
        </button>
      </div>
      <pre className="doc-frontmatter-source" spellCheck={false}>
        <NodeViewContent />
      </pre>
    </NodeViewWrapper>
  );
}

export const Frontmatter = TiptapNode.create({
  name: "frontmatter",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: "div[data-frontmatter]", preserveWhitespace: "full" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-frontmatter": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FrontmatterView);
  },

  addCommands() {
    return {
      editFrontmatter:
        () =>
        ({ state, tr, dispatch }) => {
          const first = state.doc.firstChild;
          if (dispatch) {
            if (first?.type.name === this.name) {
              tr.setSelection(TextSelection.create(tr.doc, first.nodeSize - 1));
            } else {
              const text = state.schema.text("title: ");
              tr.insert(0, this.type.create(null, text));
              tr.setSelection(TextSelection.create(tr.doc, text.nodeSize + 1));
            }
            tr.scrollIntoView();
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Mod-Enter leaves the block for the first body paragraph.
      "Mod-Enter": () => {
        if (!this.editor.isActive(this.name)) return false;
        const first = this.editor.state.doc.firstChild;
        if (!first) return false;
        return this.editor.commands.focus(first.nodeSize + 1);
      },
    };
  },
});
