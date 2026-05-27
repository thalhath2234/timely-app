"use client";
import Link from "next/link";
import { SidebarProps } from "../_types/types";
import { Brain, Calendar, ListTodo, Search } from "lucide-react";
import { useSidebarStore } from "../_store/sidebarStore";
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
      className={`rounded-md border-none m-0 cursor-pointer ${isActive ? " text-tertiary" : " text-white"} hover:text-tertiary`}
      whileHover={{ scale: 1.05}}
      whileTap={{ scale: 0.9 }}
      onClick={() => setActiveItem(item.name)}
    >
      <Link
        href={linkHref}
        className={`p-2 w-full h-full flex items-center justify-center ${isActive ? "text-tertiary" : "text-white"} hover:text-tertiary`}
      >
        <SidebarButtonIcon icon={item.icon} />
      </Link>
    </motion.div>
  );
}

export const SidebarButtonIcon = ({ icon }: { icon: string }) => {
  switch (icon) {
    case "Calendar":
      return <Calendar className="color-white size-5" />;
    case "ListTodo":
      return <ListTodo className="color-white size-5" />;
    case "Brain":
      return <Brain className="color-white size-5" />;
    default:
      return null;
  }
};
