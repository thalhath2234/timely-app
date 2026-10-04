import { DatePicker, ModalSidebar, PropertyRow, Select, SidebarSectionTitle } from "@timely/ui";
import { CalendarDays, Circle, Flag, FolderKanban } from "lucide-react";

const selectClass = "border-0 bg-transparent px-0 shadow-none";

export const ProjectProperties = () => (
  <div className="flex overflow-hidden rounded-2xl border border-border bg-background" style={{ width: 360, height: 420 }}>
    <ModalSidebar>
      <div className="flex flex-col gap-1">
        <PropertyRow icon={FolderKanban} label="Workspace">
          <Select size="sm" value="w1" onChange={() => undefined} className={selectClass} options={[{ value: "w1", label: "Studio", color: "#6E56CF" }]} />
        </PropertyRow>
        <PropertyRow icon={Circle} label="Status">
          <Select size="sm" value="s2" onChange={() => undefined} className={selectClass} options={[{ value: "s2", label: "Active", color: "#0090FF" }]} />
        </PropertyRow>
        <PropertyRow icon={Flag} label="Priority">
          <Select size="sm" value="High" onChange={() => undefined} className={selectClass} options={[{ value: "High", label: "High", color: "#F76808" }]} />
        </PropertyRow>
        <PropertyRow icon={CalendarDays} label="Start date">
          <DatePicker value="2024-05-06" onChange={() => undefined} />
        </PropertyRow>
        <PropertyRow icon={CalendarDays} label="Deadline">
          <DatePicker value="2024-06-28" onChange={() => undefined} />
        </PropertyRow>
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <SidebarSectionTitle>Stages</SidebarSectionTitle>
        <p className="px-1.5 text-xs text-muted-foreground">Discovery → Design → Build → Launch</p>
      </div>
    </ModalSidebar>
  </div>
);
