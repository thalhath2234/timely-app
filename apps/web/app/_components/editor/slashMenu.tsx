"use client";

import { Editor, Range, ReactRenderer } from "@tiptap/react";
import {
  exitSuggestion,
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";
import {
  AtSign,
  Box,
  CheckSquare,
  Code2,
  FileText,
  Info,
  Map,
  Radical,
  SquareSigma,
  Superscript,
  Tags,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Link2,
  List,
  ListOrdered,
  Minus,
  Table2,
  Workflow,
  Type,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { dismissOnOutsidePointer, placeCaretPopup, watchCaretPopup } from "./caretPopup";
import { SlashCommandItem, SlashCommandPluginKey } from "./slashCommand";

/** Starter content for the blocks drawn under their source. */
export const DIAGRAM_SAMPLE = "flowchart TD\n  A[Start] --> B[Next step]";
export const MAP_SAMPLE = '{\n  "type": "Feature",\n  "geometry": {\n    "type": "Polygon",\n    "coordinates": [[[-0.2, 51.45], [0.05, 51.45], [0.05, 51.6], [-0.2, 51.6], [-0.2, 51.45]]]\n  }\n}';
export const MODEL_SAMPLE = "solid pyramid\n  facet normal 0 0 -1\n    outer loop\n      vertex 0 0 0\n      vertex 1 0 0\n      vertex 1 1 0\n    endloop\n  endfacet\n  facet normal 0 0 -1\n    outer loop\n      vertex 0 0 0\n      vertex 1 1 0\n      vertex 0 1 0\n    endloop\n  endfacet\n  facet normal 0 -1 0\n    outer loop\n      vertex 0 0 0\n      vertex 0.5 0.5 1\n      vertex 1 0 0\n    endloop\n  endfacet\n  facet normal 1 0 0\n    outer loop\n      vertex 1 0 0\n      vertex 0.5 0.5 1\n      vertex 1 1 0\n    endloop\n  endfacet\n  facet normal 0 1 0\n    outer loop\n      vertex 1 1 0\n      vertex 0.5 0.5 1\n      vertex 0 1 0\n    endloop\n  endfacet\n  facet normal -1 0 0\n    outer loop\n      vertex 0 1 0\n      vertex 0.5 0.5 1\n      vertex 0 0 0\n    endloop\n  endfacet\nendsolid pyramid";

const MENU_WIDTH = 300;
const MENU_MAX_HEIGHT = 330;

/** Emitted on the editor DOM node so the editor can open its link popover. */
export const OPEN_LINK_EDITOR_EVENT = "timely:open-link-editor";

function clampedRange(editor: Editor, range: Range): Range {
  const size = editor.state.doc.content.size;
  const from = Math.max(0, Math.min(range.from, size));
  const to = Math.max(from, Math.min(range.to, size));
  return { from, to };
}

function runSlash(
  editor: Editor,
  range: Range,
  apply: (chain: ReturnType<Editor["chain"]>) => boolean,
) {
  return apply(editor.chain().focus().deleteRange(clampedRange(editor, range)));
}

export function createSlashItems(options?: {
  onCreateSubpage?: (props: { editor: Editor; range: Range }) => void;
}): SlashCommandItem[] {
  const items: SlashCommandItem[] = [
    {
      title: "Text",
      description: "Plain paragraph",
      icon: Type,
      keywords: ["paragraph", "plain", "body"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) => chain.setParagraph().run()),
    },
    {
      title: "Heading 1",
      description: "Large section heading",
      icon: Heading1,
      keywords: ["h1", "title", "big"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) =>
          chain.setNode("heading", { level: 1 }).run(),
        ),
    },
    {
      title: "Heading 2",
      description: "Medium section heading",
      icon: Heading2,
      keywords: ["h2", "subtitle"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) =>
          chain.setNode("heading", { level: 2 }).run(),
        ),
    },
    {
      title: "Heading 3",
      description: "Small section heading",
      icon: Heading3,
      keywords: ["h3"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) =>
          chain.setNode("heading", { level: 3 }).run(),
        ),
    },
    {
      title: "Bulleted list",
      description: "Bullets — type . then space",
      icon: List,
      keywords: ["unordered", "point", "ul", "bullet"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) => chain.toggleBulletList().run()),
    },
    {
      title: "Numbered list",
      description: "List with ordering",
      icon: ListOrdered,
      keywords: ["ordered", "ol", "number"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) => chain.toggleOrderedList().run()),
    },
    {
      title: "To-do list",
      description: "Track tasks with checkboxes",
      icon: CheckSquare,
      keywords: ["todo", "task", "checkbox", "check"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) => chain.toggleTaskList().run()),
    },
    {
      title: "Code block",
      description: "Monospace code with syntax",
      icon: Code2,
      keywords: ["snippet", "pre", "monospace"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) => chain.toggleCodeBlock().run()),
    },
    {
      title: "Image",
      description: "Upload a picture, or paste or drop one",
      icon: ImageIcon,
      keywords: ["image", "picture", "photo", "upload", "img", "screenshot"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) => chain.pickImage().run()),
    },
    {
      title: "Diagram",
      description: "Mermaid flowchart, sequence or other diagram",
      icon: Workflow,
      keywords: ["mermaid", "flowchart", "chart", "graph", "sequence"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) =>
          chain
            .setCodeBlock({ language: "mermaid" })
            .insertContent(DIAGRAM_SAMPLE)
            .run(),
        ),
    },
    {
      title: "Callout",
      description: "Note, tip, warning or caution box",
      icon: Info,
      keywords: ["note", "tip", "warning", "caution", "important", "admonition", "alert", "quote", "blockquote"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) => chain.setCallout({ kind: "note" }).run()),
    },
    {
      title: "Formula",
      description: "Inline math, like $E = mc^2$",
      icon: Radical,
      keywords: ["math", "latex", "tex", "katex", "inline"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) => chain.insertMathInline().run()),
    },
    {
      title: "Equation",
      description: "A displayed formula on its own line",
      icon: SquareSigma,
      keywords: ["math", "latex", "tex", "katex", "block", "display"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) => chain.setMathBlock().run()),
    },
    {
      title: "Footnote",
      description: "A numbered note at the end of the page",
      icon: Superscript,
      keywords: ["footnote", "reference", "citation", "note"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) => chain.insertFootnote().run()),
    },
    {
      title: "Properties",
      description: "Key: value lines at the top (Markdown frontmatter)",
      icon: Tags,
      keywords: ["frontmatter", "yaml", "metadata", "tags", "properties"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) => chain.editFrontmatter().run()),
    },
    {
      title: "Map",
      description: "Draw GeoJSON or TopoJSON shapes",
      icon: Map,
      keywords: ["geojson", "topojson", "map", "geo", "location"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) =>
          chain
            .setCodeBlock({ language: "geojson" })
            .insertContent(MAP_SAMPLE)
            .run(),
        ),
    },
    {
      title: "3D model",
      description: "Show an ASCII STL model",
      icon: Box,
      keywords: ["stl", "3d", "model", "mesh", "three"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) =>
          chain
            .setCodeBlock({ language: "stl" })
            .insertContent(MODEL_SAMPLE)
            .run(),
        ),
    },
    {
      title: "Table",
      description: "Insert a 3x3 table",
      icon: Table2,
      keywords: ["grid", "rows", "columns"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) =>
          chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        ),
    },
    {
      title: "Divider",
      description: "Line — type - then space",
      icon: Minus,
      keywords: ["hr", "line", "separator", "rule"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) => chain.setHorizontalRule().run()),
    },
    {
      title: "Link",
      description: "Add a hyperlink",
      icon: Link2,
      keywords: ["url", "href", "hyperlink", "anchor"],
      run: ({ editor, range }) => {
        runSlash(editor, range, (chain) => chain.run());
        editor.view.dom.dispatchEvent(new CustomEvent(OPEN_LINK_EDITOR_EVENT));
      },
    },
    {
      title: "Mention",
      description: "Reference a doc, sheet, task or project",
      icon: AtSign,
      keywords: ["@", "reference", "link", "doc", "sheet", "task", "project"],
      run: ({ editor, range }) =>
        runSlash(editor, range, (chain) => chain.insertContent("@").run()),
    },
  ];

  const onCreateSubpage = options?.onCreateSubpage;
  if (onCreateSubpage) {
    items.push({
      title: "Page",
      description: "Nest a new page under this one and link it here",
      icon: FileText,
      keywords: ["subpage", "sub-page", "child", "nested", "page"],
      run: ({ editor, range }) => {
        onCreateSubpage({
          editor,
          range: clampedRange(editor, range),
        });
      },
    });
  }

  return items;
}

