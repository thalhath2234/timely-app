"use client";

import { Plus } from "lucide-react";
import SidebarButton from "@/app/_ui/sidebarButton";
import { SidebarProps, SIDEBAR_ITEMS } from "@/app/_types/types";
import { AnimatePresence } from "framer-motion";
import * as motion from "motion/react-client";
import { useSidebarStore } from "@/app/_store/sidebarStore";

export default function Sidebar() {
  const { activeItem } = useSidebarStore();
  return (
    <div className="w-full h-full">
      <div className="flex items-center justify-center h-16">
        <button className="bg-blue-900 rounded-md p-2 border-none m-0 cursor-pointer">
          <Plus className="color-white size-5" />
        </button>
      </div>
      <div className="flex flex-col items-center gap-y-1 text-white">
        {SIDEBAR_ITEMS.map((item: SidebarProps) => (
          <div key={item.name} className="relative">
            <AnimatePresence>
              {activeItem === item.name && (
                <motion.div
                  layoutId="sidebar-active-pill"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  className="absolute inset-0 rounded-md bg-white -z-10"
                />
              )}
            </AnimatePresence>
            <SidebarButton item={item} />
          </div>
        ))}
      </div>
    </div>
  );
}
