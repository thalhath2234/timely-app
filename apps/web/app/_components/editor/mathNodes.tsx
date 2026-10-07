"use client";

import {
  InputRule,
  Node as TiptapNode,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { useMemo, useState } from "react";
import { renderTex } from "./katex";

/*
 * Math as Markdown writes it: $x^2$ inline and a $$ block, kept as TeX
 * source so the exported file is exactly what was typed.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    math: {
      /** Inserts an inline formula at the selection and opens it for editing. */
      insertMathInline: (latex?: string) => ReturnType;
      /** Turns the current block into a formula block. */
      setMathBlock: () => ReturnType;
    };
  }
}

function MathInlineView({ node, updateAttributes, editor, getPos, deleteNode }: NodeViewProps) {
  const latex = String(node.attrs.latex ?? "");
  const [draft, setDraft] = useState<string | null>(latex ? null : "");
  const html = useMemo(() => (latex ? renderTex(latex, false) : ""), [latex]);

  const commit = () => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (!next) {
      deleteNode();
      editor.commands.focus();
      return;
    }
    if (next !== latex) updateAttributes({ latex: next });
    const pos = getPos();
    if (typeof pos === "number") editor.commands.focus(pos + 1);
  };

  return (
    <NodeViewWrapper as="span" className="doc-math-inline" data-math-inline="">
      {html ? (
        <span
          className="doc-math-inline-render"
          role="button"
          title="Edit formula"
          onClick={() => setDraft(latex)}
          // KaTeX output for the stored TeX; trust is off so it holds no scripts.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <span className="doc-math-inline-render doc-math-empty" onClick={() => setDraft(latex)}>
          formula
        </span>
      )}
      {draft !== null && (
        <span className="doc-math-editor" contentEditable={false}>
          <input
            autoFocus
            value={draft}
            placeholder="TeX, e.g. E = mc^2"
            aria-label="Formula source"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setDraft(null);
                if (!latex) deleteNode();
                editor.commands.focus();
              }
            }}
          />
        </span>
      )}
    </NodeViewWrapper>
  );
}

export const MathInline = TiptapNode.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-latex") ?? element.textContent ?? "",
        renderHTML: (attributes) => ({ "data-latex": attributes.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-math-inline]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-math-inline": "" }), `$${node.attrs.latex}$`];
  },

  renderText({ node }) {
    return String(node.attrs.latex ?? "");
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathInlineView);
  },

  addCommands() {
    return {
      insertMathInline:
        (latex = "") =>
        ({ chain }) =>
          chain().insertContent({ type: this.name, attrs: { latex } }).run(),
    };
  },

  addInputRules() {
    // Typing $x^2$ turns into a formula. The closing dollar must follow a
    // non-space, so "$5 and $10" stays text.
    return [
      new InputRule({
        find: /\$([^\s$][^$\n]*?[^\s$\\]|[^\s$])\$$/,
        handler: ({ state, range, match }) => {
          const node = state.schema.nodes.mathInline.create({ latex: match[1] });
          state.tr.replaceWith(range.from, range.to, node);
        },
      }),
    ];
  },
});

function MathBlockView({ node }: NodeViewProps) {
  const source = node.textContent.trim();
  const html = useMemo(() => (source ? renderTex(source, true) : ""), [source]);
  return (
    <NodeViewWrapper className="doc-math-block" data-math-block="">
      <pre className="doc-math-source" spellCheck={false}>
        <NodeViewContent />
      </pre>
      <div className="doc-math-preview" contentEditable={false}>
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span className="doc-math-empty">Type TeX above, for example: \int_0^1 x^2 \, dx</span>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const MathBlock = TiptapNode.create({
  name: "mathBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-math-block]", preserveWhitespace: "full" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-math-block": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView);
  },

  addCommands() {
    return {
      setMathBlock:
        () =>
        ({ commands }) =>
          commands.setNode(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      // Enter adds a line; Mod-Enter leaves the block.
      "Mod-Enter": () => {
        if (!this.editor.isActive(this.name)) return false;
        return this.editor.commands.command(({ tr, state, dispatch }) => {
          const { $from } = state.selection;
          const after = $from.after();
          if (dispatch) {
            const paragraph = state.schema.nodes.paragraph.create();
            tr.insert(after, paragraph);
            tr.setSelection(TextSelection.create(tr.doc, after + 1));
            tr.scrollIntoView();
          }
          return true;
        });
      },
      Backspace: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty || $from.parent.type.name !== this.name || $from.parent.textContent) return false;
        return this.editor.commands.clearNodes();
      },
    };
  },
});
