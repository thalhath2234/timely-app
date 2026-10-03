import { SidebarButtonIcon } from "@timely/ui";

const ICONS = [
  ["MessageCircle", "Chat"],
  ["Sun", "Today"],
  ["Inbox", "Inbox"],
  ["Calendar", "Calendar"],
  ["ListTodo", "Tasks"],
  ["FolderKanban", "Projects"],
  ["FileText", "Docs"],
  ["Sheet", "Sheets"],
  ["Brain", "Report"],
  ["Bell", "Notifications"],
  ["Settings", "Settings"],
];

export const AllIcons = () => (
  <div className="grid gap-2 p-4" style={{ width: 480, gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
    {ICONS.map(([icon, name]) => (
      <div key={icon} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        <span className="flex shrink-0"><SidebarButtonIcon icon={icon} /></span>
        {name}
      </div>
    ))}
  </div>
);

export const ActiveColor = () => (
  <div className="flex items-center gap-3 p-4">
    <span className="rounded-lg bg-primary/12 p-2 text-primary">
      <SidebarButtonIcon icon="Sun" />
    </span>
    <span className="p-2 text-muted-foreground">
      <SidebarButtonIcon icon="Calendar" />
    </span>
  </div>
);
