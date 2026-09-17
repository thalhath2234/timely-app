"use client";

import { create } from "zustand";
import { SIDEBAR_ITEMS, AddNewModeOptions } from "../_types/types";
import { runViewTransition } from "@/app/utils/viewTransition";

export type SidebarItemName = typeof SIDEBAR_ITEMS[0]["name"];

export type CreateTaskDraft = {
  workspaceId?: string;
  projectId?: string;
  stageId?: string;
  kind?: "task" | "reminder";
};

type SidebarState = {
  activeItem: SidebarItemName;
  setActiveItem: (item: SidebarItemName) => void;
  searchMode: boolean;
  setSearchMode: (mode: boolean) => void;
  isAddItemModalOpen: boolean;
  setIsAddItemModalOpen: (mode: boolean) => void;
  addNewMode: AddNewModeOptions;
  setAddNewMode: (item: AddNewModeOptions) => void;
  createTaskDraft: CreateTaskDraft | null;
  setCreateTaskDraft: (draft: CreateTaskDraft | null) => void;
};

export const useSidebarStore = create<SidebarState>((set) => ({
  activeItem: SIDEBAR_ITEMS[0].name,
  setActiveItem: (item) => set({ activeItem: item }),
  searchMode: false,
  setSearchMode: (mode) => runViewTransition(() => set({ searchMode: mode })),
  isAddItemModalOpen: false,
  setIsAddItemModalOpen: (mode) =>
    runViewTransition(() => set({ isAddItemModalOpen: mode })),
  addNewMode: "task",
  setAddNewMode: (item) => set({ addNewMode: item }),
  createTaskDraft: null,
  setCreateTaskDraft: (draft) => set({ createTaskDraft: draft }),
}));