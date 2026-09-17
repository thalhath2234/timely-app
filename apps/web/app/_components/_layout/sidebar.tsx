"use client";

import { Plus, Search, LogOut } from "lucide-react";
import SidebarButton from "@/app/_components/_ui/sidebarButton";
import {
  SidebarProps,
  SIDEBAR_ITEMS,
  AddNewModeOptions,
} from "@/app/_types/types";
import { AnimatePresence, motion } from "motion/react";
import { springSoft } from "@/app/_components/_ui/motion";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { useMutation } from "@tanstack/react-query";
import { useRouter, usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { apiFetch, setAccessToken } from "@/app/utils/api/client";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { tidyEntries, type ContextMenuEntry } from "@/app/_store/contextMenuStore";
import { requestConfirm } from "@/app/_store/confirmStore";

const GO_SHORTCUTS: Record<string, string> = {
  Today: "G then Y",
  Inbox: "G then I",
  Calendar: "G then C",
  Tasks: "G then T",
  Projects: "G then P",
  Docs: "G then D",
  Sheets: "G then S",
  Report: "G then R",
  Notifications: "G then N",
};

const NEW_SHORTCUTS: Partial<Record<AddNewModeOptions, string>> = {
  task: "C",
};

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
    setSearchMode,
    setIsAddItemModalOpen,
    setAddNewMode,
  } = useSidebarStore();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const openMenu = useContextMenu();

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

  const createItem = (mode: AddNewModeOptions) => {
    setAddNewMode(mode);
    setIsAddItemModalOpen(true);
    setShowAddMenu(false);
  };

  const addMenuItems: ContextMenuEntry[] = addNewOptions.map((option) => ({
    kind: "action",
    label: `New ${option.lable.toLowerCase()}`,
    shortcut: NEW_SHORTCUTS[option.value],
    onSelect: () => createItem(option.value),
  }));

  const chromeMenu = tidyEntries([
    {
      kind: "action",
      label: "Search",
      shortcut: "/",
      onSelect: () => setSearchMode(true),
    },
    { kind: "separator" },
    ...addMenuItems,
    { kind: "separator" },
    {
      kind: "submenu",
      label: "Go to",
      items: SIDEBAR_ITEMS.map((item) => ({
        kind: "action" as const,
        label: item.name,
        shortcut: GO_SHORTCUTS[item.name],
        onSelect: () => {
          if (item.name === "Calendar") router.push("/calendar?view=month");
          else router.push(item.href);
        },
      })),
    },
    { kind: "separator" },
    {
      kind: "action",
      label: "Sign out",
      danger: true,
      onSelect: () =>
        requestConfirm({
          title: "Sign out?",
          confirmLabel: "Sign out",
          pendingLabel: "Signing out…",
          onConfirm: () => logoutMutation.mutateAsync(),
        }),
    },
  ]);

  return (
    <div
      className="flex h-full w-full flex-col items-center gap-y-2 py-3"
      onContextMenu={(event) => openMenu(event, chromeMenu)}
    >
      <div className="flex items-center justify-center h-auto">
        <div className="flex flex-col items-center justify-center gap-y-2">
          <div className="relative" ref={addMenuRef}>
            <button
              type="button"
              aria-label="Add item"
              aria-expanded={showAddMenu}
              aria-haspopup="menu"
              className="flex cursor-pointer rounded-lg border-none bg-primary p-2 text-primary-foreground transition-colors hover:bg-primary/90"
              onClick={() => setShowAddMenu((prev) => !prev)}
              onContextMenu={(event) => openMenu(event, addMenuItems)}
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
                  transition={springSoft}
                  className="absolute left-full ml-2 top-0 z-50 min-w-36 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg overflow-hidden"
                  role="menu"
                >
                  {addNewOptions.map((option, index) => (
                    <motion.button
                      type="button"
                      role="menuitem"
                      key={option.value}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.03, ...springSoft }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                      onClick={() => createItem(option.value)}
                    >
                      {option.lable}
                    </motion.button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button
            type="button"
            aria-label="Search"
            className="flex cursor-pointer rounded-lg border-none p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setSearchMode(true)}
            onContextMenu={(event) =>
              openMenu(event, [
                {
                  kind: "action",
                  label: "Search",
                  shortcut: "/",
                  onSelect: () => setSearchMode(true),
                },
              ])
            }
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
      <div className="flex flex-1 flex-col items-center gap-y-1 text-muted-foreground">
        {SIDEBAR_ITEMS.map((item: SidebarProps) => {
          const isActive = pathname.startsWith(item.href);

          return (
            <div
              key={item.name}
              className="relative"
              onContextMenu={(event) =>
                openMenu(event, [
                  {
                    kind: "action",
                    label: `Go to ${item.name}`,
                    shortcut: GO_SHORTCUTS[item.name],
                    onSelect: () => {
                      if (item.name === "Calendar") router.push("/calendar?view=month");
                      else router.push(item.href);
                    },
                  },
                ])
              }
            >
              <AnimatePresence>
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active-pill"
                    transition={springSoft}
                    className="absolute inset-0 -z-10 rounded-lg bg-primary/12"
                  />
                )}
              </AnimatePresence>

              <SidebarButton item={item} />
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="Sign out"
        className="mt-auto flex cursor-pointer items-center justify-center pb-1 text-muted-foreground transition-colors hover:text-primary"
        onClick={() => logoutMutation.mutate()}
        onContextMenu={(event) =>
          openMenu(event, [
            {
              kind: "action",
              label: "Sign out",
              danger: true,
              onSelect: () =>
                requestConfirm({
                  title: "Sign out?",
                  confirmLabel: "Sign out",
                  pendingLabel: "Signing out…",
                  onConfirm: () => logoutMutation.mutateAsync(),
                }),
            },
          ])
        }
      >
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <LogOut className="size-5" />
        </motion.div>
      </button>
    </div>
  );
}
