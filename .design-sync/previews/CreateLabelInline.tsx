import { CreateLabelInline, LabelPicker, ModalSidebar, SidebarSectionTitle } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

const t = "2024-05-01T09:00:00Z";
const label = (id: string, name: string, color: string) => ({ id, name, color, workspaceId: "ws_studio", createdAt: t, updatedAt: t });
const LABELS = [
  label("lbl_research", "Research", "#0091FF"),
  label("lbl_ui", "UI", "#6E56CF"),
  label("lbl_a11y", "Accessibility", "#F76808"),
  label("lbl_quick_win", "Quick win", "#30A66D"),
];

/** The Labels block of the task modal sidebar, where the inline creator sits under the picker. */
function TaskLabels({ workspaceId }: { workspaceId?: string }) {
  const [labels, setLabels] = useState(workspaceId ? LABELS : []);
  const [ids, setIds] = useState(workspaceId ? ["lbl_ui"] : []);
  return (
    <div className="flex overflow-hidden rounded-2xl border border-border bg-background" style={{ width: 320 }}>
      <ModalSidebar>
        <div className="pt-3">
          <SidebarSectionTitle>Labels</SidebarSectionTitle>
          <LabelPicker labels={labels} selectedIds={ids} emptyLabel="" onChange={setIds} />
          <CreateLabelInline
            workspaceId={workspaceId}
            onCreated={(created) => {
              setLabels((list) => [...list, created]);
              setIds((list) => [...list, created.id]);
            }}
          />
        </div>
      </ModalSidebar>
    </div>
  );
}

export const InTaskSidebar = () => <div className="p-4"><TaskLabels workspaceId="ws_studio" /></div>;

export const NoWorkspaceSelected = () => <div className="p-4"><TaskLabels /></div>;

/** Types a label name into the inline input, as if the person had started creating one. */
function TypeName({ name, children }: { name: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const input = ref.current?.querySelector<HTMLInputElement>('input[placeholder="New label"]');
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
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
