"use client";
import Link from "next/link";
import { SidebarProps } from "../../_types/types";
import { Brain, Calendar, FileText, ListTodo, Settings, Sheet } from "lucide-react";
import { useSidebarStore } from "../../_store/sidebarStore";
import * as motion from "motion/react-client";
import { usePathname } from "next/navigation";

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
        className={`p-2 w-full h-full flex items-center justify-center transition-colors ${isActive ? "text-sidebar-primary" : "text-sidebar-foreground"} hover:text-sidebar-primary`}
      >
        <SidebarButtonIcon icon={item.icon} />
      </Link>
    </motion.div>
  );
}

export const SidebarButtonIcon = ({ icon }: { icon: string }) => {
  switch (icon) {
    case "Calendar":
      return <Calendar className="size-5" />;
    case "ListTodo":
      return <ListTodo className="size-5" />;
    case "FileText":
      return <FileText className="size-5" />;
    case "Sheet":
      return <Sheet className="size-5" />;
    case "Brain":
      return <Brain className="size-5" />;
    case "Settings":
      return <Settings className="size-5" />;
    default:
      return null;
  }
};
