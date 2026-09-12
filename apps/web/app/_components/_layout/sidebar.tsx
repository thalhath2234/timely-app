"use client";

import { Plus, Search, LogOut } from "lucide-react";
import SidebarButton from "@/app/_components/_ui/sidebarButton";
import {
  SidebarProps,
  SIDEBAR_ITEMS,
  AddNewModeOptions,
} from "@/app/_types/types";
import { AnimatePresence } from "framer-motion";
import * as motion from "motion/react-client";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { useMutation } from "@tanstack/react-query";
import { useRouter, usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { apiFetch, setAccessToken } from "@/app/utils/api/client";

const addNewOptions: { lable: string; value: AddNewModeOptions }[] = [
  { lable: "Task", value: "task" },
  { lable: "Event", value: "event" },
  { lable: "Workspace", value: "workspace" },
  { lable: "Project", value: "project" },
  { lable: "Doc", value: "doc" },
  { lable: "Sheet", value: "sheet" },
];

export default function Sidebar() {
  const {
    activeItem,
    setSearchMode,
    isAddItemModalOpen,
    setIsAddItemModalOpen,
    setAddNewMode,
  } = useSidebarStore();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  const logoutMutation = useMutation({
    mutationFn: async () => {
      try {
        const response = await apiFetch("/logout", { method: "POST" });
        if (!response.ok) {
          throw new Error("Logout failed");
        }
        return response.json();
      } finally {
        setAccessToken(null);
      }
    },

    onSuccess: () => {
      router.push("/login");
      router.refresh();
    },
  });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        addMenuRef.current &&
        !addMenuRef.current.contains(event.target as Node)
      ) {
        setShowAddMenu(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div className="flex flex-col w-full h-full  mt-2 gap-y-2">
      <div className="flex items-center justify-center h-auto">
        <div className="flex flex-col items-center justify-center gap-y-2">
          <div className="relative" ref={addMenuRef}>
            <button
              className="flex bg-sidebar-primary text-sidebar-primary-foreground rounded-lg p-2 border-none m-0 cursor-pointer transition-colors hover:bg-sidebar-primary/90"
              onClick={() => setShowAddMenu((prev) => !prev)}
            >
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Plus className="size-5" />
              </motion.div>
            </button>

            <AnimatePresence>
              {showAddMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -5 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-full ml-2 top-0 z-50 min-w-36 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg overflow-hidden"
                >
                  {addNewOptions.map((option) => (
                    <button
                      key={option.value}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                      onClick={() => {
                        setAddNewMode(option.value);
                        setIsAddItemModalOpen(true);
                        setShowAddMenu(false);
                      }}
                    >
                      {option.lable}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button
            className="flex bg-sidebar-primary text-sidebar-primary-foreground rounded-lg p-2 border-none m-0 cursor-pointer transition-colors hover:bg-sidebar-primary/90"
            onClick={() => setSearchMode(true)}
          >
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Search className="size-5" />
            </motion.div>
          </button>
        </div>
      </div>
      <div className="w-full flex items-center justify-center">
        <p className="border-b border-sidebar-border w-1/2"> </p>
      </div>
      <div className="flex flex-col items-center gap-y-1 text-sidebar-foreground">
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
                    className="absolute inset-0 rounded-lg bg-sidebar-accent -z-10"
                  />
                )}
              </AnimatePresence>

              <SidebarButton item={item} />
            </div>
          );
        })}
      </div>
      <button
        className="flex items-center justify-center text-sidebar-foreground hover:text-sidebar-primary transition-colors cursor-pointer"
        onClick={() => logoutMutation.mutate()}
      >
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <LogOut className="size-5" />
        </motion.div>
      </button>
    </div>
  );
}
