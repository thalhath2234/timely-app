import { Extension, type Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { openBlockMenu } from "./blockMenu";

/**
 * Block selection: one or more whole blocks, side by side in the same parent,
 * shown with a blue tint (Notion's block selection). Dragging a box from the
 * page margin selects every block it touches, like selecting files on a
 * desktop; the block grip selects its block. With blocks selected, Delete
 * removes them, Ctrl/Cmd+C or X copy or cut them, Ctrl/Cmd+D duplicates them,
 * Esc clears, and a right-click on one opens the block menu for all of them.
 */

export type BlockRange = { from: number; to: number };

export const blockSelectionKey = new PluginKey<BlockRange | null>("blockSelection");

export function getBlockRange(state: EditorState) {
  return blockSelectionKey.getState(state) ?? null;
}

/** Selects the blocks in `range` (null clears), keeping the caret out of sight in the first one. */
export function setBlockRange(view: EditorView, range: BlockRange | null) {
  const tr = view.state.tr.setMeta(blockSelectionKey, range);
  if (range) tr.setSelection(TextSelection.near(tr.doc.resolve(range.from)));
  view.dispatch(tr);
}

/** The blocks in the range, with their positions. */
export function rangeBlocks(state: EditorState, range: BlockRange) {
  const $from = state.doc.resolve(range.from);
  const start = $from.start();
  const blocks: { pos: number; node: import("@tiptap/pm/model").Node }[] = [];
  $from.parent.forEach((node, offset) => {
    const pos = start + offset;
    if (pos >= range.from && pos + node.nodeSize <= range.to) blocks.push({ pos, node });
  });
  return blocks;
}

/** Removes the blocks; an emptied list or column goes too, or keeps an empty line. */
export function deleteBlocks(view: EditorView, range: BlockRange) {
  view.dispatch(view.state.tr.setMeta(blockSelectionKey, null).deleteRange(range.from, range.to).scrollIntoView());
}

/** Puts a copy of the blocks after them and selects the copy. */
export function duplicateBlocks(view: EditorView, range: BlockRange) {
  const slice = view.state.doc.slice(range.from, range.to);
  const tr = view.state.tr.insert(range.to, slice.content);
  const copy = { from: range.to, to: range.to + slice.content.size };
  view.dispatch(tr.setMeta(blockSelectionKey, copy).setSelection(TextSelection.near(tr.doc.resolve(copy.from))).scrollIntoView());
}

/** Swaps the blocks with the sibling above (-1) or below (1); false when there is none. */
export function moveBlocks(view: EditorView, range: BlockRange, direction: -1 | 1, dispatch = true) {
  const { doc } = view.state;
  const $from = doc.resolve(range.from);
  const $to = doc.resolve(range.to);
  const index = direction < 0 ? $from.index() - 1 : $to.index();
  if (index < 0 || index >= $from.parent.childCount) return false;
  const sibling = $from.parent.child(index);
  // Properties stay first.
  if (sibling.type.name === "frontmatter") return false;
  if (!dispatch) return true;
  const tr = view.state.tr;
  let moved: BlockRange;
  if (direction < 0) {
    const siblingPos = range.from - sibling.nodeSize;
    tr.delete(siblingPos, range.from).insert(range.to - sibling.nodeSize, sibling);
    moved = { from: siblingPos, to: range.to - sibling.nodeSize };
  } else {
    tr.delete(range.to, range.to + sibling.nodeSize).insert(range.from, sibling);
    moved = { from: range.from + sibling.nodeSize, to: range.to + sibling.nodeSize };
  }
  view.dispatch(tr.setMeta(blockSelectionKey, moved).setSelection(TextSelection.near(tr.doc.resolve(moved.from))).scrollIntoView());
  return true;
}

function copyBlocks(view: EditorView, range: BlockRange, event: ClipboardEvent) {
  if (!event.clipboardData) return false;
  const { dom, text } = view.serializeForClipboard(view.state.doc.slice(range.from, range.to));
  event.preventDefault();
  event.clipboardData.clearData();
  event.clipboardData.setData("text/html", dom.innerHTML);
  event.clipboardData.setData("text/plain", text);
  return true;
}

function scrollParent(element: HTMLElement | null) {
  for (let node = element; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement as HTMLElement;
}

/** Where a box may start: the page around the doc, not text or controls. */
const NO_BOX = "button, a, input, textarea, select, label, header, [contenteditable], [role=menu], [role=dialog], [data-no-block-box]";

export const BlockSelection = Extension.create({
  name: "blockSelection",

  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    return [
      new Plugin<BlockRange | null>({
        key: blockSelectionKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(blockSelectionKey) as BlockRange | null | undefined;
            if (meta !== undefined) return meta;
            if (!value || !tr.docChanged) return value;
            const from = tr.mapping.map(value.from, 1);
            const to = tr.mapping.map(value.to, -1);
            return to > from ? { from, to } : null;
          },
        },
        props: {
          decorations(state) {
            const range = getBlockRange(state);
            if (!range) return null;
            return DecorationSet.create(
              state.doc,
              rangeBlocks(state, range).map(({ pos, node }) => Decoration.node(pos, pos + node.nodeSize, { class: "doc-block-selected" })),
            );
          },
          attributes(state): Record<string, string> {
            return getBlockRange(state) ? { class: "has-block-selection" } : {};
          },
          handleKeyDown(view, event) {
            const range = getBlockRange(view.state);
            if (!range) return false;
            const mod = event.metaKey || event.ctrlKey;
            if (event.key === "Escape") {
              setBlockRange(view, null);
              return true;
            }
            if (event.key === "Backspace" || event.key === "Delete") {
              deleteBlocks(view, range);
              return true;
            }
            if (mod && event.key.toLowerCase() === "d") {
              duplicateBlocks(view, range);
              return true;
            }
            // Copy, cut, undo and the like go on as usual.
            if (mod || event.altKey || ["Shift", "Control", "Meta", "Alt"].includes(event.key)) return false;
            setBlockRange(view, null);
            // Arrows move the caret from the first block; typing doesn't replace blocks.
            return !event.key.startsWith("Arrow");
          },
          handleDOMEvents: {
            mousedown(view, event) {
              if (event.button === 0 && getBlockRange(view.state)) setBlockRange(view, null);
              return false;
            },
            copy(view, event) {
              const range = getBlockRange(view.state);
              return range ? copyBlocks(view, range, event) : false;
            },
            cut(view, event) {
              const range = getBlockRange(view.state);
              if (!range || !copyBlocks(view, range, event)) return false;
              deleteBlocks(view, range);
              return true;
            },
            contextmenu(view, event) {
              const target = event.target instanceof Element ? event.target : null;
              if (!target || !editor.isEditable) return false;
              const range = getBlockRange(view.state);
              if (range) {
                const inside = rangeBlocks(view.state, range).some(({ pos }) => {
                  const dom = view.nodeDOM(pos);
                  return dom instanceof Element && dom.contains(target);
                });
                if (inside) {
                  event.preventDefault();
                  // An open menu's own listener would take this right-click as a dismissal.
                  event.stopPropagation();
                  openBlockMenu(editor, range, event.clientX, event.clientY);
                  return true;
                }
              }
              // An image gets the menu of its line, which offers Download.
              const image = target.closest("img:not(.ProseMirror-separator)");
              if (image && view.dom.contains(image)) {
                const $pos = view.state.doc.resolve(view.posAtDOM(image, 0));
                if ($pos.depth < 1) return false;
                const line = { from: $pos.before(), to: $pos.after() };
                event.preventDefault();
                event.stopPropagation();
                setBlockRange(view, line);
                openBlockMenu(editor, line, event.clientX, event.clientY);
                return true;
              }
              return false;
            },
          },
        },

        view(view) {
          const root = (view.dom.closest("[data-block-select-root]") as HTMLElement | null) ?? view.dom.parentElement;
          let box: HTMLDivElement | null = null;
          let start: { x: number; y: number; scroll: number } | null = null;
          let pointer = { x: 0, y: 0 };
          let scroller: HTMLElement | null = null;
          let frame = 0;

          const select = () => {
            if (!start || !scroller) return;
            const scrolled = scroller.scrollTop - start.scroll;
            const left = Math.min(start.x, pointer.x);
            const right = Math.max(start.x, pointer.x);
            const top = Math.min(start.y - scrolled, pointer.y);
            const bottom = Math.max(start.y - scrolled, pointer.y);
            if (box) Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
            let first = -1;
            let firstPos = 0;
            let lastEnd = 0;
            view.state.doc.forEach((node, offset) => {
              if (node.type.name === "frontmatter") return;
              const dom = view.nodeDOM(offset);
              if (!(dom instanceof HTMLElement)) return;
              const rect = dom.getBoundingClientRect();
              if (rect.bottom < top || rect.top > bottom || rect.right < left || rect.left > right) return;
              if (first < 0) {
                first = offset;
                firstPos = offset;
              }
              lastEnd = offset + node.nodeSize;
            });
            const current = getBlockRange(view.state);
            const next = first < 0 ? null : { from: firstPos, to: lastEnd };
            if (current?.from !== next?.from || current?.to !== next?.to) setBlockRange(view, next);
          };

          // Near the top or bottom edge, the page scrolls under the box.
          const autoScroll = () => {
            frame = 0;
            if (!start || !scroller) return;
            const rect = scroller.getBoundingClientRect();
            const edge = 48;
            const delta = pointer.y < rect.top + edge ? -(rect.top + edge - pointer.y) / 3 : pointer.y > rect.bottom - edge ? (pointer.y - rect.bottom + edge) / 3 : 0;
            if (delta) {
              scroller.scrollTop += delta;
              select();
              frame = requestAnimationFrame(autoScroll);
            }
          };

          const onMove = (event: MouseEvent) => {
            if (!start) return;
            pointer = { x: event.clientX, y: event.clientY };
            if (!box) {
              if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
              box = document.createElement("div");
              box.className = "doc-block-box";
              document.body.appendChild(box);
            }
            event.preventDefault();
            select();
            if (!frame) frame = requestAnimationFrame(autoScroll);
          };

          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            cancelAnimationFrame(frame);
            frame = 0;
            const dragged = Boolean(box);
            box?.remove();
            box = null;
            start = null;
            if (!dragged) {
              // A plain click on the margin clears the selection.
              if (getBlockRange(view.state)) setBlockRange(view, null);
            } else if (getBlockRange(view.state)) {
              view.focus();
            }
          };

          const onDown = (event: MouseEvent) => {
            if (event.button !== 0 || !editor.isEditable || !root) return;
            const target = event.target instanceof Element ? event.target : null;
            if (!target || !root.contains(target) || view.dom.contains(target) || target.closest(NO_BOX)) return;
            // No text selection starts from the margin.
            event.preventDefault();
            scroller = scrollParent(view.dom);
            start = { x: event.clientX, y: event.clientY, scroll: scroller.scrollTop };
            pointer = { x: event.clientX, y: event.clientY };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          };

          root?.addEventListener("mousedown", onDown);
          return {
            destroy() {
              root?.removeEventListener("mousedown", onDown);
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
              cancelAnimationFrame(frame);
              box?.remove();
            },
          };
        },
      }),
    ];
  },
});
