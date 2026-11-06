import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { checklistTaskName, workLineKey } from "@timely/contract/docChecklist";

/**
 * "Make task" offers drawn on their own rows (DocHints sets them): a small
 * disc level with the first line of each offered row, in the gap right of
 * the text on a wide page and at the row's right edge on a narrow one. A row
 * that is a task already gets a check disc that opens the task. The discs are
 * decorations placed against their own row, so they move with it when the
 * page scrolls, the rail beside it changes or the doc is edited, and nothing
 * measures them. They are never saved, copied or undone.
 *
 * DocHints renders the open offer with React into the disc's host (or, on a
 * narrow page, into a host under the row), found through `hosts`.
 */

/** One row's offer: a checklist item ("todo"), a line that reads like a
 * task ("work"), or a checklist item that is a task already ("task"). */
export type Offer = {
  key: string;
  kind: "todo" | "work" | "task";
  /** The words the row is found by: a checklist item's name (its first
   * sentence, as openChecklistItems reads it), or a work line's words. */
  name: string;
};

export type OfferConfig = {
  offers: Offer[];
  /** The offer whose popover (or card) is open. */
  open: string | null;
  /** The offer whose row is tinted: its row or its rail row is hovered. */
  hover: string | null;
  /** The offer a task is being made from ("all" while every offer is). */
  busy: string | null;
  /** A narrow page: the disc sits inside the text and the open offer's card
   * goes in flow under its row. */
  inline: boolean;
};

/** What the discs do, read when they are used, so they always call the latest. */
export type OfferActions = {
  /** `keyboard`: the disc was pressed with a key, so focus goes into the
   * popover; a click leaves the caret in the text. */
  toggle: (key: string, keyboard: boolean) => void;
  openTask: (key: string) => void;
  /** The row under the pointer, or null once it has left the rows. */
  hover: (key: string | null) => void;
};

/** Where an offer's row is: the node that is tinted (a checklist row, a
 * bullet, or the line itself), by its position and type. */
type Spot = { pos: number; type: string };

type OfferState = {
  config: OfferConfig;
  spots: Map<string, Spot>;
  /** The offer whose row holds the caret, while the editor has focus. */
  caret: string | null;
  focused: boolean;
  set: DecorationSet;
};

export const offerMarksKey = new PluginKey<OfferState>("offerMarks");

const EMPTY: OfferConfig = { offers: [], open: null, hover: null, busy: null, inline: false };

/** Blocks whose checklists are not to-dos (the contract's SKIP), and blocks
 * whose lines are never work lines (its NOT_WORK). */
const SKIP = new Set(["frontmatter", "codeBlock", "mermaid"]);
const NOT_WORK = new Set(["frontmatter", "codeBlock", "heading", "table", "mermaid", "details", "taskItem"]);
/** Blocks whose right edge is not the text column's: a disc beside a row in
 * them would land on the next column's words, or be cut off by the table. */
const BOXED = new Set(["column", "tableCell", "tableHeader"]);

/** A paragraph's words as the contract's inlineText reads them: a mention is
 * its label, a line break a space. */
function inlineText(node: PMNode): string {
  let out = "";
  node.forEach((child) => {
    if (child.isText) out += child.text ?? "";
    else if (child.type.name === "mention") out += String(child.attrs.label ?? "");
    else if (child.type.name === "hardBreak") out += " ";
    else if (child.childCount) out += inlineText(child);
  });
  return out;
}

/** Text nodes only, as the contract's docWorkLines reads a paragraph. */
function plainText(node: PMNode): string {
  let out = "";
  node.descendants((child) => {
    if (child.isText) out += child.text ?? "";
    return true;
  });
  return out;
}

/** Whether a checklist row links a task, as the contract's linksTask reads it. */
function linksTask(node: PMNode): boolean {
  let found = false;
  node.forEach((child) => {
    if (found) return;
    if (child.type.name === "mention" && child.attrs.entityType === "task") found = true;
    else if (child.type.name !== "taskList" && child.childCount && linksTask(child)) found = true;
  });
  return found;
}

/** An open checklist row's task name in lower case, as openChecklistItems
 * names it; empty for a ticked row or one that links a task. */
