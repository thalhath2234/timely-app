import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

/**
 * Columns: blocks side by side, in equal widths. Stored as `columns` holding
 * two or more `column`s of blocks; Markdown marks them with comments (see
 * apps/api/internal/richtext/columns.go).
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columns: {
      /** Puts the caret's block in the first of `count` columns, or, inside
       * columns, puts their blocks back one after another. */
      toggleColumns: (count?: number) => ReturnType;
      /** Adds an empty column after the caret's column. */
      addColumn: () => ReturnType;
    };
  }
}

const MAX_COLUMNS = 4;

function findColumns(state: { selection: { $from: { depth: number; node: (d: number) => PMNode; before: (d: number) => number } } }) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "columns") return { node, pos: $from.before(depth), depth };
  }
  return null;
}

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column": "", class: "doc-column" }), 0];
  },
});

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,4}",
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-columns": "", class: "doc-columns" }), 0];
  },

  addCommands() {
    return {
      toggleColumns:
        (count = 2) =>
        ({ state, tr, dispatch }) => {
          const { schema } = state;
          const found = findColumns(state);
          if (found) {
            // Unwrap: every column's blocks, in order.
            const blocks: PMNode[] = [];
            found.node.forEach((column) => column.forEach((block) => blocks.push(block)));
            if (dispatch) {
              tr.replaceWith(found.pos, found.pos + found.node.nodeSize, blocks);
              tr.setSelection(TextSelection.near(tr.doc.resolve(found.pos + 1)));
              dispatch(tr.scrollIntoView());
            }
            return true;
          }
          const { $from } = state.selection;
          if ($from.depth < 1) return false;
          // The top-level block the caret is in moves into the first column.
          const start = $from.before(1);
          const block = state.doc.child($from.index(0));
          if (block.type.name === "frontmatter" || block.type.name === "footnote") return false;
          const columns = [schema.nodes.column.create(null, block)];
          for (let i = 1; i < Math.min(Math.max(count, 2), MAX_COLUMNS); i += 1) {
            columns.push(schema.nodes.column.create(null, schema.nodes.paragraph.create()));
          }
          const node = schema.nodes.columns.create(null, columns);
          if (dispatch) {
            tr.replaceWith(start, start + block.nodeSize, node);
            // Into the second column, ready to write beside the block.
            const second = start + 1 + columns[0].nodeSize;
            tr.setSelection(TextSelection.near(tr.doc.resolve(second + 1)));
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
      addColumn:
        () =>
        ({ state, tr, dispatch }) => {
          const found = findColumns(state);
          if (!found || found.node.childCount >= MAX_COLUMNS) return false;
          const { $from } = state.selection;
          const after = $from.after(found.depth + 1);
          if (dispatch) {
            tr.insert(after, state.schema.nodes.column.create(null, state.schema.nodes.paragraph.create()));
            tr.setSelection(TextSelection.near(tr.doc.resolve(after + 2)));
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Backspace in an empty column that is not the only text removes it;
      // with two columns left, the columns go and their blocks stay.
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parentOffset > 0) return false;
        const found = findColumns(state);
        if (!found) return false;
        const column = $from.node(found.depth + 1);
        if (column.childCount !== 1 || column.firstChild!.content.size > 0) return false;
        if (found.node.childCount <= 2) return editor.commands.toggleColumns();
        const columnPos = $from.before(found.depth + 1);
        const tr = state.tr.delete(columnPos, columnPos + column.nodeSize);
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(columnPos - 1, 0)), -1));
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});
