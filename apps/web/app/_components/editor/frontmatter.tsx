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
import { frontmatterEntries } from "@timely/contract/properties";
import { useEffect, useState } from "react";

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

function FrontmatterView({ node, editor, getPos, deleteNode }: NodeViewProps) {
  const entries = frontmatterEntries(node.textContent);
  // The YAML shows only while the caret is in it; otherwise just the values.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const check = () => {
      const pos = getPos();
      if (typeof pos !== "number") return;
      const { from, to } = editor.state.selection;
      const end = pos + editor.state.doc.nodeAt(pos)!.nodeSize;
      setEditing(editor.isFocused && from > pos && to < end);
    };
    check();
    const events = ["selectionUpdate", "update", "focus", "blur"] as const;
    events.forEach((name) => editor.on(name, check));
    return () => events.forEach((name) => editor.off(name, check));
  }, [editor, getPos]);

  const edit = () => {
    const pos = getPos();
    if (typeof pos === "number") editor.chain().focus(pos + node.nodeSize - 1).scrollIntoView().run();
  };
  const done = () => {
    const pos = getPos();
    if (typeof pos === "number") editor.chain().focus(pos + node.nodeSize + 1).run();
  };

  return (
    <NodeViewWrapper className={`doc-frontmatter${editing ? " is-editing" : ""}`} data-frontmatter="">
      <div className="doc-frontmatter-head" contentEditable={false}>
        <Tags className="size-3.5" aria-hidden />
        <span className="flex-1">Properties</span>
        <button
          type="button"
          className="doc-frontmatter-action"
          onMouseDown={(event) => event.preventDefault()}
          onClick={editing ? done : edit}
          title={editing ? "Finish editing properties" : "Edit properties"}
        >
          {editing ? "Done" : "Edit"}
        </button>
        <button
          type="button"
          className="doc-frontmatter-action"
          onMouseDown={(event) => event.preventDefault()}
          onClick={deleteNode}
          title="Remove properties"
        >
          Remove
        </button>
      </div>
      {!editing && (
        <div className="doc-frontmatter-list" contentEditable={false} onDoubleClick={edit}>
          {entries.length === 0 ? (
            <button type="button" className="doc-frontmatter-empty" onClick={edit}>
              No properties yet. Add some as key: value lines.
            </button>
          ) : (
            entries.map(({ key, values }, index) => (
              <div key={`${key}-${index}`} className="doc-frontmatter-row">
                <span className="doc-frontmatter-key">{key}</span>
                <span className="doc-frontmatter-values">
                  {values.length === 0 ? (
                    <span className="doc-frontmatter-none">Empty</span>
                  ) : (
                    values.map((value, i) => (
                      <span key={i} className="doc-frontmatter-chip">
                        {value}
                      </span>
                    ))
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      )}
      <pre className="doc-frontmatter-source" spellCheck={false} hidden={!editing}>
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