function rowName(item: PMNode): string {
  if (item.attrs.checked === true || linksTask(item)) return "";
  const parts: string[] = [];
  item.forEach((child) => {
    if (child.type.name === "paragraph") parts.push(inlineText(child));
  });
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return [...text].length >= 2 ? checklistTaskName(text).name.toLowerCase() : "";
}

/** The doc's open checklist rows by name, its plain lines by words (the
 * first of each winning), every paragraph for a looser match, and its
 * headings, all in reading order. Read once per version of the doc: the
 * rail asks again on every hover. */
const read = new WeakMap<PMNode, ReturnType<typeof walkDoc>>();
function readDoc(doc: PMNode) {
  let found = read.get(doc);
  if (!found) {
    found = walkDoc(doc);
    read.set(doc, found);
  }
  return found;
}

function walkDoc(doc: PMNode) {
  const rows = new Map<string, Spot>();
  const lines = new Map<string, Spot>();
  const paragraphs: { spot: Spot; text: string }[] = [];
  const headings: { pos: number; text: string }[] = [];
  const walk = (node: PMNode, pos: number, plain: boolean, parent: PMNode, parentPos: number, index: number) => {
    const name = node.type.name;
    if (name === "heading") {
      headings.push({ pos, text: node.textContent.replace(/\s+/g, " ").trim() });
      return;
    }
    if (SKIP.has(name)) return;
    // A folded toggle's rows are hidden, so they get no disc, and what the
    // rail counts and Make all makes stays what the doc shows.
    if (name === "details" && node.attrs.open === false) return;
    if (name === "taskItem") {
      const key = rowName(node);
      if (key && !rows.has(key)) rows.set(key, { pos, type: name });
    }
    if (name === "paragraph") {
      // A bullet's first line is the bullet, so the whole bullet is its row.
      const spot = parent.type.name === "listItem" && index === 0 ? { pos: parentPos, type: "listItem" } : { pos, type: name };
      const key = plain ? workLineKey(plainText(node)) : "";
      if (key && !lines.has(key)) lines.set(key, spot);
      if (parent.type.name !== "taskItem") paragraphs.push({ spot, text: plainText(node).toLowerCase() });
      return;
    }
    const inner = plain && !NOT_WORK.has(name);
    node.forEach((child, offset, i) => walk(child, pos + 1 + offset, inner, node, pos, i));
  };
  doc.forEach((child, offset, i) => walk(child, offset, true, doc, -1, i));
  return { rows, lines, paragraphs, headings };
}

/** Where a row sits: in a folded toggle (hidden), or in a column or table
 * cell, whose disc goes inside it as on a narrow page. */
function placeOf(doc: PMNode, pos: number) {
  const $pos = doc.resolve(pos);
  let folded = false;
  let boxed = false;
  for (let depth = 1; depth <= $pos.depth; depth += 1) {
    const node = $pos.node(depth);
    if (node.type.name === "details" && node.attrs.open === false) folded = true;
    if (BOXED.has(node.type.name)) boxed = true;
  }
  return { folded, boxed };
}

/** The row's first line: the textblock the disc sits at the start of. */
function lineOf(doc: PMNode, spot: Spot) {
  const node = doc.nodeAt(spot.pos);
  if (!node || node.type.name !== spot.type) return null;
  if (node.isTextblock) return { node, pos: spot.pos, row: node };
  const first = node.firstChild;
  return first?.isTextblock ? { node: first, pos: spot.pos + 1, row: node } : null;
}

/** Finds each offer's row: the checklist row with its name, or for a line
 * that reads like a task the paragraph with exactly its words (the one
 * docWorkLines read), else the first paragraph holding them. */
function locate(doc: PMNode, offers: Offer[]) {
  const { rows, lines, paragraphs } = readDoc(doc);
  const spots = new Map<string, Spot>();
  const taken = new Set<number>();
  for (const offer of offers) {
    let spot: Spot | undefined;
    if (offer.kind === "work") {
      const words = workLineKey(offer.name);
      spot = lines.get(words) ?? paragraphs.find((p) => !taken.has(p.spot.pos) && p.text.includes(words))?.spot;
    } else {
      spot = rows.get(offer.name.toLowerCase());
    }
    if (spot && !taken.has(spot.pos) && lineOf(doc, spot)) {
      spots.set(offer.key, spot);
      taken.add(spot.pos);
    }
  }
  return spots;
}

