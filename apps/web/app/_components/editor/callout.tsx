"use client";

import {
  Node as TiptapNode,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  wrappingInputRule,
  type NodeViewProps,
} from "@tiptap/react";
import {
  Info,
  Lightbulb,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import Select, { type SelectOption } from "@/app/_components/_ui/select";

/*
 * A callout is the "> [!NOTE]" quote GitHub and Obsidian draw as a coloured
 * box. The five GitHub kinds get an icon; any other word Obsidian allows is
 * kept and drawn plain.
 */

export const CALLOUT_KINDS: Record<string, { label: string; icon: LucideIcon }> = {
  note: { label: "Note", icon: Info },
  tip: { label: "Tip", icon: Lightbulb },
  important: { label: "Important", icon: MessageSquareWarning },
  warning: { label: "Warning", icon: TriangleAlert },
  caution: { label: "Caution", icon: OctagonAlert },
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Wraps the current block in a callout of the given kind. */
      setCallout: (attrs?: { kind?: string }) => ReturnType;
    };
  }
}

function CalloutView({ node, editor, updateAttributes }: NodeViewProps) {
  const kind = String(node.attrs.kind || "note");
  const known = CALLOUT_KINDS[kind];
  const Icon = known?.icon ?? Info;
  const options: SelectOption[] = Object.entries(CALLOUT_KINDS).map(([value, item]) => ({
    value,
    label: item.label,
    icon: (
      <span className={`doc-callout-${value} doc-callout-swatch`}>
        <item.icon aria-hidden />
      </span>
    ),
  }));
  // A kind written by Obsidian (or by hand) stays pickable as itself.
  if (!known) options.push({ value: kind, label: kind, icon: <Info aria-hidden /> });

  return (
    <NodeViewWrapper className={`doc-callout doc-callout-${known ? kind : "other"}`} data-callout="">
      <div className="doc-callout-head" contentEditable={false}>
        <Icon className="doc-callout-icon size-4" aria-hidden />
        <Select
          variant="inline"
          value={kind}
          options={options}
          aria-label="Callout kind"
          disabled={!editor.isEditable}
          className="doc-callout-kind"
          onChange={(next) => updateAttributes({ kind: next })}
        />
        <input
          className="doc-callout-title"
          value={String(node.attrs.title ?? "")}
          placeholder="Title (optional)"
          aria-label="Callout title"
          readOnly={!editor.isEditable}
          onChange={(event) => updateAttributes({ title: event.target.value || null })}
        />
      </div>
      <NodeViewContent className="doc-callout-body" />
    </NodeViewWrapper>
  );
}

export const Callout = TiptapNode.create({
  name: "callout",
  // Above the quote node so typing "> " makes a callout, not a plain quote.
  priority: 101,
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: "note",
        parseHTML: (element) => element.getAttribute("data-kind") || "note",
        renderHTML: (attributes) => ({ "data-kind": attributes.kind }),
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-title"),
        renderHTML: (attributes) => (attributes.title ? { "data-title": attributes.title } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  addCommands() {
    return {
      setCallout:
        (attrs = {}) =>
        ({ commands }) =>
          commands.wrapIn(this.name, { kind: attrs.kind ?? "note" }),
    };
  },

  addInputRules() {
    return [wrappingInputRule({ find: /^\s*>\s$/, type: this.type, getAttributes: { kind: "note" } })];
  },

  addKeyboardShortcuts() {
    const leaveWhenEmpty = () => {
      const { $from, empty } = this.editor.state.selection;
      if (!empty || $from.parent.type.name !== "paragraph" || $from.parent.textContent) return false;
      if ($from.depth < 2 || $from.node(-1).type.name !== this.name) return false;
      return this.editor.commands.lift("paragraph");
    };
    return {
      // Enter on an empty last line steps out of the box; Backspace on an
      // empty box removes it.
      Enter: () => {
        const { $from } = this.editor.state.selection;
        if ($from.depth < 2 || $from.index(-1) !== $from.node(-1).childCount - 1) return false;
        return leaveWhenEmpty();
      },
      Backspace: () => {
        const { $from } = this.editor.state.selection;
        if ($from.depth < 2 || $from.node(-1).childCount !== 1) return false;
        return leaveWhenEmpty();
      },
    };
  },
});
