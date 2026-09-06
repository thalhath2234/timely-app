/** Shared caret-anchored placement for slash and mention menus. */

export interface PlaceCaretPopupOptions {
  width: number;
  maxHeight: number;
  gap?: number;
}

/**
 * Positions a fixed popup next to the caret using the popup's *measured*
 * height. Using max-height as a stand-in for a short list placed the menu
 * far above the caret whenever the viewport flipped it upward.
 */
export function placeCaretPopup(
  popup: HTMLElement,
  getRect: (() => DOMRect | null) | null | undefined,
  options: PlaceCaretPopupOptions,
) {
  const rect = getRect?.();
  if (!rect) return;

  const gap = options.gap ?? 8;
  const measured = popup.offsetHeight;
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;

  let top: number;
  if (measured <= 0) {
    // React has not laid out the list yet. Sit just below the caret so the
    // first paint is never offset by an assumed max-height box.
    top = rect.bottom + gap;
  } else {
    const needed = Math.min(measured, options.maxHeight) + gap + 8;
    const fitsBelow = spaceBelow >= needed;
    const fitsAbove = spaceAbove >= needed;
    top = fitsBelow || (!fitsAbove && spaceBelow >= spaceAbove)
      ? rect.bottom + gap
      : rect.top - measured - gap;
  }

  const maxTop =
    measured > 0 ? window.innerHeight - measured - 8 : window.innerHeight - 8;

  popup.style.top = `${Math.max(8, Math.min(top, maxTop))}px`;
  popup.style.left = `${Math.max(
    8,
    Math.min(rect.left, window.innerWidth - options.width - 16),
  )}px`;
}

/** Re-place when the list height changes (filter, first layout, fonts). */
export function watchCaretPopup(popup: HTMLElement, place: () => void) {
  const observer = new ResizeObserver(() => place());
  observer.observe(popup);
  if (popup.firstElementChild instanceof HTMLElement) {
    observer.observe(popup.firstElementChild);
  }
  requestAnimationFrame(place);

  return () => observer.disconnect();
}