/** Each offer's row in reading order, with the nearest heading above it;
 * offers whose row is not in the doc are left out. */
export function offerPlaces(state: EditorState, offers: Offer[]): { key: string; pos: number; section: string }[] {
  const { headings } = readDoc(state.doc);
  // The plugin's rows, followed through edits; offers it has not been sent
  // yet are looked for here.
  const drawn = offerMarksKey.getState(state)?.spots;
  const spots = drawn && offers.every((offer) => drawn.has(offer.key)) ? drawn : locate(state.doc, offers);
  return offers
    .flatMap((offer) => {
      const spot = spots.get(offer.key);
      if (!spot) return [];
      const heading = headings.filter((h) => h.pos < spot.pos).pop();
      return [{ key: offer.key, pos: spot.pos, section: heading?.text ?? "" }];
    })
    .sort((a, b) => a.pos - b.pos);
}

/** Where an offer's row is in the open doc, for scrolling to it. */
export function offerSpot(state: EditorState, key: string): number | null {
  return offerMarksKey.getState(state)?.spots.get(key)?.pos ?? null;
}

/** Whether an offer's disc sits inside its row and opens a card under it:
 * on a narrow page, or for a row in a column or table cell. */
export function offerInline(state: EditorState, key: string): boolean {
  const value = offerMarksKey.getState(state);
  const spot = value?.spots.get(key);
  return Boolean(value?.config.inline || (spot && placeOf(state.doc, spot.pos).boxed));
}

/** The offer whose row holds the caret; in nested rows, the innermost. */
function caretIn(state: EditorState, spots: Map<string, Spot>, focused: boolean) {
  if (!focused) return null;
  const head = state.selection.head;
  let found: string | null = null;
  let deepest = -1;
  for (const [key, spot] of spots) {
    const node = state.doc.nodeAt(spot.pos);
    if (node && head > spot.pos && head < spot.pos + node.nodeSize && spot.pos > deepest) {
      found = key;
      deepest = spot.pos;
    }
  }
  return found;
}

/** The phone's sparkle (editorHtml.ts HINT_SPARK) and check. */
const SPARK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>';
const CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/** The elements React renders the open offer into, by offer key ("card:"
 * before the key for a narrow page's card under the row). ProseMirror can
 * draw a widget again (its paragraph was replaced), so React reads them here
 * rather than keeping an element. */
export type OfferHosts = {
  get: (key: string) => HTMLElement | undefined;
  subscribe: (listener: () => void) => () => void;
  version: () => number;
};

function createHosts() {
  const map = new Map<string, HTMLElement>();
  const listeners = new Set<() => void>();
  let version = 0;
  let queued = false;
  // Widgets are drawn while ProseMirror updates the DOM; React hears of them after.
  const changed = () => {
    version += 1;
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const listener of listeners) listener();
    });
  };
  return {
    map,
    set(key: string, el: HTMLElement) {
      map.set(key, el);
      changed();
    },
    drop(key: string, el: HTMLElement) {
      if (map.get(key) !== el) return;
      map.delete(key);
      changed();
    },
    public: {
      get: (key: string) => map.get(key),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      version: () => version,
    } satisfies OfferHosts,
  };
}

type Hosts = ReturnType<typeof createHosts>;

/** The disc's host: absolutely placed against the row, so the disc lands
 * in the gap right of the text (globals.css), and the popover's parent. */
