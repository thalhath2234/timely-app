"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Editor, ReactRenderer } from "@tiptap/react";
import { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import {
  AtSign,
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Table2,
  Type,
} from "lucide-react";
import { placeCaretPopup, watchCaretPopup } from "./caretPopup";
import { SlashCommandItem } from "./slashCommand";

const MENU_WIDTH = 300;
const MENU_MAX_HEIGHT = 330;

/** Emitted on the editor DOM node so the editor can open its link popover. */
export const OPEN_LINK_EDITOR_EVENT = "timely:open-link-editor";

export function createSlashItems(): SlashCommandItem[] {
  return [
    {
      title: "Text",
      description: "Plain paragraph",
      icon: Type,
      keywords: ["paragraph", "plain", "body"],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setParagraph().run(),
    },
    {
      title: "Heading 1",
      description: "Large section heading",
      icon: Heading1,
      keywords: ["h1", "title", "big"],
      run: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: 1 })
          .run(),
    },
    {
      title: "Heading 2",
      description: "Medium section heading",
      icon: Heading2,
      keywords: ["h2", "subtitle"],
      run: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: 2 })
          .run(),
    },
    {
      title: "Heading 3",
      description: "Small section heading",
      icon: Heading3,
      keywords: ["h3"],
      run: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: 3 })
          .run(),
    },
    {
      title: "Bulleted list",
      description: "Simple bulleted list",
      icon: List,
      keywords: ["unordered", "point", "ul", "bullet"],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      title: "Numbered list",
      description: "List with ordering",
      icon: ListOrdered,
      keywords: ["ordered", "ol", "number"],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      title: "To-do list",
      description: "Track tasks with checkboxes",
      icon: CheckSquare,
      keywords: ["todo", "task", "checkbox", "check"],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleTaskList().run(),
    },
    {
      title: "Quote",
      description: "Capture a quotation",
      icon: Quote,
      keywords: ["blockquote", "citation"],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      title: "Code block",
      description: "Monospaced code with syntax",
      icon: Code2,
      keywords: ["snippet", "pre", "monospace"],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    },
    {
      title: "Table",
      description: "Insert a 3x3 table",
      icon: Table2,
      keywords: ["grid", "rows", "columns"],
      run: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      title: "Divider",
      description: "Visually separate sections",
      icon: Minus,
      keywords: ["hr", "line", "separator", "rule"],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
    {
      title: "Link",
      description: "Add a hyperlink",
      icon: Link2,
      keywords: ["url", "href", "hyperlink", "anchor"],
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        editor.view.dom.dispatchEvent(new CustomEvent(OPEN_LINK_EDITOR_EVENT));
      },
    },
    {
      title: "Mention",
      description: "Reference a doc, sheet, task or project",
      icon: AtSign,
      keywords: ["@", "reference", "link", "doc", "sheet", "task", "project"],
      // Typing the character is what opens the mention picker.
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).insertContent("@").run(),
    },
  ];
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
      popup.style.position = "fixed";
      popup.style.zIndex = "60";
      popup.appendChild(component.element);
      document.body.appendChild(popup);

      lastGetRect = props.clientRect;
      stopWatch = watchCaretPopup(popup, place);
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
