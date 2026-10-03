import { LabelPicker, PropertyRow, SidebarSectionTitle } from "@timely/ui";
import { Ban } from "lucide-react";

const t = "2024-05-01T09:00:00Z";

export const Sections = () => (
  <div className="flex flex-col rounded-xl border border-border bg-muted/10 px-5 py-4" style={{ width: 360 }}>
    <div>
      <SidebarSectionTitle>Labels</SidebarSectionTitle>
      <LabelPicker
        labels={[
          { id: "l1", name: "Deep work", color: "#6E56CF", workspaceId: "w1", createdAt: t, updatedAt: t },
          { id: "l2", name: "Quick win", color: "#30A66D", workspaceId: "w1", createdAt: t, updatedAt: t },
        ]}
        selectedIds={["l1"]}
        onChange={() => undefined}
      />
    </div>
    <div className="mt-4 border-t border-border pt-3">
      <SidebarSectionTitle>Dependencies</SidebarSectionTitle>
      <PropertyRow icon={Ban} label="Blocked by">
        <span className="truncate text-xs text-foreground">Finalize brand palette</span>
      </PropertyRow>
      <PropertyRow icon={Ban} label="Blocking">
        <span className="truncate text-xs text-foreground">Build signup screens</span>
      </PropertyRow>
    </div>
  </div>
);
