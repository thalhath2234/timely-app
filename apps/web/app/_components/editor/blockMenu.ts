import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  Code2,
  Copy,
  CopyPlus,
  Heading1,
  Heading2,
  Heading3,
  Info,
  List,
  ListCollapse,
  ListOrdered,
  Repeat2,
  Trash2,
  Type,
} from "lucide-react";
import { openContextMenu, tidyEntries, type ContextMenuEntry } from "@/app/_store/contextMenuStore";

/**
 * The menu behind the block grip (blockHandle.ts): turn the block into
 * another kind, duplicate, move, copy or delete it.
 */

const NAMES: Record<string, string> = {
  paragraph: "Text",
  bulletList: "Bulleted list",
  orderedList: "Numbered list",
  taskList: "To-do list",
  listItem: "List item",
  taskItem: "To-do",
  codeBlock: "Code",
  blockquote: "Quote",
  callout: "Callout",
  details: "Toggle",
  columns: "Columns",
  table: "Table",
  image: "Image",
  horizontalRule: "Divider",
  embed: "Embed",
  bookmark: "Bookmark",
  footnote: "Footnote",
  mathBlock: "Equation",
};

function blockName(node: PMNode) {
  if (node.type.name === "heading") return `Heading ${node.attrs.level}`;
  return NAMES[node.type.name] ?? "Block";
}

/** Runs `run` with the caret in the block at `pos`, the way the slash menu does. */
function turnInto(editor: Editor, pos: number, node: PMNode, run: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) {
  const chain = editor.chain().focus().setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 });
  // Lists and wrappers start from a plain paragraph, so a heading becomes a list of text.
  run(node.type.name === "paragraph" ? chain : chain.setNode("paragraph")).run();
}

function move(editor: Editor, pos: number, node: PMNode, direction: -1 | 1) {
  const { state, view } = editor;
  const $pos = state.doc.resolve(pos);
  const index = $pos.index();
  const sibling = $pos.parent.child(index + direction);
  const tr = state.tr.delete(pos, pos + node.nodeSize);
  const target = direction < 0 ? pos - sibling.nodeSize : pos + sibling.nodeSize;
  tr.insert(target, node);
  tr.setSelection(NodeSelection.create(tr.doc, target));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

function select(editor: Editor, pos: number) {
  const { view } = editor;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  view.focus();
}

export function openBlockMenu(editor: Editor, pos: number, x: number, y: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const $pos = editor.state.doc.resolve(pos);
  const index = $pos.index();
  const previous = index > 0 ? $pos.parent.child(index - 1) : null;
  const canMoveUp = Boolean(previous) && previous!.type.name !== "frontmatter";
  const canMoveDown = index < $pos.parent.childCount - 1;
  const name = node.type.name;
  const textual = name === "paragraph" || name === "heading";
  const level = name === "heading" ? node.attrs.level : 0;
  const run = (fn: () => void) => () => {
    if (editor.state.doc.nodeAt(pos) === node) fn();
  };

  const turnIntoItems: ContextMenuEntry[] = [
    { kind: "action", label: "Text", icon: Type, checked: name === "paragraph", onSelect: run(() => turnInto(editor, pos, node, (c) => c)) },
    ...([1, 2, 3] as const).map(
      (l): ContextMenuEntry => ({
        kind: "action",
        label: `Heading ${l}`,
        icon: [Heading1, Heading2, Heading3][l - 1],
        checked: level === l,
        onSelect: run(() => turnInto(editor, pos, node, (c) => c.setNode("heading", { level: l }))),
      }),
    ),
    { kind: "action", label: "Bulleted list", icon: List, onSelect: run(() => turnInto(editor, pos, node, (c) => c.toggleBulletList())) },
    { kind: "action", label: "Numbered list", icon: ListOrdered, onSelect: run(() => turnInto(editor, pos, node, (c) => c.toggleOrderedList())) },
    { kind: "action", label: "To-do list", icon: CheckSquare, onSelect: run(() => turnInto(editor, pos, node, (c) => c.toggleTaskList())) },
    { kind: "action", label: "Toggle", icon: ListCollapse, onSelect: run(() => turnInto(editor, pos, node, (c) => c.toggleDetails())) },
    { kind: "action", label: "Callout", icon: Info, onSelect: run(() => turnInto(editor, pos, node, (c) => c.setCallout({ kind: "note" }))) },
    { kind: "action", label: "Code block", icon: Code2, onSelect: run(() => turnInto(editor, pos, node, (c) => c.setCodeBlock())) },
  ];

  openContextMenu({
    x,
    y,
    title: blockName(node),
    items: tidyEntries([
      textual && { kind: "submenu", label: "Turn into", icon: Repeat2, items: turnIntoItems },
      textual && { kind: "separator" },
      {
        kind: "action",
        label: "Duplicate",
        icon: CopyPlus,
        onSelect: run(() => {
          const after = pos + node.nodeSize;
          const tr = editor.state.tr.insert(after, node.copy(node.content));
          tr.setSelection(NodeSelection.create(tr.doc, after));
          editor.view.dispatch(tr.scrollIntoView());
          editor.view.focus();
        }),
      },
      {
        kind: "action",
        label: "Copy",
        icon: Copy,
        shortcut: "mod+C",
        onSelect: run(() => {
          // A copy of the selected node keeps its formatting on paste, here or elsewhere.
          select(editor, pos);
          document.execCommand("copy");
        }),
      },
      { kind: "separator" },
      { kind: "action", label: "Move up", icon: ArrowUp, disabled: !canMoveUp, onSelect: run(() => move(editor, pos, node, -1)) },
      { kind: "action", label: "Move down", icon: ArrowDown, disabled: !canMoveDown, onSelect: run(() => move(editor, pos, node, 1)) },
      { kind: "separator" },
      {
        kind: "action",
        label: "Delete",
        icon: Trash2,
        shortcut: "delete",
        danger: true,
        onSelect: run(() => {
          // Through the selection, so an emptied column or list keeps valid content.
          select(editor, pos);
          editor.commands.deleteSelection();
        }),
      },
    ]),
  });
}
