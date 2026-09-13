/** Shared caret-anchored placement for slash and mention menus. */

export interface PlaceCaretPopupOptions {
  width: number;
  maxHeight: number;
  gap?: number;
}

const SAFE_EDGE = 8;
/** Windows taskbar / dock often overlaps the bottom of the browser window. */
const SAFE_BOTTOM = 56;

function visibleFrame() {
  const vv = window.visualViewport;
  const top = vv?.offsetTop ?? 0;
  const left = vv?.offsetLeft ?? 0;
  const width = vv?.width ?? window.innerWidth;
  const height = vv?.height ?? window.innerHeight;
  return {
    top,
    left,
    width,
    right: left + width,
    bottom: top + height - SAFE_BOTTOM,
    height: height - SAFE_BOTTOM,
  };
}

/**
 * Positions a fixed popup next to the caret using the popup's *measured*
 * height. Flips above the caret when there is not enough room below, and
 * caps the menu height so it scrolls instead of clipping under the taskbar.
 */
export function placeCaretPopup(
  popup: HTMLElement,
  getRect: (() => DOMRect | null) | null | undefined,
  options: PlaceCaretPopupOptions,
) {
  const rect = getRect?.();
  if (!rect) return;

  const gap = options.gap ?? 8;
  const view = visibleFrame();
  const spaceBelow = view.bottom - rect.bottom - gap;
  const spaceAbove = rect.top - view.top - gap;
  const preferBelow = spaceBelow >= Math.min(160, options.maxHeight) || spaceBelow >= spaceAbove;
  const avail = Math.max(96, preferBelow ? spaceBelow : spaceAbove);
  const maxH = Math.min(options.maxHeight, avail);

  popup.style.maxHeight = `${maxH}px`;
  popup.style.overflow = "hidden";
  const inner = popup.firstElementChild;
  if (inner instanceof HTMLElement) {
    inner.style.maxHeight = `${maxH}px`;
    inner.style.overflowY = "auto";
  }

  const height = Math.min(popup.offsetHeight || maxH, maxH);
  let top = preferBelow ? rect.bottom + gap : rect.top - height - gap;
  top = Math.max(view.top + SAFE_EDGE, Math.min(top, view.bottom - height));

  popup.style.top = `${top}px`;
  popup.style.left = `${Math.max(
    view.left + SAFE_EDGE,
    Math.min(rect.left, view.right - options.width - 16),
  )}px`;
}

/** Close a caret menu when the pointer lands outside it (not Escape / Backspace). */
export function dismissOnOutsidePointer(
  popup: HTMLElement,
  dismiss: () => void,
) {
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (target && popup.contains(target)) return;
    dismiss();
  };

  document.addEventListener("pointerdown", onPointerDown);
  return () => document.removeEventListener("pointerdown", onPointerDown);
}

/** Re-place when the list height or viewport changes (filter, first layout, taskbar). */
export function watchCaretPopup(popup: HTMLElement, place: () => void) {
  const observer = new ResizeObserver(() => place());
  observer.observe(popup);
  if (popup.firstElementChild instanceof HTMLElement) {
    observer.observe(popup.firstElementChild);
  }
  requestAnimationFrame(place);

  const onView = () => place();
  window.addEventListener("resize", onView);
  window.visualViewport?.addEventListener("resize", onView);
  window.visualViewport?.addEventListener("scroll", onView);

  return () => {
    observer.disconnect();
    window.removeEventListener("resize", onView);
    window.visualViewport?.removeEventListener("resize", onView);
    window.visualViewport?.removeEventListener("scroll", onView);
  };
}
