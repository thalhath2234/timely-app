"use client";

import { create } from "zustand";
import { runViewTransition } from "@/app/utils/viewTransition";

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
  openEntity: (kind, id) => runViewTransition(() => set({ kind, id })),
  openTask: (id) => runViewTransition(() => set({ kind: "task", id })),
  openProject: (id) => runViewTransition(() => set({ kind: "project", id })),
  closeEntity: () => runViewTransition(() => set({ kind: null, id: null })),
}));
