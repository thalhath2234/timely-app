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
import { FileText, FolderKanban, ListTodo, Sheet } from "lucide-react";
import { MentionEntityType } from "@/app/_types/types";
import { placeCaretPopup, watchCaretPopup } from "./caretPopup";
import { MENTION_TYPE_LABELS, MentionItem } from "./mention";

const MENU_WIDTH = 320;
const MENU_MAX_HEIGHT = 300;
const MAX_RESULTS = 8;

const ENTITY_ICONS = {
  doc: FileText,
  sheet: Sheet,
  task: ListTodo,
  project: FolderKanban,
} as const;

/**
 * Ranks by where the query matches: a prefix match on the title beats a match
 * in the middle, which beats a match on the hint only.
 */
export function filterMentionItems(items: MentionItem[], query: string) {
  const search = query.trim().toLowerCase();

  if (!search) {
    return items.slice(0, MAX_RESULTS);
  }

  const scored: { item: MentionItem; score: number }[] = [];

  for (const item of items) {
    const label = item.label.toLowerCase();
    const index = label.indexOf(search);

    if (index === 0) {
      scored.push({ item, score: 0 });
    } else if (index > 0) {
      scored.push({ item, score: 1 });
    } else if (item.hint?.toLowerCase().includes(search)) {
      scored.push({ item, score: 2 });
    }
  }

  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.item);
}

export interface MentionMenuHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

type MentionMenuProps = SuggestionProps<MentionItem>;

const MentionMenuList = forwardRef<MentionMenuHandle, MentionMenuProps>(
  function MentionMenuList({ items, command }, ref) {
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
        <div className="w-80 rounded-xl border border-border bg-popover px-3 py-2.5 text-sm text-muted-foreground shadow-xl">
          Nothing to mention yet
        </div>
      );
    }

    return (
      <div
        ref={listRef}
        className="w-80 max-h-75 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl"
      >
        {items.map((item, index) => {
          const Icon = ENTITY_ICONS[item.entityType as MentionEntityType];
          const isSelected = index === selectedIndex;

          return (
            <button
              key={`${item.entityType}-${item.id}`}
              type="button"
              data-selected={isSelected}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => command(item)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                isSelected ? "bg-accent text-accent-foreground" : ""
              }`}
            >
              <span
                data-entity-type={item.entityType}
                className="mention-swatch flex size-7 shrink-0 items-center justify-center rounded-md border"
              >
                {Icon ? <Icon className="size-3.5" /> : null}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {item.label || "Untitled"}
                </span>
                {item.hint && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.hint}
                  </span>
                )}
              </span>

              <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                {MENTION_TYPE_LABELS[item.entityType as MentionEntityType]}
              </span>
            </button>
          );
        })}
      </div>
    );
  },
);

/** Renders the mention picker into a fixed element that tracks the caret. */
export function createMentionRenderer() {
  let component: ReactRenderer<MentionMenuHandle, MentionMenuProps> | null =
    null;
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
    onStart: (props: MentionMenuProps) => {
      component = new ReactRenderer(MentionMenuList, {
        props,
        editor: props.editor as Editor,
      });

      popup = document.createElement("div");
      popup.style.position = "fixed";
      popup.style.zIndex = "70";
      popup.appendChild(component.element);
      document.body.appendChild(popup);

      lastGetRect = props.clientRect;
      stopWatch = watchCaretPopup(popup, place);
    },

    onUpdate: (props: MentionMenuProps) => {
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
