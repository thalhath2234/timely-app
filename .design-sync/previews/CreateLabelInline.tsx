import { CreateLabelInline, ListGroup, ListRow, Select } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

const t = "2024-05-01T09:00:00Z";
const label = (id: string, name: string, color: string) => ({ id, name, color, workspaceId: "ws_studio", createdAt: t, updatedAt: t });
const LABELS = [
  label("lbl_research", "Research", "#0091FF"),
  label("lbl_ui", "UI", "#6E56CF"),
  label("lbl_a11y", "Accessibility", "#F76808"),
  label("lbl_quick_win", "Quick win", "#30A66D"),
];

/** The Labels card of the create dialog: the picker row, then "New label" as the card's last row. */
function TaskLabels({ workspaceId }: { workspaceId?: string }) {
  const [labels, setLabels] = useState(workspaceId ? LABELS : []);
  const [ids, setIds] = useState(workspaceId ? ["lbl_ui"] : []);
  return (
    <div style={{ width: 320 }}>
      <ListGroup>
        <ListRow label="Labels">
          <Select
            variant="row"
            aria-label="Labels"
            value=""
            values={ids}
            placeholder={labels.length ? "None" : "No labels yet"}
            onChange={(id) => setIds((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]))}
            options={labels.map((item) => ({ value: item.id, label: item.name, color: item.color }))}
          />
        </ListRow>
        <CreateLabelInline
          variant="row"
          workspaceId={workspaceId}
          onCreated={(created) => {
            setLabels((list) => [...list, created]);
            setIds((list) => [...list, created.id]);
          }}
        />
      </ListGroup>
    </div>
  );
}

export const InTaskSidebar = () => <div className="p-4"><TaskLabels workspaceId="ws_studio" /></div>;

export const NoWorkspaceSelected = () => <div className="p-4"><TaskLabels /></div>;

/** Types a label name into the inline input, as if the person had started creating one. */
function TypeName({ name, children }: { name: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const open = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) => button.textContent?.includes("New label"));
    open?.click();
    const timer = window.setTimeout(() => {
      const input = ref.current?.querySelector<HTMLInputElement>('input[placeholder="Label name"]');
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, name);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, 50);
    return () => window.clearTimeout(timer);
  }, [name]);
  return <div ref={ref}>{children}</div>;
}

export const TypingName = () => (
  <div className="p-4">
    <TypeName name="Client feedback">
      <TaskLabels workspaceId="ws_studio" />
    </TypeName>
  </div>
);
