"use client";
import Link from "next/link";
import { SidebarProps } from "../../_types/types";
import { Brain, Bell, Calendar, FileText, FolderKanban, Inbox, ListTodo, Settings, Sheet, Sun } from "lucide-react";
import { useSidebarStore } from "../../_store/sidebarStore";
import * as motion from "motion/react-client";
import { usePathname } from "next/navigation";
import { useUnreadNotificationCount } from "../../utils/hooks/notifications";

export default function SidebarButton({ item }: { item: SidebarProps }) {
  const { activeItem, setActiveItem } = useSidebarStore();
  const pathname = usePathname();
  const isActive = pathname.startsWith(item.href);

  const linkHref =
  item.name === "Calendar"
    ? {
        pathname: "/calendar",
        query: { view: "month" },
      }
    : item.href;
  return (
    <motion.div
      className={`rounded-lg border-none m-0 cursor-pointer transition-colors ${isActive ? "text-sidebar-primary" : "text-sidebar-foreground"} hover:text-sidebar-primary`}
      whileHover={{ scale: 1.05}}
      whileTap={{ scale: 0.9 }}
      onClick={() => setActiveItem(item.name)}
    >
      <Link
        href={linkHref}
        className={`relative p-2 w-full h-full flex items-center justify-center transition-colors ${isActive ? "text-sidebar-primary" : "text-sidebar-foreground"} hover:text-sidebar-primary`}
      >
        <SidebarButtonIcon icon={item.icon} />
        {item.name === "Notifications" ? <UnreadBadge /> : null}
      </Link>
    </motion.div>
  );
}

export const SidebarButtonIcon = ({ icon }: { icon: string }) => {
  switch (icon) {
    case "Calendar":
      return <Calendar className="size-5" />;
    case "Sun":
      return <Sun className="size-5" />;
    case "Inbox":
      return <Inbox className="size-5" />;
    case "ListTodo":
      return <ListTodo className="size-5" />;
    case "FolderKanban":
      return <FolderKanban className="size-5" />;
    case "FileText":
      return <FileText className="size-5" />;
    case "Sheet":
      return <Sheet className="size-5" />;
    case "Brain":
      return <Brain className="size-5" />;
    case "Bell":
      return <Bell className="size-5" />;
    case "Settings":
      return <Settings className="size-5" />;
    default:
      return null;
  }
};

function UnreadBadge() {
  const { data: count } = useUnreadNotificationCount();
  if (!count) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[9px] font-semibold leading-4 text-primary-foreground">
      {count > 9 ? "9+" : count}
    </span>
  );
}
