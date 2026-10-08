import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { openBlockMenu } from "./blockMenu";

/**
 * Block drag handle (Notion's ⋮⋮): hovering a block shows a grip in the left
 * gutter. Dragging it moves the block (ProseMirror's own drop code does the
 * move, from `view.dragging`); clicking it selects the block and opens its
 * menu (blockMenu.ts). List and task items and blocks in a column get their
 * own handle; anything else moves with its top-level block. Properties have
 * none: they can only be the doc's first block.
 */

const ITEM_TYPES = new Set(["listItem", "taskItem"]);
const FIXED_TYPES = new Set(["frontmatter"]);
const GRIP =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

/** The block under the pointer: the innermost list item, else the top-level block. */
function blockAt(view: EditorView, x: number, y: number) {
  const box = view.dom.getBoundingClientRect();
  const hit = view.posAtCoords({ left: Math.min(Math.max(x, box.left + 1), box.right - 1), top: y });
  if (!hit) return null;
  const $pos = view.state.doc.resolve(hit.inside >= 0 ? hit.inside : hit.pos);
  let depth = 0;
  for (let d = $pos.depth; d > 0; d -= 1) {
    const name = $pos.node(d).type.name;
    if (ITEM_TYPES.has(name)) {
      depth = d;
      break;
    }
    // A block in a column moves on its own, so it can go to another column.
    if (name === "column" && d < $pos.depth) {
      depth = d + 1;
      break;
    }
  }
  if (!depth) {
    // posAtCoords on an atom block (image, diagram) points at it, not into it.
    if ($pos.depth === 0) {
      const node = $pos.nodeAfter;
      if (!node || FIXED_TYPES.has(node.type.name)) return null;
      return { pos: $pos.pos, node };
    }
    depth = 1;
  }
  const pos = $pos.before(depth);
  const node = view.state.doc.nodeAt(pos);
  return node && !FIXED_TYPES.has(node.type.name) ? { pos, node } : null;
}

export const BlockHandle = Extension.create({
  name: "blockHandle",

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("blockHandle"),
        props: {
          // Properties fit nowhere but the top, so a drop elsewhere would spill
          // their YAML into the doc as text.
          handleDrop(view) {
            let fixed = false;
            view.dragging?.slice.content.descendants((node) => {
              if (FIXED_TYPES.has(node.type.name)) fixed = true;
              return !fixed;
            });
            return fixed;
          },
        },
        view(view) {
          const handle = document.createElement("button");
          handle.type = "button";
          handle.className = "doc-block-handle";
          handle.draggable = true;
          handle.contentEditable = "false";
          handle.setAttribute("aria-label", "Drag to move, click for options");
          handle.setAttribute("aria-haspopup", "menu");
          handle.title = "Drag to move\nClick for options";
          handle.innerHTML = GRIP;
          const host = view.dom.parentElement;
          host?.classList.add("doc-block-handle-host");
          host?.appendChild(handle);

          let current: { pos: number } | null = null;
          let hideTimer: ReturnType<typeof setTimeout> | undefined;

          const hide = () => {
            handle.removeAttribute("data-visible");
            current = null;
          };
          const show = (x: number, y: number) => {
            if (!editor.isEditable || !host || view.dragging) return;
            const found = blockAt(view, x, y);
            if (!found) return hide();
            const dom = view.nodeDOM(found.pos);
            if (!(dom instanceof HTMLElement)) return hide();
            const rect = dom.getBoundingClientRect();
            const hostRect = host.getBoundingClientRect();
            // Line the grip up with the block's first line.
            const style = getComputedStyle(dom);
            const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 24;
            const top = rect.top - hostRect.top + host.scrollTop + parseFloat(style.paddingTop || "0") + Math.max(0, (Math.min(line, 32) - 24) / 2);
            const isItem = ITEM_TYPES.has(found.node.type.name);
            const left = rect.left - hostRect.left + host.scrollLeft - (isItem ? 46 : 28);
            handle.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
            handle.setAttribute("data-visible", "");
            current = { pos: found.pos };
          };

          const onMove = (event: MouseEvent) => {
            clearTimeout(hideTimer);
            if (event.target instanceof Node && handle.contains(event.target)) return;
            show(event.clientX, event.clientY);
          };
          const onLeave = (event: MouseEvent) => {
            if (event.relatedTarget instanceof Node && handle.contains(event.relatedTarget)) return;
            hideTimer = setTimeout(hide, 250);
          };
          const select = () => {
            if (!current) return null;
            const node = view.state.doc.nodeAt(current.pos);
            if (!node) return null;
            const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, current.pos));
            view.dispatch(tr);
            return tr.selection as NodeSelection;
          };

          handle.addEventListener("mousedown", (event) => event.stopPropagation());
          handle.addEventListener("mouseenter", () => clearTimeout(hideTimer));
          handle.addEventListener("mouseleave", onLeave);
          const menu = (event: MouseEvent) => {
            event.preventDefault();
            const selection = select();
            if (!selection) return;
            // The menu hands focus back here when it closes.
            view.focus();
            const rect = handle.getBoundingClientRect();
            // Keyboard clicks have no pointer position; open under the grip.
            const fromPointer = event.detail > 0 || event.type === "contextmenu";
            openBlockMenu(editor, selection.from, fromPointer ? event.clientX : rect.left, fromPointer ? event.clientY : rect.bottom + 4);
          };
          handle.addEventListener("click", menu);
          handle.addEventListener("contextmenu", menu);
          handle.addEventListener("dragstart", (event) => {
            const selection = select();
            if (!selection || !event.dataTransfer) return;
            const slice = selection.content();
            const dom = view.nodeDOM(selection.from);
            event.dataTransfer.effectAllowed = "copyMove";
            event.dataTransfer.clearData();
            event.dataTransfer.setData("text/plain", selection.node.textContent);
            if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 0);
            // ProseMirror's drop handler moves `slice` and deletes the original.
            view.dragging = { slice, move: true };
            handle.setAttribute("data-dragging", "");
          });
          handle.addEventListener("dragend", () => {
            handle.removeAttribute("data-dragging");
            view.dragging = null;
            hide();
          });

          view.dom.addEventListener("mousemove", onMove);
          view.dom.addEventListener("mouseleave", onLeave);
          host?.addEventListener("scroll", hide, { passive: true });

          return {
            update(next, previous) {
              // Typing moves blocks around under the grip; hide it until the pointer moves.
              if (!next.state.doc.eq(previous.doc)) hide();
            },
            destroy() {
              clearTimeout(hideTimer);
              view.dom.removeEventListener("mousemove", onMove);
              view.dom.removeEventListener("mouseleave", onLeave);
              host?.removeEventListener("scroll", hide);
              host?.classList.remove("doc-block-handle-host");
              handle.remove();
            },
          };
        },
      }),
    ];
  },
});
