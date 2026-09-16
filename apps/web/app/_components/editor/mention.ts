import { Editor, Node as TiptapNode, mergeAttributes } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { SuggestionOptions } from "@tiptap/suggestion";
import {
  MentionAppearance,
  MentionEntityType,
} from "@/app/_types/types";

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

export function isPageAppearance(appearance?: string | null) {
  return appearance === "page";
}

/** Visible text for a mention node: page links show the title, others keep @. */
export function mentionDisplayText(attrs: {
  label?: string | null;
  appearance?: string | null;
}) {
  const label = attrs.label || "Untitled";
  return isPageAppearance(attrs.appearance) ? label : `@${label}`;
}

/** Replace `range` (the `/` query) with a nested-page link showing the doc title. */
export function insertPageMention(
  editor: Editor,
  range: { from: number; to?: number },
  doc: { id: string; title?: string | null },
) {
  const size = editor.state.doc.content.size;
  const from = Math.max(0, Math.min(range.from, size));
  const to = Math.max(from, Math.min(range.to ?? from, size));
  const label = doc.title || "Untitled";

  return editor
    .chain()
    .focus()
    .insertContentAt({ from, to }, [
      {
        type: "mention",
        attrs: {
          id: doc.id,
          label,
          entityType: "doc",
          appearance: "page" satisfies MentionAppearance,
        },
      },
      { type: "text", text: " " },
    ])
    .run();
}

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
        allowedPrefixes: null,
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
      appearance: {
        default: "mention",
        parseHTML: (element) =>
          element.getAttribute("data-appearance") || "mention",
        renderHTML: (attributes) =>
          isPageAppearance(attributes.appearance)
            ? { "data-appearance": "page" }
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
    const isPage = isPageAppearance(node.attrs.appearance);

    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        "data-mention": "",
        class: isPage ? "doc-mention doc-page-link" : "doc-mention",
        href: mentionHref(entityType, node.attrs.id),
        title: `${MENTION_TYPE_LABELS[entityType] ?? "Item"}: ${label}`,
      }),
      mentionDisplayText(node.attrs),
    ];
  },

  // Keeps mentions readable in the plain-text copy used for search.
  renderText({ node }) {
    return mentionDisplayText(node.attrs);
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
