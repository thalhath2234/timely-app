import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const SENTENCE_END = /[.!?]\s+$/;

function shouldCapitalize(textBefore: string, typed: string) {
  if (!/^[a-z]$/.test(typed)) return false;
  if (!textBefore || /[\n\r]$/.test(textBefore)) return true;
  return SENTENCE_END.test(textBefore);
}

/** Capitalizes the first letter of a block and the letter after `. ? !`. */
export const AutoCapitalize = Extension.create({
  name: "autoCapitalize",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("autoCapitalize"),
        props: {
          handleTextInput(view, from, to, text) {
            // Code, formulas and properties are typed exactly as written.
            if (view.state.doc.resolve(from).parent.type.spec.code) return false;
            if (!shouldCapitalize(view.state.doc.textBetween(Math.max(0, from - 8), from, "\n", "\n"), text)) {
              return false;
            }
            const tr = view.state.tr.insertText(text.toUpperCase(), from, to);
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});