export function filterSlashItems(items: SlashCommandItem[], query: string) {
  const search = query.trim().toLowerCase();
  if (!search) return items;

  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(search) ||
      item.keywords.some((keyword) => keyword.includes(search)),
  );
}

export interface SlashMenuHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

type SlashMenuProps = SuggestionProps<SlashCommandItem>;

const SlashMenuList = forwardRef<SlashMenuHandle, SlashMenuProps>(
  function SlashMenuList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => setSelectedIndex(0), [items]);

    useLayoutEffect(() => {
      listRef.current
        ?.querySelector('[data-selected="true"]')
        ?.scrollIntoView({ block: "nearest" });
    }, [selectedIndex]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false;

        if (event.key === "ArrowUp") {
          setSelectedIndex((index) => (index + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((index) => (index + 1) % items.length);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          command(items[selectedIndex]);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="w-75 rounded-xl border border-border bg-popover px-3 py-2.5 text-sm text-muted-foreground shadow-xl">
          No blocks found
        </div>
      );
    }

    return (
      <div
        ref={listRef}
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={(event) => event.preventDefault()}
        className="w-75 max-h-82 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl"
      >
        {items.map((item, index) => {
          const Icon = item.icon;
          const isSelected = index === selectedIndex;

          return (
            <button
              key={item.title}
              type="button"
              data-selected={isSelected}
              onMouseEnter={() => setSelectedIndex(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => command(item)}
              className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${
                isSelected ? "bg-accent text-accent-foreground" : ""
              }`}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {item.title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {item.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    );
  },
);

/**
 * Renders the slash menu into a fixed-position element tracking the caret.
 * Flips above the caret when there is not enough room below.
 */
export function createSlashRenderer() {
  let component: ReactRenderer<SlashMenuHandle, SlashMenuProps> | null = null;
  let popup: HTMLDivElement | null = null;
  let lastGetRect: (() => DOMRect | null) | null | undefined = null;
  let stopWatch: (() => void) | null = null;
  let stopOutside: (() => void) | null = null;

  const place = () => {
    if (!popup) return;
    placeCaretPopup(popup, lastGetRect, {
      width: MENU_WIDTH,
      maxHeight: MENU_MAX_HEIGHT,
    });
  };

  const destroy = () => {
    stopWatch?.();
    stopWatch = null;
    stopOutside?.();
    stopOutside = null;
    lastGetRect = null;
    popup?.remove();
    component?.destroy();
    popup = null;
    component = null;
  };

  return {
    onStart: (props: SlashMenuProps) => {
      component = new ReactRenderer(SlashMenuList, {
        props,
        editor: props.editor as Editor,
      });

      popup = document.createElement("div");
      popup.dataset.caretPopup = "true";
      popup.style.position = "fixed";
      popup.style.zIndex = "80";
      popup.appendChild(component.element);
      document.body.appendChild(popup);

      lastGetRect = props.clientRect;
      stopWatch = watchCaretPopup(popup, place);
      stopOutside = dismissOnOutsidePointer(popup, () =>
        exitSuggestion(props.editor.view, SlashCommandPluginKey),
      );
    },

    onUpdate: (props: SlashMenuProps) => {
      component?.updateProps(props);
      lastGetRect = props.clientRect;
      place();
    },

    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (props.event.key === "Escape") {
        destroy();
        return true;
      }
      return component?.ref?.onKeyDown(props) ?? false;
    },

    onExit: destroy,
  };
}
