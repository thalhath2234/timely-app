import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  Code2,
  Copy,
  CopyPlus,
  Download,
  FileInput,
  FileOutput,
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
import { useToastStore } from "@/app/_store/toastStore";
import { imageSrc } from "./docImage";
import { openBlockTransfer } from "./blockTransfer";
import { deleteBlocks, duplicateBlocks, moveBlocks, rangeBlocks, setBlockRange, type BlockRange } from "./blockSelection";

/**
 * The menu for selected blocks, from the block grip or a right-click: turn
 * them into another kind, duplicate, copy, copy or move to another page,
 * move up or down, download images, or delete.
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
  if (node.type.name === "paragraph" && node.childCount > 0 && !node.textContent.trim() && imagesIn([node]).length > 0) return "Image";
  return NAMES[node.type.name] ?? "Block";
}

function imagesIn(nodes: PMNode[]) {
  const images: { src: string; alt: string }[] = [];
  for (const node of nodes) {
    node.descendants((child) => {
      if (child.type.name === "image" && child.attrs.src) images.push({ src: child.attrs.src, alt: child.attrs.alt ?? "" });
    });
    if (node.type.name === "image" && node.attrs.src) images.push({ src: node.attrs.src, alt: node.attrs.alt ?? "" });
  }
  return images;
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };

/** Saves each image as a file (the browser's downloads, or a save dialog on desktop). */
export async function downloadImages(images: { src: string; alt: string }[]) {
  for (const [index, image] of images.entries()) {
    try {
      const response = await fetch(imageSrc(image.src));
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const base = (image.alt || "image").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 100) || "image";
      const ext = EXTENSIONS[blob.type] ?? image.src.match(/\.(\w{3,4})(?:$|\?)/)?.[1] ?? "png";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${base}${images.length > 1 ? ` ${index + 1}` : ""}.${ext}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Another site's image may refuse to be fetched; open it to save from there.
      if (/^https?:/.test(image.src)) window.open(image.src, "_blank", "noopener,noreferrer");
      else useToastStore.getState().show("Could not download the image");
    }
  }
}

type Chain = ReturnType<Editor["chain"]>;

/** Runs `run` over the blocks' text, the way the slash menu does for one. */
function turnInto(editor: Editor, range: BlockRange, plain: boolean, run: (chain: Chain) => Chain) {
  setBlockRange(editor.view, null);
  const chain = editor.chain().focus().setTextSelection({ from: range.from + 1, to: range.to - 1 });
  // Lists and wrappers start from plain paragraphs, so headings become list text.
  run(plain ? chain : chain.setNode("paragraph")).run();
}

export function openBlockMenu(editor: Editor, range: BlockRange, x: number, y: number) {
  const { state, view } = editor;
  const blocks = rangeBlocks(state, range);
  if (blocks.length === 0) return;
  const nodes = blocks.map((block) => block.node);
  const single = nodes.length === 1 ? nodes[0] : null;
  const snapshot = state.doc.slice(range.from, range.to);
  // Each action checks the blocks are still where the menu found them.
  const run = (fn: () => void) => () => {
    const { doc } = editor.state;
    if (range.to <= doc.content.size && doc.slice(range.from, range.to).eq(snapshot)) fn();
  };

  const textual = nodes.every((node) => node.type.name === "paragraph" || node.type.name === "heading") && imagesIn(nodes).length === 0;
  const plain = nodes.every((node) => node.type.name === "paragraph");
  const levels = new Set(nodes.map((node) => (node.type.name === "heading" ? node.attrs.level : 0)));
  const level = levels.size === 1 ? [...levels][0] : -1;
  const turn = (fn: (chain: Chain) => Chain) => run(() => turnInto(editor, range, plain, fn));

  const turnIntoItems: ContextMenuEntry[] = tidyEntries([
    { kind: "action", label: "Text", icon: Type, checked: level === 0, onSelect: turn((c) => c) },
    ...([1, 2, 3] as const).map(
      (l): ContextMenuEntry => ({
        kind: "action",
        label: `Heading ${l}`,
        icon: [Heading1, Heading2, Heading3][l - 1],
        checked: level === l,
        onSelect: turn((c) => c.setNode("heading", { level: l })),
      }),
    ),
    { kind: "action", label: "Bulleted list", icon: List, onSelect: turn((c) => c.toggleBulletList()) },
    { kind: "action", label: "Numbered list", icon: ListOrdered, onSelect: turn((c) => c.toggleOrderedList()) },
    { kind: "action", label: "To-do list", icon: CheckSquare, onSelect: turn((c) => c.toggleTaskList()) },
    // A toggle's title is one line.
    single && { kind: "action", label: "Toggle", icon: ListCollapse, onSelect: turn((c) => c.toggleDetails()) },
    { kind: "action", label: "Callout", icon: Info, onSelect: turn((c) => c.setCallout({ kind: "note" })) },
    { kind: "action", label: "Code block", icon: Code2, onSelect: turn((c) => c.setCodeBlock()) },
  ]);

  const images = imagesIn(nodes);
  const topLevel = state.doc.resolve(range.from).depth === 0;

  openContextMenu({
    x,
    y,
    title: single ? blockName(single) : `${nodes.length} blocks`,
    items: tidyEntries([
      textual && { kind: "submenu", label: "Turn into", icon: Repeat2, items: turnIntoItems },
      images.length > 0 && {
        kind: "action",
        label: images.length === 1 ? "Download image" : `Download ${images.length} images`,
        icon: Download,
        onSelect: () => void downloadImages(images),
      },
      { kind: "separator" },
      { kind: "action", label: "Duplicate", icon: CopyPlus, shortcut: "mod+D", onSelect: run(() => duplicateBlocks(view, range)) },
      {
        kind: "action",
        label: "Copy",
        icon: Copy,
        shortcut: "mod+C",
        onSelect: run(() => {
          // The editor's copy handler puts the blocks on the clipboard with their formatting.
          setBlockRange(view, range);
          view.focus();
          document.execCommand("copy");
        }),
      },
      topLevel && { kind: "action", label: "Copy to page…", icon: FileOutput, onSelect: run(() => openBlockTransfer(editor, range, "copy")) },
      topLevel && { kind: "action", label: "Move to page…", icon: FileInput, onSelect: run(() => openBlockTransfer(editor, range, "move")) },
      { kind: "separator" },
      { kind: "action", label: "Move up", icon: ArrowUp, disabled: !moveBlocks(view, range, -1, false), onSelect: run(() => moveBlocks(view, range, -1)) },
      { kind: "action", label: "Move down", icon: ArrowDown, disabled: !moveBlocks(view, range, 1, false), onSelect: run(() => moveBlocks(view, range, 1)) },
      { kind: "separator" },
      {
        kind: "action",
        label: "Delete",
        icon: Trash2,
        shortcut: "delete",
        danger: true,
        onSelect: run(() => {
          deleteBlocks(view, range);
          view.focus();
        }),
      },
    ]),
  });
}
