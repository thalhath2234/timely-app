import { SidebarButton } from "@timely/ui";

const ITEMS = [
  { name: "Chat", icon: "MessageCircle", href: "/chat" },
  { name: "Today", icon: "Sun", href: "/today" },
  { name: "Inbox", icon: "Inbox", href: "/inbox" },
  { name: "Calendar", icon: "Calendar", href: "/calendar" },
  { name: "Tasks", icon: "ListTodo", href: "/tasks" },
  { name: "Projects", icon: "FolderKanban", href: "/projects" },
  { name: "Docs", icon: "FileText", href: "/docs" },
  { name: "Sheets", icon: "Sheet", href: "/sheets" },
  { name: "Notifications", icon: "Bell", href: "/notifications" },
  { name: "Settings", icon: "Settings", href: "/settings" },
];

// The preview runs at pathname "/today", so Today is the active item.
export const NavRail = () => (
  <div className="p-4">
    <div className="flex flex-col items-center gap-y-1 rounded-xl border border-border bg-sidebar py-3" style={{ width: 56 }}>
      {ITEMS.map((item) => (
        <div key={item.name} className="relative isolate">
          {item.href === "/today" ? (
            <div className="absolute inset-0 -z-10 rounded-lg bg-primary/12" />
          ) : null}
          <SidebarButton item={item} />
        </div>
      ))}
    </div>
  </div>
);

export const ActiveAndIdle = () => (
  <div className="flex items-center gap-4 p-4">
    <div className="relative isolate">
      <div className="absolute inset-0 -z-10 rounded-lg bg-primary/12" />
      <SidebarButton item={{ name: "Today", icon: "Sun", href: "/today" }} />
    </div>
    <SidebarButton item={{ name: "Calendar", icon: "Calendar", href: "/calendar" }} />
    <SidebarButton item={{ name: "Tasks", icon: "ListTodo", href: "/tasks" }} />
  </div>
);
