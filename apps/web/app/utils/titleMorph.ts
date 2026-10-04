import { prefersReducedMotion } from "@/app/utils/viewTransition";

/**
 * Morphs a task or project title in a list into the detail modal's title
 * input, and back on close, with the View Transitions API.
 *
 * React only pairs named `<ViewTransition>`s when one unmounts as the other
 * mounts, but list titles stay mounted under the modal. So the shared
 * `view-transition-name` is handed over by hand, and only one element ever
 * holds it at a time (a duplicate name aborts the whole transition):
 *
 * - open: the list title holds the name for the old snapshot; the modal
 *   title's layout effect, which React runs inside the transition's update
 *   callback, moves it to the modal title for the new snapshot.
 * - close: the modal title holds it for the old snapshot; its layout cleanup
 *   moves it to the list title for the new snapshot.
 *
 * List titles opt in with `data-entity-title="task:<id>"` (or `project:`).
 */

const MORPH_NAME = "entity-title";
/** Long enough for a slow commit; a no-op if the transition already claimed it. */
const UNCLAIMED_SOURCE_TIMEOUT_MS = 1500;

let source: HTMLElement | null = null;
let closing = false;
/** Bumped by every open/close so a stale timeout cannot clear a newer morph. */
let generation = 0;
let lastPointer: { x: number; y: number } | null = null;

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (event) => {
      lastPointer = { x: event.clientX, y: event.clientY };
    },
    true,
  );
}

export function entityTitleKey(kind: "task" | "project", id: string) {
  return `${kind}:${id}`;
}

type ViewTransitionDocument = Document & {
  activeViewTransition?: ViewTransition | null;
  __reactViewTransition?: ViewTransition | null;
};

function activeTransition(): ViewTransition | null {
  const doc = document as ViewTransitionDocument;
  return doc.activeViewTransition ?? doc.__reactViewTransition ?? null;
}

function setName(element: HTMLElement, named: boolean) {
  element.style.viewTransitionName = named ? MORPH_NAME : "";
}

function hasName(element: HTMLElement) {
  return element.style.viewTransitionName === MORPH_NAME;
}

function clearWhenDone(element: HTMLElement) {
  const clear = () => {
    if (hasName(element)) setName(element, false);
  };
  const transition = activeTransition();
  if (transition) void transition.finished.finally(clear);
  else clear();
}

/** The on-screen title for `key`, nearest to where the user last pressed. */
function findListTitle(key: string): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    `[data-entity-title="${CSS.escape(key)}"]`,
  );
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    if (rect.right < 0 || rect.left > window.innerWidth) continue;
    const distance = lastPointer
      ? Math.hypot(
          lastPointer.x - (rect.left + rect.width / 2),
          lastPointer.y - (rect.top + rect.height / 2),
        )
      : 0;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Call right before the state update that opens the modal for `key`. */
export function beginOpenMorph(key: string) {
  if (typeof window === "undefined" || prefersReducedMotion()) return;
  if (source && hasName(source)) setName(source, false);
  closing = false;
  const current = ++generation;
  source = findListTitle(key);
  if (!source) return;
  const element = source;
  setName(element, true);
  setTimeout(() => {
    if (generation === current && hasName(element)) setName(element, false);
  }, UNCLAIMED_SOURCE_TIMEOUT_MS);
}

/** Call right before the state update that closes the modal showing `key`. */
export function beginCloseMorph(target: HTMLElement | null, key: string) {
  closing = false;
  generation++;
  if (!target || typeof window === "undefined" || prefersReducedMotion()) return;
  source = source?.isConnected && source.dataset.entityTitle === key ? source : findListTitle(key);
  if (!source) return;
  closing = true;
  setName(target, true);
}

/** Modal title mounted: take the name over from the list title. */
export function attachMorphTarget(target: HTMLElement) {
  if (!source || !hasName(source)) return;
  setName(source, false);
  if (!activeTransition()) return;
  setName(target, true);
  clearWhenDone(target);
}

/** Modal title unmounting: hand the name back to the list title. */
export function detachMorphTarget(target: HTMLElement) {
  const wasClosing = closing && hasName(target);
  closing = false;
  setName(target, false);
  if (!wasClosing || !source?.isConnected) return;
  setName(source, true);
  clearWhenDone(source);
}
