import type { Editor, JSONContent } from "@tiptap/react";

/**
 * Puts a newer copy of the doc into the editor by replacing only the range
 * that differs. Blocks that did not change keep their DOM, so images do not
 * reload and the page does not flash, and the caret and scroll stay put; a
 * copy equal to what the editor holds changes nothing. Falls back to a full
 * setContent when the copy does not fit the schema.
 */
export function applyRemoteContent(editor: Editor, json: JSONContent) {
  if (editor.isDestroyed) return;
  try {
    const next = editor.schema.nodeFromJSON(json);
    const current = editor.state.doc;
    const start = current.content.findDiffStart(next.content);
    if (start == null) return;
    const end = current.content.findDiffEnd(next.content);
    let endA = end?.a ?? current.content.size;
    let endB = end?.b ?? next.content.size;
    // Repeated content can make the two ends cross the start; widen both.
    const overlap = start - Math.min(endA, endB);
    if (overlap > 0) {
      endA += overlap;
      endB += overlap;
    }
    const tr = editor.state.tr.replace(start, endA, next.slice(start, endB));
    // Not the user's edit: keep it out of undo and out of onUpdate (no save).
    tr.setMeta("addToHistory", false);
    tr.setMeta("preventUpdate", true);
    editor.view.dispatch(tr);
  } catch {
    editor.commands.setContent(json, { emitUpdate: false });
  }
}
