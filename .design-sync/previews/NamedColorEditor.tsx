import { NamedColorEditor } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

type Item = { id: string; name: string; color: string; badge?: string };

const STATUSES: Item[] = [
  { id: "st_backlog", name: "Backlog", color: "#889096" },
  { id: "st_todo", name: "Todo", color: "#889096", badge: "Default" },
  { id: "st_progress", name: "In Progress", color: "#FFB224" },
  { id: "st_blocked", name: "Blocked", color: "#E5484D" },
  { id: "st_done", name: "Completed", color: "#30A66D" },
];

const LABELS: Item[] = [
  { id: "lbl_research", name: "Research", color: "#0091FF" },
  { id: "lbl_ui", name: "UI", color: "#6E56CF" },
  { id: "lbl_a11y", name: "Accessibility", color: "#F76808" },
  { id: "lbl_quick_win", name: "Quick win", color: "#30A66D" },
];

/** Local list state so add/edit/delete work like the workspace mutations would. */
function useItems(initial: Item[]) {
  const [items, setItems] = useState(initial);
  return {
    items,
    onCreate: async (item: { name: string; color: string }) => setItems((list) => [...list, { id: `new_${list.length}`, ...item }]),
    onUpdate: async (id: string, item: { name: string; color: string }) =>
      setItems((list) => list.map((row) => (row.id === id ? { ...row, ...item } : row))),
    onDelete: async (id: string) => setItems((list) => list.filter((row) => row.id !== id)),
  };
}

/** Clicks the first button matching the selector (and text, when given) once on mount. */
function ClickOnMount({ selector, text, children }: { selector: string; text?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>(selector) ?? []);
    buttons.find((b) => !text || b.textContent?.trim() === text)?.click();
  }, [selector, text]);
  return <div ref={ref}>{children}</div>;
}

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-background p-6" style={{ width: 640 }}>{children}</div>
);

export const Statuses = () => {
  const props = useItems(STATUSES);
  return (
    <Frame>
      <NamedColorEditor title="Statuses" description="Statuses used by tasks and projects in this workspace." emptyLabel="No statuses yet." {...props} />
    </Frame>
  );
};

export const Labels = () => {
  const props = useItems(LABELS);
  return (
    <Frame>
      <NamedColorEditor title="Labels" description="Reusable color labels you can attach to tasks." emptyLabel="No labels yet." {...props} />
    </Frame>
  );
};

export const EditingRow = () => {
  const props = useItems(LABELS);
  return (
    <Frame>
      <ClickOnMount selector='button[aria-label="Edit Accessibility"]'>
        <NamedColorEditor title="Labels" description="Reusable color labels you can attach to tasks." emptyLabel="No labels yet." {...props} />
      </ClickOnMount>
    </Frame>
  );
};

export const NameRequired = () => {
  const props = useItems(LABELS.slice(0, 2));
  return (
    <Frame>
      <ClickOnMount selector="button" text="Add">
        <NamedColorEditor title="Labels" description="Reusable color labels you can attach to tasks." emptyLabel="No labels yet." {...props} />
      </ClickOnMount>
    </Frame>
  );
};

export const Empty = () => {
  const props = useItems([]);
  return (
    <Frame>
      <NamedColorEditor title="Labels" description="Reusable color labels you can attach to tasks." emptyLabel="No labels yet." {...props} />
    </Frame>
  );
};
