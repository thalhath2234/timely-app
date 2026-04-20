"use client";
import Link from "next/link";
import { SidebarProps } from "../_types/types";
import { Brain, Calendar, ListTodo } from "lucide-react";
import { useSidebarStore } from "../_store/sidebarStore";

export default function SidebarButton({ item }: { item: SidebarProps }) {
  const { activeItem, setActiveItem } = useSidebarStore();
  const isActive = activeItem === item.name;
  return (
    <div className={`rounded-md p-2 border-none m-0 cursor-pointer ${isActive ? " text-tertiary" : " text-white"}`}>
    <Link
      href={item.href}
      className={`w-full h-full flex items-center justify-center ${isActive ? "text-tertiary" : "text-white"}`}
      onClick={() => setActiveItem(item.name)}
    >
      <SidebarButtonIcon icon={item.icon} />
    </Link>
    </div>
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
