"use client";

import { create } from "zustand";
import { SIDEBAR_ITEMS, AddNewModeOptions } from "../_types/types";

export type SidebarItemName = typeof SIDEBAR_ITEMS[0]["name"];

type SidebarState = {
  activeItem: SidebarItemName;
  setActiveItem: (item: SidebarItemName) => void;
  searchMode: boolean;
  setSearchMode: (mode: boolean) => void;
  isAddItemModalOpen: boolean;
  setIsAddItemModalOpen: (mode: boolean) => void;
  addNewMode: AddNewModeOptions;
  setAddNewMode: (item: AddNewModeOptions) => void;
};

export const useSidebarStore = create<SidebarState>((set) => ({
  activeItem: SIDEBAR_ITEMS[0].name,
  setActiveItem: (item) => set({ activeItem: item }),
  searchMode: false,
  setSearchMode: (mode) => set({ searchMode: mode }),
  isAddItemModalOpen: false,
  setIsAddItemModalOpen: (mode) => set({ isAddItemModalOpen: mode }),
  addNewMode: "task",
  setAddNewMode: (item) => set({ addNewMode: item }),
}));