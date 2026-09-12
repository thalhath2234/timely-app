"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Editor,
  EditorContent,
  Extensions,
  JSONContent,
  useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Check,
  CheckSquare,
  Code,
  Code2,
  Columns2,
  ExternalLink,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Strikethrough,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
  Unlink,
} from "lucide-react";
import { DocContent } from "@/app/_types/types";
import { useMentionItems } from "@/app/utils/hooks/useMentionItems";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { dismissSuggestionAndQuery } from "./dismissSuggestion";
import { Mention, MentionPluginKey } from "./mention";
import { createMentionRenderer, filterMentionItems } from "./mentionMenu";
import { SlashCommand, SlashCommandPluginKey } from "./slashCommand";
import { DotBulletShortcut } from "./dotBullet";
import {
  OPEN_LINK_EDITOR_EVENT,
  createSlashItems,
  createSlashRenderer,
  filterSlashItems,
} from "./slashMenu";

const LINK_POPOVER_WIDTH = 320;
const TOOLBAR_WIDTH = 340;
const TABLE_TOOLBAR_WIDTH = 470;

interface FloatingPosition {
  top: number;
  left: number;
}

export interface RichTextEditorProps {
  content: DocContent;
  onChange: (value: { content: DocContent; plainText: string }) => void;
  onReady?: (editor: Editor) => void;
  placeholder?: string;
  /** "page" is a full document body; "compact" is a description field. */
  variant?: "page" | "compact";
  /** "fixed" pins formatting controls above the editor, like a task description. */
  toolbar?: "float" | "fixed";
  enableSlashCommands?: boolean;
  enableMentions?: boolean;
  autoFocus?: boolean;
}

/** Adds a protocol so that "example.com" becomes a usable href. */
function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(https?:\/\/|mailto:|tel:|\/)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function clampToViewport(left: number, width: number) {
  return Math.max(8, Math.min(left, window.innerWidth - width - 8));
}

function isInsideTable(editor: Editor, pos: number) {
  const doc = editor.state.doc;
  // Placeholder decorations are built against the transaction's new doc while
  // editor.state can still be the previous one. Resolving a future position
  // throws RangeError and aborts the command that triggered the update.
  if (pos < 0 || pos > doc.content.size) return false;
  const $pos = doc.resolve(pos);

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const name = $pos.node(depth).type.name;
    if (name === "table" || name === "tableCell" || name === "tableHeader") {
      return true;
    }
  }

  return false;
}

const BLANK_DOCUMENT: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/** Tiptap rejects a document without a node type, which stored blanks can be. */
function toEditorContent(content: DocContent | null | undefined): JSONContent {
  return content && typeof content.type === "string"
    ? (content as JSONContent)
    : BLANK_DOCUMENT;
}

