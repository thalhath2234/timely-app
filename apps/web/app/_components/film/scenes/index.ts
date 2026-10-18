"use client";

import type { ComponentType } from "react";
import { AgentsScene } from "./agents";
import { AssistantScene } from "./assistant";
import { CaptureScene } from "./capture";
import { CardsScene } from "./cards";
import { DocsScene } from "./docs";
import { ScheduleScene } from "./schedule";
import { SelfHostScene } from "./selfHost";
import { SheetsScene } from "./sheets";
import { SuggestionsScene } from "./suggestions";
import { TasksScene } from "./tasks";
import { WidgetsScene } from "./widgets";

/** The scene component for each chapter id in ../chapters.ts. */
export const SCENES: Record<string, ComponentType> = {
  capture: CaptureScene,
  tasks: TasksScene,
  "auto-schedule": ScheduleScene,
  sheets: SheetsScene,
  docs: DocsScene,
  cards: CardsScene,
  suggestions: SuggestionsScene,
  assistant: AssistantScene,
  agents: AgentsScene,
  widgets: WidgetsScene,
  "self-host": SelfHostScene,
};
