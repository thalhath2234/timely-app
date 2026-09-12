import { Editor, Extension, Range } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { SuggestionOptions } from "@tiptap/suggestion";
import { LucideIcon } from "lucide-react";

export const SlashCommandPluginKey = new PluginKey("slashCommand");

export interface SlashCommandItem {
  title: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
  run: (props: { editor: Editor; range: Range }) => void;
}

export interface SlashCommandOptions {
  suggestion: Omit<SuggestionOptions<SlashCommandItem>, "editor">;
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        pluginKey: SlashCommandPluginKey,
        command: ({ editor, range, props }) => props.run({ editor, range }),
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        pluginKey: SlashCommandPluginKey,
      }),
    ];
  },
});