function anchor(offer: Offer, actions: () => OfferActions, hosts: Hosts) {
  const host = document.createElement("span");
  host.className = "doc-offer-anchor";
  host.contentEditable = "false";
  host.setAttribute("data-offer-anchor", offer.key);
  const disc = document.createElement("button");
  disc.type = "button";
  disc.className = "doc-offer-disc";
  if (offer.kind === "task") {
    disc.setAttribute("aria-label", `Already a task: ${offer.name}. Open it`);
    disc.title = "Already a task. Open it";
    disc.innerHTML = CHECK;
  } else {
    disc.setAttribute("aria-label", `Offer: ${offer.name}`);
    disc.setAttribute("aria-haspopup", "dialog");
    disc.setAttribute("aria-expanded", "false");
    disc.innerHTML = SPARK;
  }
  // The caret and focus stay in the text.
  disc.addEventListener("mousedown", (event) => event.preventDefault());
  disc.addEventListener("click", (event) => {
    event.preventDefault();
    if (offer.kind === "task") actions().openTask(offer.key);
    // A click from Enter or Space has no pointer press (detail 0).
    else actions().toggle(offer.key, event.detail === 0);
  });
  host.appendChild(disc);
  hosts.set(offer.key, host);
  return host;
}

/** A narrow page's host for the open card, in flow under the row's first line. */
function cardHost(key: string, hosts: Hosts) {
  const host = document.createElement("div");
  host.className = "doc-offer-card-host";
  host.contentEditable = "false";
  host.setAttribute("data-offer-anchor", key);
  hosts.set(`card:${key}`, host);
  return host;
}

