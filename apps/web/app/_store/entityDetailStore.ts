"use client";

import { create } from "zustand";
import { runViewTransition } from "@/app/utils/viewTransition";
import { beginOpenMorph, entityTitleKey } from "@/app/utils/titleMorph";

export type EntityDetailKind = "task" | "project";

export type EntityDetailState = {
  kind: EntityDetailKind | null;
  id: string | null;
  openEntity: (kind: EntityDetailKind, id: string) => void;
  openTask: (id: string) => void;
  openProject: (id: string) => void;
  closeEntity: () => void;
};

function open(set: (state: Pick<EntityDetailState, "kind" | "id">) => void, kind: EntityDetailKind, id: string) {
  beginOpenMorph(entityTitleKey(kind, id));
  runViewTransition(() => set({ kind, id }));
}

export const useEntityDetailStore = create<EntityDetailState>((set) => ({
  kind: null,
  id: null,
  openEntity: (kind, id) => open(set, kind, id),
  openTask: (id) => open(set, "task", id),
  openProject: (id) => open(set, "project", id),
  closeEntity: () => runViewTransition(() => set({ kind: null, id: null })),
}));
