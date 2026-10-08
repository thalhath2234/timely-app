import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Find and replace inside one doc. Matches are found per text block (a
 * paragraph, heading, cell, code block...), so a match never spans two
 * blocks; mentions, images and formulas inside a block count as one
 * character that never matches. The bar is findBar.tsx.
 */

export type FindState = {
  query: string;
  caseSensitive: boolean;
  matches: { from: number; to: number }[];
  /** Index into matches of the highlighted one, -1 when there are none. */
  current: number;
};

type FindMeta = { query?: string; caseSensitive?: boolean; current?: number };

export const findKey = new PluginKey<FindState>("findReplace");

const EMPTY: FindState = { query: "", caseSensitive: false, matches: [], current: -1 };

function findMatches(doc: PMNode, query: string, caseSensitive: boolean) {
  const out: { from: number; to: number }[] = [];
  if (!query) return out;
  const needle = caseSensitive ? query : query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    node.forEach((child) => {
      text += child.isText ? child.text ?? "" : "￼".repeat(child.nodeSize);
    });
    const hay = caseSensitive ? text : text.toLowerCase();
    for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
      out.push({ from: pos + 1 + at, to: pos + 1 + at + needle.length });
    }
    return false;
  });
  return out;
}

/** The first match at or after pos, so a new search starts near the caret. */
function nearest(matches: FindState["matches"], pos: number) {
  if (matches.length === 0) return -1;
  const index = matches.findIndex((match) => match.from >= pos);
  return index === -1 ? 0 : index;
}

function compute(state: FindState, doc: PMNode, meta: FindMeta | undefined, caret: number): FindState {
  const query = meta?.query ?? state.query;
  const caseSensitive = meta?.caseSensitive ?? state.caseSensitive;
  const matches = findMatches(doc, query, caseSensitive);
  let current: number;
  if (meta?.current !== undefined) current = matches.length ? ((meta.current % matches.length) + matches.length) % matches.length : -1;
  else if (meta?.query !== undefined || meta?.caseSensitive !== undefined) current = nearest(matches, caret);
  else current = matches.length ? Math.min(Math.max(state.current, 0), matches.length - 1) : -1;
  return { query, caseSensitive, matches, current };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    findReplace: {
      setFind: (options: { query?: string; caseSensitive?: boolean }) => ReturnType;
      /** Moves to the next (1) or previous (-1) match and scrolls to it. */
      findStep: (direction: 1 | -1) => ReturnType;
      replaceCurrent: (text: string) => ReturnType;
      replaceAll: (text: string) => ReturnType;
    };
  }
}

/** Selects the match and opens any folded toggle around it. */
function reveal(tr: Transaction, match: { from: number; to: number }) {
  const $from = tr.doc.resolve(match.from);
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "details" && !node.attrs.open) {
      tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, open: true });
    }
  }
  tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
  return tr.scrollIntoView();
}

export function getFindState(state: EditorState) {
  return findKey.getState(state) ?? EMPTY;
}

export const FindReplace = Extension.create<{ onOpen: (() => void) | null }>({
  name: "findReplace",

  addOptions() {
    return { onOpen: null };
  },

  addKeyboardShortcuts() {
    const open = () => {
      if (!this.options.onOpen) return false;
      this.options.onOpen();
      return true;
    };
    return { "Mod-f": open, "Mod-h": open };
  },

  addCommands() {
    return {
      setFind:
        (options) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(findKey, options));
          return true;
        },
      findStep:
        (direction) =>
        ({ state, tr, dispatch }) => {
          const find = getFindState(state);
          if (find.matches.length === 0) return false;
          const current = find.current + direction;
          const index = ((current % find.matches.length) + find.matches.length) % find.matches.length;
          // Unfolding a toggle to show the match is not an edit to undo.
          if (dispatch) dispatch(reveal(tr.setMeta(findKey, { current: index }), find.matches[index]).setMeta("addToHistory", false));
          return true;
        },
      replaceCurrent:
        (text) =>
        ({ state, tr, dispatch }) => {
          const find = getFindState(state);
          const match = find.matches[find.current];
          if (!match) return false;
          if (dispatch) {
            if (text) tr.insertText(text, match.from, match.to);
            else tr.delete(match.from, match.to);
            // Stay on the same index, which is now the next match.
            tr.setMeta(findKey, { current: find.current });
            const next = findMatches(tr.doc, find.query, find.caseSensitive);
            const target = next[find.current % Math.max(next.length, 1)];
            if (target) reveal(tr, target);
            dispatch(tr);
          }
          return true;
        },
      replaceAll:
        (text) =>
        ({ state, tr, dispatch }) => {
          const find = getFindState(state);
          if (find.matches.length === 0) return false;
          if (dispatch) {
            for (const match of [...find.matches].reverse()) {
              if (text) tr.insertText(text, match.from, match.to);
              else tr.delete(match.from, match.to);
            }
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply(tr, value, _old, next) {
            const meta = tr.getMeta(findKey) as FindMeta | undefined;
            if (!meta && !tr.docChanged) return value;
            if (!meta && !value.query) return value;
            return compute(value, tr.doc, meta, next.selection.from);
          },
        },
        props: {
          decorations(state) {
            const find = findKey.getState(state);
            if (!find || find.matches.length === 0) return null;
            return DecorationSet.create(
              state.doc,
              find.matches.map((match, index) =>
                Decoration.inline(match.from, match.to, { class: index === find.current ? "doc-find-match doc-find-current" : "doc-find-match" }),
              ),
            );
          },
        },
      }),
    ];
  },
});