export default function RichTextEditor({
  content,
  onChange,
  onReady,
  placeholder,
  variant = "page",
  toolbar = "float",
  enableSlashCommands = true,
  enableMentions = true,
  autoFocus = false,
}: RichTextEditorProps) {
  const router = useRouter();
  const onChangeRef = useRef(onChange);

  const [toolbarPosition, setToolbarPosition] =
    useState<FloatingPosition | null>(null);
  const [tableToolbarPosition, setTableToolbarPosition] =
    useState<FloatingPosition | null>(null);
  const [linkPosition, setLinkPosition] = useState<FloatingPosition | null>(
    null,
  );
  const [linkDraft, setLinkDraft] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);

  // The suggestion plugin lives outside React, so it reads the latest list
  // through a ref rather than being rebuilt whenever the data refreshes.
  const mentionItems = useMentionItems();
  const mentionItemsRef = useRef(mentionItems);

  const openLinkEditor = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const { from } = editor.state.selection;
    const coords = editor.view.coordsAtPos(from);

    setLinkDraft(editor.getAttributes("link").href ?? "");
    setToolbarPosition(null);
    setLinkPosition({
      top: coords.bottom + 8,
      left: clampToViewport(coords.left, LINK_POPOVER_WIDTH),
    });
  }, []);

  const extensions = useMemo(() => {
    const defaultPlaceholder =
      variant === "compact"
        ? "Add a description. Type '/' for blocks and '@' to mention."
        : "Type '/' for commands, '@' to mention, or just start writing...";

    const list: Extensions = [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: {
            class: "doc-link",
            rel: "noopener noreferrer nofollow",
          },
        },
        codeBlock: { HTMLAttributes: { class: "doc-code-block" } },
      }),
      Placeholder.configure({
        includeChildren: true,
        showOnlyCurrent: false,
        placeholder: ({
          editor: placeholderEditor,
          node,
          pos,
          hasAnchor,
        }: {
          editor: Editor;
          node: { type: { name: string }; attrs: Record<string, unknown> };
          pos: number;
          hasAnchor: boolean;
        }) => {
          if (node.type.name === "heading") {
            return `Heading ${node.attrs.level}`;
          }
          if (isInsideTable(placeholderEditor, pos)) {
            return hasAnchor ? "Type @ to mention" : "";
          }
          // First child of an empty doc is at pos 0 (resolve(0).depth is 0).
          if (!placeholderEditor.isEmpty || pos !== 0) return "";
          return placeholder ?? defaultPlaceholder;
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: false }),
      TableKit.configure({
        table: { resizable: true, handleWidth: 6, cellMinWidth: 80 },
      }),
      DotBulletShortcut,
    ];

    if (enableSlashCommands) {
      list.push(
        SlashCommand.configure({
          suggestion: {
            char: "/",
            pluginKey: SlashCommandPluginKey,
            allow: ({ editor: slashEditor, range }) =>
              !isInsideTable(slashEditor, range.from),
            items: ({ query }: { query: string }) =>
              filterSlashItems(createSlashItems(), query),
            render: createSlashRenderer,
          },
        }),
      );
    }

    if (enableMentions) {
      list.push(
        Mention.configure({
          suggestion: {
            pluginKey: MentionPluginKey,
            items: ({ query }: { query: string }) =>
              filterMentionItems(mentionItemsRef.current, query),
            render: createMentionRenderer,
          },
        }),
      );
    }

    return list;
    // The mention list is read through a ref, so it must not rebuild here.
  }, [enableMentions, enableSlashCommands, placeholder, variant]);

  const editor = useEditor({
    // The editor is rendered inside a client page, and Tiptap requires this
    // flag to avoid hydration mismatches in the Next.js app router.
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    extensions,
    content: toEditorContent(content),
    editorProps: {
      attributes: {
        class: `doc-editor-content focus:outline-none ${
          variant === "compact" ? "doc-editor-compact" : ""
        } ${toolbar === "fixed" ? "doc-editor-description" : ""}`,
      },
      handleKeyDown: (view, event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          (event.key.toLowerCase() === "k" || event.code === "KeyK")
        ) {
          event.preventDefault();
          dismissSuggestionAndQuery(view, SlashCommandPluginKey);
          dismissSuggestionAndQuery(view, MentionPluginKey);
          setLinkPosition(null);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      onChangeRef.current({
        content: updatedEditor.getJSON() as DocContent,
        plainText: updatedEditor.getText(),
      });
    },
  });

  useEffect(() => {
    onChangeRef.current = onChange;
    mentionItemsRef.current = mentionItems;
  });

  // Apply incoming content from another client only when it actually changed.
  // Do not listen to blur unconditionally: clicking the slash/mention menu
  // blurs the editor, and resetting to the last saved `content` would wipe
  // the `/query` and abort the insert (RangeError: position out of range).
  const incomingContent = toEditorContent(content);
  const incomingContentKey = JSON.stringify(incomingContent);

  useEffect(() => {
    if (!editor) return;
    if (JSON.stringify(editor.getJSON()) === incomingContentKey) return;

    const next = JSON.parse(incomingContentKey) as JSONContent;
    if (!editor.isFocused) {
      editor.commands.setContent(next, { emitUpdate: false });
      return;
    }

    const applyOnBlur = () => {
      editor.off("blur", applyOnBlur);
      if (JSON.stringify(editor.getJSON()) === incomingContentKey) return;
      editor.commands.setContent(next, { emitUpdate: false });
    };
    editor.on("blur", applyOnBlur);
    return () => {
      editor.off("blur", applyOnBlur);
    };
  }, [editor, incomingContentKey]);

  useEffect(() => {
    editorRef.current = editor ?? null;
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);

  // Mention chips are anchors, so they are routed client-side instead of
  // triggering a full page load.
  useEffect(() => {
    if (!editor) return;

    const element = editor.view.dom;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const mention = target?.closest?.("a[data-mention]");
      if (!mention) return;

      const href = mention.getAttribute("href");
      if (!href || href === "#") return;

      event.preventDefault();
      router.push(href);
    };

    element.addEventListener("click", handleClick);
    return () => element.removeEventListener("click", handleClick);
  }, [editor, router]);

  // Search (Ctrl+K) owns that shortcut — close editor overlays so they do
  // not sit under the search palette.
  useEffect(() => {
    if (!editor) return;

    return useSidebarStore.subscribe((state) => {
      if (!state.searchMode) return;
      dismissSuggestionAndQuery(editor.view, SlashCommandPluginKey);
      dismissSuggestionAndQuery(editor.view, MentionPluginKey);
      setLinkPosition(null);
    });
  }, [editor]);

  // The slash menu asks for the link popover through a DOM event so the menu
  // items stay independent of this component's state.
  useEffect(() => {
    if (!editor) return;

    const element = editor.view.dom;
    const handleOpenLinkEditor = () => openLinkEditor();

    element.addEventListener(OPEN_LINK_EDITOR_EVENT, handleOpenLinkEditor);
    return () =>
      element.removeEventListener(OPEN_LINK_EDITOR_EVENT, handleOpenLinkEditor);
  }, [editor, openLinkEditor]);

  // Track the selection so the formatting and table toolbars can follow it.
  useEffect(() => {
    if (!editor) return;

    const updateToolbar = () => {
      const { state, view } = editor;
      const { empty, from, to } = state.selection;

      if (
        toolbar === "fixed" ||
        empty ||
        !view.hasFocus() ||
        editor.isActive("codeBlock")
      ) {
        setToolbarPosition(null);
        return;
      }

      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      const center = (start.left + end.right) / 2;

      setToolbarPosition({
        top: Math.max(8, start.top - 52),
        left: clampToViewport(center - TOOLBAR_WIDTH / 2, TOOLBAR_WIDTH),
      });
    };

    const updateTableToolbar = () => {
      if (!editor.isActive("table")) {
        setTableToolbarPosition(null);
        return;
      }

      const { view, state } = editor;
      const $pos = state.doc.resolve(state.selection.from);
      let tableDepth = -1;

      for (let depth = $pos.depth; depth > 0; depth -= 1) {
        if ($pos.node(depth).type.name === "table") {
          tableDepth = depth;
          break;
        }
      }

      if (tableDepth < 0) {
        setTableToolbarPosition(null);
        return;
      }

      const tableDom = view.nodeDOM($pos.before(tableDepth));
      if (!(tableDom instanceof HTMLElement)) {
        setTableToolbarPosition(null);
        return;
      }

      const wrapper = tableDom.classList.contains("tableWrapper")
        ? tableDom
        : (tableDom.closest(".tableWrapper") ?? tableDom);
      const rect = wrapper.getBoundingClientRect();

      setTableToolbarPosition({
        top: Math.max(8, rect.top - 44),
        left: clampToViewport(rect.left, TABLE_TOOLBAR_WIDTH),
      });
    };

    const hideFormatToolbar = () => setToolbarPosition(null);
    const hideTableToolbar = () => setTableToolbarPosition(null);
    const handleScrollOrResize = () => {
      hideFormatToolbar();
      updateTableToolbar();
    };

    editor.on("selectionUpdate", updateToolbar);
    editor.on("selectionUpdate", updateTableToolbar);
    editor.on("blur", hideFormatToolbar);
    editor.on("blur", hideTableToolbar);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    updateTableToolbar();

    return () => {
      editor.off("selectionUpdate", updateToolbar);
      editor.off("selectionUpdate", updateTableToolbar);
      editor.off("blur", hideFormatToolbar);
      editor.off("blur", hideTableToolbar);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [editor, toolbar]);

  useEffect(() => {
    if (linkPosition) linkInputRef.current?.focus();
  }, [linkPosition]);

  const [, setFixedToolbarTick] = useState(0);
  useEffect(() => {
    if (!editor || toolbar !== "fixed") return;
    const bump = () => setFixedToolbarTick((tick) => tick + 1);
    editor.on("selectionUpdate", bump);
    return () => {
      editor.off("selectionUpdate", bump);
    };
  }, [editor, toolbar]);

  const applyLink = () => {
    if (!editor) return;

    const href = normalizeUrl(linkDraft);
    if (!href) {
      setLinkPosition(null);
      return;
    }

    const { empty } = editor.state.selection;

    if (empty) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: linkDraft.trim(),
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }

    setLinkPosition(null);
    setLinkDraft("");
  };

  const removeLink = () => {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkPosition(null);
  };

  if (!editor) {
    return (
      <div className="px-2 py-4 text-sm text-muted-foreground">
        Loading editor...
      </div>
    );
  }

  let toolbarButtons = [
    {
      label: "Bold",
      icon: Bold,
      isActive: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      icon: Italic,
      isActive: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Strikethrough",
      icon: Strikethrough,
      isActive: editor.isActive("strike"),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: "Inline code",
      icon: Code,
      isActive: editor.isActive("code"),
      run: () => editor.chain().focus().toggleCode().run(),
    },
    {
      label: "Highlight",
      icon: Highlighter,
      isActive: editor.isActive("highlight"),
      run: () => editor.chain().focus().toggleHighlight().run(),
    },
    {
      label: "Heading 1",
      icon: Heading1,
      isActive: editor.isActive("heading", { level: 1 }),
      run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: "Heading 2",
      icon: Heading2,
      isActive: editor.isActive("heading", { level: 2 }),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Heading 3",
      icon: Heading3,
      isActive: editor.isActive("heading", { level: 3 }),
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: "Bulleted list",
      icon: List,
      isActive: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      icon: ListOrdered,
      isActive: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "To-do list",
      icon: CheckSquare,
      isActive: editor.isActive("taskList"),
      run: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      label: "Code block",
      icon: Code2,
      isActive: editor.isActive("codeBlock"),
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
  ];

  if (toolbar !== "fixed") {
    // The floating bubble stays smaller; extra block controls live in slash commands.
    const floatingLabels = new Set([
      "Bold",
      "Italic",
      "Strikethrough",
      "Inline code",
      "Highlight",
      "Heading 1",
      "Heading 2",
      "Bulleted list",
    ]);
    toolbarButtons = toolbarButtons.filter((button) =>
      floatingLabels.has(button.label),
    );
  }

  const tableToolbarGroups = [
    [
      {
        label: "Add column before",
        icon: BetweenVerticalStart,
        disabled: !editor.can().addColumnBefore(),
        run: () => editor.chain().focus().addColumnBefore().run(),
      },
      {
        label: "Add column after",
        icon: BetweenVerticalEnd,
        disabled: !editor.can().addColumnAfter(),
        run: () => editor.chain().focus().addColumnAfter().run(),
      },
      {
        label: "Delete column",
        icon: Minus,
        disabled: !editor.can().deleteColumn(),
        run: () => editor.chain().focus().deleteColumn().run(),
      },
    ],
    [
      {
        label: "Add row before",
        icon: BetweenHorizontalStart,
        disabled: !editor.can().addRowBefore(),
        run: () => editor.chain().focus().addRowBefore().run(),
      },
      {
        label: "Add row after",
        icon: BetweenHorizontalEnd,
        disabled: !editor.can().addRowAfter(),
        run: () => editor.chain().focus().addRowAfter().run(),
      },
      {
        label: "Delete row",
        icon: Minus,
        disabled: !editor.can().deleteRow(),
        run: () => editor.chain().focus().deleteRow().run(),
      },
    ],
    [
      {
        label: "Toggle header row",
        icon: Heading,
        disabled: !editor.can().toggleHeaderRow(),
        run: () => editor.chain().focus().toggleHeaderRow().run(),
      },
      {
        label: "Toggle header column",
        icon: Columns2,
        disabled: !editor.can().toggleHeaderColumn(),
        run: () => editor.chain().focus().toggleHeaderColumn().run(),
      },
    ],
    [
      {
        label: "Merge selected cells",
        icon: TableCellsMerge,
        disabled: !editor.can().mergeCells(),
        run: () => editor.chain().focus().mergeCells().run(),
      },
      {
        label: "Split cell",
        icon: TableCellsSplit,
        disabled: !editor.can().splitCell(),
        run: () => editor.chain().focus().splitCell().run(),
      },
    ],
  ];

  return (
    <>
      {toolbar === "fixed" ? (
        <div className="flex h-full min-h-0 flex-col">
          <div
            className="mb-2 flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border pb-2"
            onMouseDown={(event) => event.preventDefault()}
          >
            {toolbarButtons.map((button) => {
              const Icon = button.icon;
              return (
                <button
                  key={button.label}
                  type="button"
                  title={button.label}
                  onClick={button.run}
                  className={`flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground ${
                    button.isActive ? "bg-accent text-accent-foreground" : ""
                  }`}
                >
                  <Icon className="size-3.5" />
                </button>
              );
            })}

            <span className="mx-0.5 h-5 w-px bg-border" />

            <button
              type="button"
              title="Add link"
              onClick={openLinkEditor}
              className={`flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground ${
                editor.isActive("link") ? "bg-accent text-accent-foreground" : ""
              }`}
            >
              <Link2 className="size-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <EditorContent editor={editor} className="min-h-full" />
          </div>
        </div>
      ) : (
        <EditorContent editor={editor} />
      )}

      {toolbar === "float" && toolbarPosition && (
        <div
          className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-xl"
          style={{ top: toolbarPosition.top, left: toolbarPosition.left }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {toolbarButtons.map((button) => {
            const Icon = button.icon;
            return (
              <button
                key={button.label}
                type="button"
                title={button.label}
                onClick={button.run}
                className={`flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground ${
                  button.isActive ? "bg-accent text-accent-foreground" : ""
                }`}
              >
                <Icon className="size-4" />
              </button>
            );
          })}

          <span className="mx-0.5 h-5 w-px bg-border" />

          <button
            type="button"
            title="Add link"
            onClick={openLinkEditor}
            className={`flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground ${
              editor.isActive("link") ? "bg-accent text-accent-foreground" : ""
            }`}
          >
            <Link2 className="size-4" />
          </button>
        </div>
      )}

      {tableToolbarPosition && (
        <div
          className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-xl"
          style={{
            top: tableToolbarPosition.top,
            left: tableToolbarPosition.left,
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {tableToolbarGroups.map((group, groupIndex) => (
            <div key={groupIndex} className="flex items-center gap-0.5">
              {groupIndex > 0 && <span className="mx-0.5 h-5 w-px bg-border" />}
              {group.map((button) => {
                const Icon = button.icon;
                return (
                  <button
                    key={button.label}
                    type="button"
                    title={button.label}
                    disabled={button.disabled}
                    onClick={button.run}
                    className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-35"
                  >
                    <Icon className="size-4" />
                  </button>
                );
              })}
            </div>
          ))}

          <span className="mx-0.5 h-5 w-px bg-border" />

          <button
            type="button"
            title="Delete table"
            disabled={!editor.can().deleteTable()}
            onClick={() => editor.chain().focus().deleteTable().run()}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-destructive disabled:pointer-events-none disabled:opacity-35"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      )}

      {linkPosition && (
        <>
          <div
            className="fixed inset-0 z-50"
            onMouseDown={() => setLinkPosition(null)}
          />
          <div
            className="fixed z-[60] w-80 rounded-lg border border-border bg-popover p-2 shadow-xl"
            style={{ top: linkPosition.top, left: linkPosition.left }}
          >
            <div className="flex items-center gap-1">
              <input
                ref={linkInputRef}
                value={linkDraft}
                onChange={(event) => setLinkDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyLink();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setLinkPosition(null);
                  }
                }}
                placeholder="Paste or type a link"
                className="min-w-0 flex-1 rounded-md border border-border bg-input/30 px-2 py-1.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/40"
              />

              <button
                type="button"
                title="Apply link"
                onClick={applyLink}
                className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Check className="size-4" />
              </button>

              {editor.isActive("link") && (
                <>
                  <a
                    href={editor.getAttributes("link").href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open link"
                    className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <ExternalLink className="size-4" />
                  </a>

                  <button
                    type="button"
                    title="Remove link"
                    onClick={removeLink}
                    className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                  >
                    <Unlink className="size-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
