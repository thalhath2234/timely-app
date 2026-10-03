import { LabelPicker, SidebarSectionTitle } from "@timely/ui";
import { useState } from "react";

const t = "2024-05-01T09:00:00Z";
const LABELS = [
  { id: "l1", name: "Deep work", color: "#6E56CF", workspaceId: "w1", createdAt: t, updatedAt: t },
  { id: "l2", name: "Meeting prep", color: "#0090FF", workspaceId: "w1", createdAt: t, updatedAt: t },
  { id: "l3", name: "Quick win", color: "#30A66D", workspaceId: "w1", createdAt: t, updatedAt: t },
  { id: "l4", name: "Waiting on others", color: "#F76808", workspaceId: "w1", createdAt: t, updatedAt: t },
  { id: "l5", name: "Admin", color: "#889096", workspaceId: "w1", createdAt: t, updatedAt: t },
];

export const TaskLabels = () => {
  const [ids, setIds] = useState(["l1", "l3"]);
  return (
    <div className="w-[320px] p-4">
      <SidebarSectionTitle>Labels</SidebarSectionTitle>
      <LabelPicker labels={LABELS} selectedIds={ids} onChange={setIds} />
    </div>
  );
};

export const NoneSelected = () => {
  const [ids, setIds] = useState<string[]>([]);
  return (
    <div className="w-[320px] p-4">
      <SidebarSectionTitle>Labels</SidebarSectionTitle>
      <LabelPicker labels={LABELS} selectedIds={ids} onChange={setIds} />
    </div>
  );
};

export const EmptyWorkspace = () => (
  <div className="w-[320px] p-4">
    <SidebarSectionTitle>Labels</SidebarSectionTitle>
    <LabelPicker labels={[]} selectedIds={[]} onChange={() => undefined} />
  </div>
);
