import { Node as TiptapNode, mergeAttributes } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { SuggestionOptions } from "@tiptap/suggestion";
import { MentionEntityType } from "@/app/_types/types";

export interface MentionItem {
  id: string;
  label: string;
  entityType: MentionEntityType;
  /** Secondary line in the picker, such as the parent project or workspace. */
  hint?: string;
}

export interface MentionOptions {
  suggestion: Omit<SuggestionOptions<MentionItem>, "editor">;
}

export const MentionPluginKey = new PluginKey("entityMention");

export const MENTION_TYPE_LABELS: Record<MentionEntityType, string> = {
  doc: "Doc",
  sheet: "Sheet",
  task: "Task",
  project: "Project",
};

/** Where a mention chip navigates to when clicked. */
export function mentionHref(entityType: MentionEntityType, id: string) {
  switch (entityType) {
    case "doc":
      return `/docs/${id}`;
    case "sheet":
      return `/sheets/${id}`;
    case "task":
      return `/tasks?taskId=${encodeURIComponent(id)}`;
    case "project":
      return `/tasks?projectId=${encodeURIComponent(id)}`;
    default:
      return "#";
  }
}

/**
 * An inline atom holding a reference to another entity. The label is stored on
 * the node so a mention still reads correctly if the target is later deleted.
 */
export const Mention = TiptapNode.create<MentionOptions>({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {
      suggestion: {
        char: "@",
        allowSpaces: false,
        pluginKey: MentionPluginKey,
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: "mention",
                attrs: {
                  id: props.id,
                  label: props.label,
                  entityType: props.entityType,
                },
              },
              { type: "text", text: " " },
            ])
            .run();
        },
      },
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-id"),
        renderHTML: (attributes) =>
          attributes.id ? { "data-id": attributes.id } : {},
      },
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-label") ?? "",
        renderHTML: (attributes) =>
          attributes.label ? { "data-label": attributes.label } : {},
      },
      entityType: {
        default: "doc",
        parseHTML: (element) => element.getAttribute("data-entity-type"),
        renderHTML: (attributes) =>
          attributes.entityType
            ? { "data-entity-type": attributes.entityType }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-mention]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const entityType = (node.attrs.entityType ??
      "doc") as MentionEntityType;
    const label = node.attrs.label || "Untitled";

    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        "data-mention": "",
        class: "doc-mention",
        href: mentionHref(entityType, node.attrs.id),
        title: `${MENTION_TYPE_LABELS[entityType] ?? "Item"}: ${label}`,
      }),
      `@${label}`,
    ];
  },

  // Keeps mentions readable in the plain-text copy used for search.
  renderText({ node }) {
    return `@${node.attrs.label || "Untitled"}`;
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        pluginKey: MentionPluginKey,
      }),
    ];
  },
});
