"use client";

import { useSidebarStore } from "@/app/_store/sidebarStore";
import { useToastStore } from "@/app/_store/toastStore";
import { DocContent } from "@/app/_types/types";
import { openTasksEntityHref } from "@/app/utils/entityDetail";
import { useMentionItems } from "@/app/utils/hooks/useMentionItems";
import CodeBlock from "@tiptap/extension-code-block";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Placeholder } from "@tiptap/extensions";
import {
  Editor,
  EditorContent,
  Extensions,
  JSONContent,
  Range,
  ReactNodeViewRenderer,
  useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AtSign,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Box,
  Check,
  CheckSquare,
  Code,
  Code2,
  ExternalLink,
  Heading1,
  Heading2,
  Heading3,
  Info,
  Highlighter,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListCollapse,
  TextSearch,
  MonitorPlay,
  Bookmark as BookmarkIcon,
  ListOrdered,
  Map as MapIcon,
  Minus,
  Radical,
  SquareSigma,
  Strikethrough,
  Superscript,
  Tags,
  Trash2,
  Unlink,
  Workflow,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AutoCapitalize } from "./autoCapitalize";
import { Callout } from "./callout";
import { DocImage } from "./docImage";
import { Details, DetailsSummary } from "./details";
import { BlockHandle } from "./blockHandle";
import { Bookmark, Embed } from "./linkBlocks";
import { FindReplace } from "./findReplace";
import FindBar from "./findBar";
import CodeBlockView from "./codeBlockView";
import { Footnote, FootnoteRef } from "./footnotes";
import { DocumentWithFrontmatter, Frontmatter } from "./frontmatter";
import { MathBlock, MathInline } from "./mathNodes";
import { WikiLink, wikiLinkPage } from "./wikiLink";
import { CodeHighlight } from "./codeHighlight";
import { dismissSuggestionAndQuery } from "./dismissSuggestion";
import { DotBulletShortcut } from "./dotBullet";
import { Mention, MentionPluginKey } from "./mention";
import { createMentionRenderer, filterMentionItems } from "./mentionMenu";
import { SlashCommand, SlashCommandPluginKey } from "./slashCommand";
import {
  DIAGRAM_SAMPLE,
  MAP_SAMPLE,
  MODEL_SAMPLE,
  OPEN_LINK_EDITOR_EVENT,
  createSlashItems,
  createSlashRenderer,
  filterSlashItems,
} from "./slashMenu";

const LINK_POPOVER_WIDTH = 320;
const TOOLBAR_WIDTH = 340;
const TABLE_TOOLBAR_WIDTH = 260;

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
  /** "fixed" pins formatting controls above the editor. "float" shows them on selection. */
  toolbar?: "float" | "fixed";
  enableSlashCommands?: boolean;
  enableMentions?: boolean;
  autoFocus?: boolean;
  /** When this changes, the editor reloads `content`. Local drafts are otherwise kept. */
  syncKey?: number | string;
  /** Docs only: slash "Page" creates a child of this page and links it. */
  onCreateSubpage?: (props: { editor: Editor; range: Range }) => void | Promise<void>;
  /** False shows the doc read-only, without toolbars (version previews). */
  editable?: boolean;
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
/** Mutable holder for the mention list so the TipTap suggestion plugin (which
 * lives outside React) can read the latest items without rebuilding. */
function createHandlerBox<T>(initial: T) {
  let value = initial;
  return {
    get: () => value,
    set: (next: T) => {
      value = next;
    },
  };
}

