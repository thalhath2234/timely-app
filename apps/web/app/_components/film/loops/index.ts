"use client";

import type { ComponentType } from "react";
import { AskLoop } from "./ask";
import { CaptureLoop } from "./capture";
import { CardsLoop } from "./cards";
import { FilesLoop } from "./files";
import { ProjectLoop } from "./project";
import { ScheduleLoop } from "./schedule";

export type LoopId = "capture" | "ask" | "cards" | "project" | "files" | "schedule";

/** The empty-state loops: the component, the frame to rest on when motion is reduced, and the alt text. */
export const LOOPS: Record<LoopId, { component: ComponentType; poster: number; label: string }> = {
  capture: { component: CaptureLoop, poster: 118, label: "A thought typed into the capture box becomes a task scheduled for Friday" },
  ask: { component: AskLoop, poster: 118, label: "A question to the assistant answered with a proposal of four changes, accepted" },
  cards: { component: CardsLoop, poster: 118, label: "A card dragged from the picker onto the dashboard grid, its number counting up" },
  project: { component: ProjectLoop, poster: 118, label: "A project named, its stages appearing, tasks moving to Done as the bar fills" },
  files: { component: FilesLoop, poster: 118, label: "A line written in a doc turned into a task linked back to the doc" },
  schedule: { component: ScheduleLoop, poster: 118, label: "Estimated tasks dropping into free time in deadline order; a meeting lands and one block moves to Friday" },
};
