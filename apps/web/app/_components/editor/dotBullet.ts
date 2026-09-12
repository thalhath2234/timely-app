import { Extension, InputRule, wrappingInputRule } from "@tiptap/react";

/**
 * Line-start shortcuts:
 * `.` then space → bullet list
 * `-` then space → divider
 *
 * Space is handled as a keyboard shortcut so the character never has to land
 * in the document first. Input rules remain as a fallback for IME / paste.
 */
export const DotBulletShortcut = Extension.create({
  name: "dotBulletShortcut",

  addInputRules() {
    const bullet = this.editor.schema.nodes.bulletList;
    const rules = [];

    if (bullet) {
      rules.push(wrappingInputRule({ find: /^\s*\.\s$/, type: bullet }));
    }

    rules.push(
      new InputRule({
        find: /^-\s$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).setHorizontalRule().run();
        },
      }),
    );

    return rules;
  },

  addKeyboardShortcuts() {
    return {
      Space: () => {
        const { $from } = this.editor.state.selection;
        if (!$from.parent.isTextblock) return false;
        if (this.editor.isActive("codeBlock") || this.editor.isActive("code")) {
          return false;
        }
        if (
          this.editor.isActive("bulletList") ||
          this.editor.isActive("orderedList") ||
          this.editor.isActive("taskList")
        ) {
          return false;
        }
        if ($from.parentOffset !== 1) return false;

        const marker = $from.parent.textContent;
        const range = { from: $from.start(), to: $from.pos };

        if (marker === ".") {
          return this.editor
            .chain()
            .focus()
            .deleteRange(range)
            .toggleBulletList()
            .run();
        }

        if (marker === "-") {
          return this.editor
            .chain()
            .focus()
            .deleteRange(range)
            .setHorizontalRule()
            .run();
        }

        return false;
      },
    };
  },
});
