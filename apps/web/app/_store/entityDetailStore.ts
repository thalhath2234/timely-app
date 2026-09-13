"use client";

import { create } from "zustand";

export type EntityDetailKind = "task" | "project";

type EntityDetailState = {
  kind: EntityDetailKind | null;
  id: string | null;
  openEntity: (kind: EntityDetailKind, id: string) => void;
  openTask: (id: string) => void;
  openProject: (id: string) => void;
  closeEntity: () => void;
};

export const useEntityDetailStore = create<EntityDetailState>((set) => ({
  kind: null,
  id: null,
  openEntity: (kind, id) => set({ kind, id }),
  openTask: (id) => set({ kind: "task", id }),
  openProject: (id) => set({ kind: "project", id }),
  closeEntity: () => set({ kind: null, id: null }),
}));
