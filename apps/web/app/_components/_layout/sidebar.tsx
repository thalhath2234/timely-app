"use client";

import { Plus, Search, LogOut } from "lucide-react";
import SidebarButton from "@/app/_ui/sidebarButton";
import { SidebarProps, SIDEBAR_ITEMS } from "@/app/_types/types";
import { AnimatePresence } from "framer-motion";
import * as motion from "motion/react-client";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { useMutation } from "@tanstack/react-query";
import { useRouter, usePathname } from "next/navigation";

export default function Sidebar() {
  const { activeItem, setSearchMode, addItemMode, setAddItemMode } =
    useSidebarStore();
  const router = useRouter();
  const pathname = usePathname();

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("http://localhost:8080/logout", {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Logout failed");
      }

      return response.json();
    },

    onSuccess: () => {
      router.push("/login");
      router.refresh();
    },
  });

  return (
    <div className="flex flex-col w-full h-full  mt-2 gap-y-2">
      <div className="flex items-center justify-center h-auto">
        <div className="flex flex-col items-center justify-center gap-y-2">
          <button
            className="flex bg-blue-900 rounded-md p-2 border-none m-0 cursor-pointer"
            onClick={() => setAddItemMode(true)}
          >
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Plus className="color-white size-5" />
            </motion.div>
          </button>
          <button
            className="flex bg-blue-900 rounded-md p-2 border-none m-0 cursor-pointer"
            onClick={() => setSearchMode(true)}
          >
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Search className="color-white size-5" />
            </motion.div>
          </button>
        </div>
      </div>
      <div className="w-full flex items-center justify-center">
        <p className="border-b border-white/30 w-1/2"> </p>
      </div>
      <div className="flex flex-col items-center gap-y-1 text-white">
        {SIDEBAR_ITEMS.map((item: SidebarProps) => {
          const isActive = pathname.startsWith(item.href);

          return (
            <div key={item.name} className="relative">
              <AnimatePresence>
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active-pill"
                    transition={{
                      type: "spring",
                      stiffness: 400,
                      damping: 32,
                    }}
                    className="absolute inset-0 rounded-md bg-white -z-10"
                  />
                )}
              </AnimatePresence>

              <SidebarButton item={item} />
            </div>
          );
        })}
      </div>
      <button
        className="flex items-center justify-center"
        onClick={() => logoutMutation.mutate()}
      >
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <LogOut className="color-white size-5" />
        </motion.div>
      </button>
    </div>
  );
}
