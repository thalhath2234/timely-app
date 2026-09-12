import type { PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { exitSuggestion } from "@tiptap/suggestion";

/**
 * Hide a slash/mention menu and delete the trigger text (`/` or `@…`)
 * so Ctrl+K / click-outside does not leave it in the document.
 */
export function dismissSuggestionAndQuery(
  view: EditorView,
  pluginKey: PluginKey,
) {
  const state = pluginKey.getState(view.state) as
    | { active?: boolean; range?: { from: number; to: number } }
    | undefined;

  if (state?.active && state.range && state.range.to > state.range.from) {
    view.dispatch(view.state.tr.delete(state.range.from, state.range.to));
    return;
  }

  exitSuggestion(view, pluginKey);
}
