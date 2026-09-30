"use client";
import Link from "next/link";
import { SidebarProps } from "../../_types/types";
import { MessageCircle, Brain, Bell, Calendar, FileText, FolderKanban, Inbox, ListTodo, Settings, Sheet, Sun } from "lucide-react";
import { useSidebarStore } from "../../_store/sidebarStore";
import { motion } from "motion/react";
import { usePathname } from "next/navigation";
import { useUnreadNotificationCount } from "../../utils/hooks/notifications";

import { useChats } from "@/app/utils/hooks/chat";

export default function SidebarButton({ item }: { item: SidebarProps }) {
  const { setActiveItem } = useSidebarStore();
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
      className={`m-0 cursor-pointer rounded-lg border-none transition-colors ${isActive ? "text-primary" : "text-muted-foreground"} hover:text-primary`}
      whileHover={{ scale: 1.05}}
      whileTap={{ scale: 0.9 }}
      onClick={() => setActiveItem(item.name)}
    >
      <Link
        href={linkHref}
        aria-label={item.name}
        aria-current={isActive ? "page" : undefined}
        className={`relative flex h-full w-full items-center justify-center p-2 transition-colors ${isActive ? "text-primary" : "text-muted-foreground"} hover:text-primary`}
      >
        <SidebarButtonIcon icon={item.icon} />
        {item.name === "Chat" ? <ChatBadge /> : null}
        {item.name === "Notifications" ? <UnreadBadge /> : null}
      </Link>
    </motion.div>
  );
}

export const SidebarButtonIcon = ({ icon }: { icon: string }) => {
  switch (icon) {
    case "MessageCircle": return <MessageCircle className="size-5" />;
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
    <motion.span
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[9px] font-semibold leading-4 text-primary-foreground"
    >
      {count > 9 ? "9+" : count}
    </motion.span>
  );
}

function ChatBadge() { const { data } = useChats(); const count = data?.filter(c => c.unread).length || 0; return count ? <span aria-label={`${count} unread chats`} className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[9px] font-semibold leading-4 text-primary-foreground">{count > 9 ? "9+" : count}</span> : null; }