function createMentionBox(initial: ReturnType<typeof useMentionItems>) {
  let items = initial;
  return {
    get: () => items,
    set: (next: ReturnType<typeof useMentionItems>) => {
      items = next;
    },
  };
}

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
  toolbar = "fixed",
  enableSlashCommands = true,
  enableMentions = true,
  autoFocus = false,
  syncKey = 0,
  onCreateSubpage,
  editable = true,
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
  const [findOpen, setFindOpen] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  // The suggestion plugin lives outside React, so it reads the latest list
  // through a stable mutable box (kept current in an effect) rather than being
  // rebuilt whenever the data refreshes.
  const mentionItems = useMentionItems();
  const [mentionBox] = useState(() => createMentionBox(mentionItems));
  // Only the presence of the handler decides whether the slash item exists;
  // the latest handler is read through a box (like mentions) when it runs, so
  // building the extension list never touches a ref during render.
  const [subpageBox] = useState(() => createHandlerBox(onCreateSubpage));
  const hasCreateSubpage = Boolean(onCreateSubpage);

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
      // Frontmatter may only come first, which the document node enforces.
      DocumentWithFrontmatter,
      StarterKit.configure({
        document: false,
        // The toolbar offers H1-H3; H4-H6 exist so Markdown imports keep them.
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: {
            class: "doc-link",
            rel: "noopener noreferrer nofollow",
          },
        },
      }),
      CodeBlock.extend({
        addNodeView() {
          return ReactNodeViewRenderer(CodeBlockView);
        },
      }).configure({ HTMLAttributes: { class: "doc-code-block" } }),
      CodeHighlight,
      AutoCapitalize,
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
          if (node.type.name === "detailsSummary") return "Toggle";
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
      // Inline like Markdown's ![alt](src), so imported images keep their place.
      DocImage.configure({ inline: true, HTMLAttributes: { class: "doc-image" } }),
      TableKit.configure({
        table: { resizable: true, handleWidth: 6, cellMinWidth: 80 },
      }),
      DotBulletShortcut,
      // Markdown extras (see docs/markdown.md): math, callouts, footnotes,
      // frontmatter and [[wiki links]].
      MathInline,
      MathBlock,
      Callout,
      Details,
      DetailsSummary,
      Embed,
      Bookmark,
      FootnoteRef,
      Footnote,
      Frontmatter,
      WikiLink,
    ];

    if (variant === "page") list.push(BlockHandle, FindReplace.configure({ onOpen: () => setFindOpen(true) }));

    if (enableSlashCommands) {
      list.push(
        SlashCommand.configure({
          suggestion: {
            char: "/",
            pluginKey: SlashCommandPluginKey,
            allow: ({ editor: slashEditor, range }) =>
              !isInsideTable(slashEditor, range.from),
            items: ({ query }: { query: string }) =>
              filterSlashItems(
                createSlashItems({
                  onCreateSubpage: hasCreateSubpage
                    ? (props) => {
                        void subpageBox.get()?.(props);
                      }
                    : undefined,
                }),
                query,
              ),
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
              filterMentionItems(mentionBox.get(), query),
            render: createMentionRenderer,
          },
        }),
      );
    }

    return list;
    // The mention list is read through the stable box, so it must not rebuild here.
  }, [enableMentions, enableSlashCommands, hasCreateSubpage, placeholder, variant, mentionBox, subpageBox]);

  const editor = useEditor({
    // The editor is rendered inside a client page, and Tiptap requires this
    // flag to avoid hydration mismatches in the Next.js app router.
    immediatelyRender: false,
    editable,
    autofocus: autoFocus ? "end" : false,
    extensions,
    content: toEditorContent(content),
    editorProps: {
      attributes: {
        class: `doc-editor-content focus:outline-none ${
          variant === "compact" ? "doc-editor-compact" : ""
        }`,
        autocapitalize: "sentences",
        spellcheck: "true",
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
    subpageBox.set(onCreateSubpage);
    mentionBox.set(mentionItems);
  });

  // Reload from props only when the parent says the source document changed
  // (remote watch, markdown import). Applying on blur/unfocus would restore
  // the initially loaded JSON and look like a reset after a successful save.
  const incomingContent = toEditorContent(content);
  const incomingContentKey = JSON.stringify(incomingContent);
  const appliedSyncKey = useRef<number | string | undefined>(undefined);

  useEffect(() => {
    if (!editor) return;
    if (appliedSyncKey.current === undefined) {
      appliedSyncKey.current = syncKey;
      return;
    }
    if (appliedSyncKey.current === syncKey) return;
    appliedSyncKey.current = syncKey;
    editor.commands.setContent(JSON.parse(incomingContentKey) as JSONContent, {
      emitUpdate: false,
    });
  }, [editor, incomingContentKey, syncKey]);

  useEffect(() => {
    editorRef.current = editor ?? null;
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);

  useEffect(() => {
    if (!editor || !enableMentions) return;

    const labels = new Map(
      mentionItems.map((item) => [`${item.entityType}:${item.id}`, item.label]),
    );
    const { tr, doc } = editor.state;
    let changed = false;

    doc.descendants((node, pos) => {
      if (node.type.name !== "mention" || !node.attrs.id) return;
      const entityType = (node.attrs.entityType ?? "doc") as string;
      const next = labels.get(`${entityType}:${node.attrs.id}`);
      if (!next || next === node.attrs.label) return;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: next });
      changed = true;
    });

    if (changed) {
      tr.setMeta("addToHistory", false);
      editor.view.dispatch(tr);
    }
  }, [editor, enableMentions, mentionItems]);

  // Mention chips are anchors, so they are routed client-side instead of
  // triggering a full page load.
  useEffect(() => {
    if (!editor) return;

    const element = editor.view.dom;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;

      // A footnote marker scrolls to its note.
      const footnoteRef = target?.closest?.("sup[data-footnote-ref]");
      if (footnoteRef) {
        const label = footnoteRef.getAttribute("data-label") ?? "";
        const note = element.querySelector(`[data-footnote="${CSS.escape(label)}"]`);
        if (note) {
          event.preventDefault();
          note.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }

      // A [[wiki link]] opens the doc with that title, if there is one.
      const wikiLink = target?.closest?.("a[data-wiki-link]");
      if (wikiLink) {
        event.preventDefault();
        event.stopPropagation();
        const page = wikiLinkPage(wikiLink.getAttribute("data-target") ?? "");
        const wanted = page.toLowerCase();
        const doc = mentionBox
          .get()
          .find((item) => item.entityType === "doc" && item.label.trim().toLowerCase() === wanted);
        if (doc) router.push(`/docs/${doc.id}`);
        else useToastStore.getState().show(`No page named "${page}" yet.`);
        return;
      }

      const mention = target?.closest?.("a[data-mention]");
      const internalLink =
        mention ??
        (target?.closest?.("a.doc-link") as HTMLElement | null | undefined);
      if (!internalLink) return;

      const href = internalLink.getAttribute("href");
      if (!href || href === "#") return;
      if (!mention && !href.startsWith("/")) return;

      event.preventDefault();
      event.stopPropagation();
      if (openTasksEntityHref(href, (next) => router.push(next, { scroll: false }))) {
        return;
      }
      router.push(href);
    };

    element.addEventListener("click", handleClick, true);
    return () => element.removeEventListener("click", handleClick, true);
  }, [editor, mentionBox, router]);

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

  // Blocks from the toolbar replace the caret's empty line, or go in as a new
  // block after the current one so the text being written stays as it is.
  const insertBlock = (content: JSONContent) => {
    const { $from } = editor.state.selection;
    const chain = editor.chain().focus();
    if ($from.parent.isTextblock && $from.parent.content.size === 0) {
      chain.insertContent(content).run();
    } else {
      chain.insertContentAt($from.after(), content).run();
    }
  };
  const codeSample = (language: string, text: string): JSONContent => ({
    type: "codeBlock",
    attrs: { language },
    content: [{ type: "text", text }],
  });

  let toolbarButtons: {
    label: string;
    icon: typeof Bold;
    isActive: boolean;
    run: () => void;
    startsGroup?: boolean;
  }[] = [
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
      label: "Callout",
      icon: Info,
      isActive: editor.isActive("callout"),
      run: () =>
        editor.isActive("callout")
          ? editor.chain().focus().lift("callout").run()
          : editor.chain().focus().setCallout({ kind: "note" }).run(),
    },
    {
      label: "Toggle",
      icon: ListCollapse,
      isActive: editor.isActive("details"),
      run: () => editor.chain().focus().toggleDetails().run(),
    },
    {
      label: "Code block",
      icon: Code2,
      isActive: editor.isActive("codeBlock"),
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: "Mention",
      icon: AtSign,
      isActive: false,
      run: () => editor.chain().focus().insertContent("@").run(),
    },
    {
      label: "Image",
      icon: ImageIcon,
      isActive: false,
      run: () => editor.chain().focus().pickImage().run(),
      startsGroup: true,
    },
    {
      label: "Embed",
      icon: MonitorPlay,
      isActive: false,
      run: () => insertBlock({ type: "embed" }),
    },
    {
      label: "Bookmark",
      icon: BookmarkIcon,
      isActive: false,
      run: () => insertBlock({ type: "bookmark" }),
    },
    {
      label: "Diagram",
      icon: Workflow,
      isActive: false,
      run: () => insertBlock(codeSample("mermaid", DIAGRAM_SAMPLE)),
    },
    {
      label: "Equation",
      icon: SquareSigma,
      isActive: editor.isActive("mathBlock"),
      run: () => insertBlock({ type: "mathBlock" }),
    },
    {
      label: "Formula",
      icon: Radical,
      isActive: false,
      run: () => editor.chain().focus().insertMathInline().run(),
    },
    {
      label: "Footnote",
      icon: Superscript,
      isActive: false,
      run: () => editor.chain().focus().insertFootnote().run(),
    },
    {
      label: "Map",
      icon: MapIcon,
      isActive: false,
      run: () => insertBlock(codeSample("geojson", MAP_SAMPLE)),
    },
    {
      label: "3D model",
      icon: Box,
      isActive: false,
      run: () => insertBlock(codeSample("stl", MODEL_SAMPLE)),
    },
    {
      label: "Properties",
      icon: Tags,
      isActive: editor.state.doc.firstChild?.type.name === "frontmatter",
      run: () => editor.chain().focus().editFrontmatter().run(),
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
      "Callout",
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
  ];

  if (!editable) {
    return <EditorContent editor={editor} />;
  }

  return (
    <>
      {toolbar === "fixed" ? (
        <div className="flex h-full min-h-0 flex-col">
          <div
            className="mb-3 flex shrink-0 flex-wrap items-center gap-0.5 rounded-lg border border-border bg-muted/20 p-1"
            onMouseDown={(event) => event.preventDefault()}
          >
            {toolbarButtons.map((button) => {
              const Icon = button.icon;
              return [
                button.startsGroup && (
                  <span key={`${button.label}-gap`} className="mx-0.5 h-5 w-px bg-border" />
                ),
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
                </button>,
              ];
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
            {variant === "page" && (
              <button
                type="button"
                title="Find and replace (Ctrl+F)"
                aria-label="Find and replace"
                onClick={() => setFindOpen(true)}
                className={`flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground ${
                  findOpen ? "bg-accent text-accent-foreground" : ""
                }`}
              >
                <TextSearch className="size-3.5" />
              </button>
            )}
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col">
            {findOpen && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
            {/* The page variant's left gutter holds the block drag handle, inside the scroll box so it is not clipped. */}
            <div className={`min-h-0 flex-1 overflow-y-auto ${variant === "page" ? "-ml-10 pl-10" : ""}`}>
              <EditorContent editor={editor} className="min-h-full" />
            </div>
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