function draw(doc: PMNode, config: OfferConfig, spots: Map<string, Spot>, caret: string | null, actions: () => OfferActions, hosts: Hosts) {
  const decorations: Decoration[] = [];
  for (const offer of config.offers) {
    const spot = spots.get(offer.key);
    const line = spot && lineOf(doc, spot);
    if (!spot || !line) continue;
    const open = config.open === offer.key && offer.kind !== "task";
    const hot = config.hover === offer.key;
    const inline = config.inline || placeOf(doc, spot.pos).boxed;
    const flags = [
      inline && "is-inline",
      open && "is-open",
      hot && "is-hot",
      caret === offer.key && "is-caret",
      config.busy === offer.key && "is-busy",
    ]
      .filter(Boolean)
      .join(" ");
    const rowClass = `doc-offer-row${open || hot ? " doc-line-hinted" : ""} ${flags}`;
    const lineClass = `doc-offer-line ${flags}`;
    if (line.row === line.node) {
      decorations.push(Decoration.node(spot.pos, spot.pos + line.node.nodeSize, { class: `${rowClass} doc-offer-line`, "data-offer-key": offer.key }));
    } else {
      decorations.push(Decoration.node(spot.pos, spot.pos + line.row.nodeSize, { class: rowClass, "data-offer-key": offer.key }));
      decorations.push(Decoration.node(line.pos, line.pos + line.node.nodeSize, { class: lineClass }));
    }
    // Before the first word, so what is typed at either end of the line
    // goes into the text; it takes no room there (globals.css).
    const key = `offer:${offer.kind}:${offer.key}`;
    decorations.push(
      Decoration.widget(line.pos + 1, () => anchor(offer, actions, hosts), {
        key,
        side: -1,
        ignoreSelection: true,
        stopEvent: () => true,
        destroy: (node) => hosts.drop(offer.key, node as HTMLElement),
      }),
    );
    if (open && inline) {
      decorations.push(
        Decoration.widget(line.pos + line.node.nodeSize, () => cardHost(offer.key, hosts), {
          key: `offer-card:${offer.key}`,
          side: -1,
          ignoreSelection: true,
          stopEvent: () => true,
          destroy: (node) => hosts.drop(`card:${offer.key}`, node as HTMLElement),
        }),
      );
    }
  }
  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

/** Whether a row still holds its offer's words. An edit can leave a row's
 * start on other words: Enter at the start of a line splits it there, and
 * the start stays with the new empty line above. */
function holds(line: NonNullable<ReturnType<typeof lineOf>>, offer: Offer) {
  if (offer.kind === "work") return workLineKey(plainText(line.node)).includes(workLineKey(offer.name));
  return rowName(line.row) === offer.name.toLowerCase();
}

/** Follows each row through an edit; one whose row went away, no longer
 * holds its words or was folded away is dropped, to be looked for again. */
function mapSpots(tr: Transaction, spots: Map<string, Spot>, offers: Offer[]) {
  const next = new Map<string, Spot>();
  for (const offer of offers) {
    const spot = spots.get(offer.key);
    if (!spot) continue;
    const mapped = tr.mapping.mapResult(spot.pos, 1);
    const moved = { pos: mapped.pos, type: spot.type };
    const line = mapped.deleted ? null : lineOf(tr.doc, moved);
    if (line && holds(line, offer) && !placeOf(tr.doc, moved.pos).folded) next.set(offer.key, moved);
  }
  return next;
}

const sameOffers = (a: Offer[], b: Offer[]) =>
  a.length === b.length && a.every((offer, i) => offer.key === b[i].key && offer.kind === b[i].kind && offer.name === b[i].name);

/** The plugin, with the actions its discs call read through `actions` when
 * used, and the hosts React renders the open offer into. */
export function offerMarks(actions: () => OfferActions) {
  const hosts = createHosts();
  const plugin = new Plugin<OfferState>({
    key: offerMarksKey,
    state: {
      init: () => ({ config: EMPTY, spots: new Map(), caret: null, focused: false, set: DecorationSet.empty }),
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(offerMarksKey) as { config: OfferConfig; focused: boolean } | undefined;
        // Tiptap marks its focus and blur transactions.
        const focused = meta ? meta.focused : tr.getMeta("focus") ? true : tr.getMeta("blur") ? false : value.focused;
        if (!meta && !tr.docChanged && !tr.selectionSet && focused === value.focused) return value;
        const config = meta?.config ?? value.config;
        let spots = value.spots;
        if (meta && !sameOffers(meta.config.offers, value.config.offers)) {
          spots = locate(state.doc, config.offers);
        } else if (tr.docChanged) {
          spots = mapSpots(tr, value.spots, config.offers);
          // A row went away, or one not found before may be back (cut and
          // pasted again): they are looked for again.
          if (spots.size < value.spots.size || spots.size < config.offers.length) spots = locate(state.doc, config.offers);
        }
        const caret = caretIn(state, spots, focused);
        if (!meta && !tr.docChanged && caret === value.caret) return { ...value, focused };
        return { config, spots, caret, focused, set: draw(state.doc, config, spots, caret, actions, hosts) };
      },
    },
    props: {
      decorations: (state) => offerMarksKey.getState(state)?.set,
    },
    view(view) {
      // The row under the pointer is tinted and its rail row lit. Crossing
      // the gap between a row's text and its disc leaves the editor for a
      // moment, so leaving waits a little before it counts. DocHints keeps
      // the rail's own hover apart, so this late leave never clears it.
      let last: string | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const report = (key: string | null) => {
        clearTimeout(timer);
        if (key === last) return;
        if (key) {
          last = key;
          actions().hover(key);
          return;
        }
        timer = setTimeout(() => {
          last = null;
          actions().hover(null);
        }, 80);
      };
      const over = (event: MouseEvent) => {
        const row = event.target instanceof Element ? event.target.closest("[data-offer-key]") : null;
        report(row && view.dom.contains(row) ? row.getAttribute("data-offer-key") : null);
      };
      const leave = () => report(null);
      view.dom.addEventListener("mouseover", over);
      view.dom.addEventListener("mouseleave", leave);
      const sync = () => {
        const open = offerMarksKey.getState(view.state)?.config.open ?? null;
        for (const [key, host] of hosts.map) {
          const disc = host.querySelector(":scope > .doc-offer-disc[aria-expanded]");
          disc?.setAttribute("aria-expanded", String(key === open));
        }
      };
      return {
        update: sync,
        destroy() {
          clearTimeout(timer);
          view.dom.removeEventListener("mouseover", over);
          view.dom.removeEventListener("mouseleave", leave);
        },
      };
    },
  });
  return { plugin, hosts: hosts.public };
}

/** Sends DocHints' offers to the plugin, outside the undo history. */
export function setOffers(state: EditorState, config: OfferConfig, focused: boolean) {
  return state.tr.setMeta(offerMarksKey, { config, focused }).setMeta("addToHistory", false);
}

/** The offers the plugin draws now, to skip sending the same ones again. */
export function currentOffers(state: EditorState): OfferConfig | undefined {
  return offerMarksKey.getState(state)?.config;
}
