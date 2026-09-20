"use client";

import { LayoutTemplate, Plus } from "lucide-react";
import type { SheetTemplate } from "@/app/_types/types";
import { tidyEntries, type ContextMenuEntry } from "@/app/_store/contextMenuStore";
import { templateTabChoices } from "@/app/utils/sheetWorkbook";

export function newSheetMenuItems(options: {
  templates: SheetTemplate[];
  onBlank: () => void;
  onTemplate: (templateId: string) => void;
}): ContextMenuEntry[] {
  return tidyEntries([
    {
      kind: "action",
      label: "Blank sheet",
      icon: Plus,
      onSelect: options.onBlank,
    },
    options.templates.length > 0 && { kind: "separator" },
    options.templates.length > 0 && { kind: "heading", label: "From template" },
    ...options.templates.map((template) => ({
      kind: "action" as const,
      label: template.name || "Untitled",
      icon: LayoutTemplate,
      onSelect: () => options.onTemplate(template.id),
    })),
  ]);
}

export function addTabMenuItems(options: {
  templates: SheetTemplate[];
  onBlank: () => void;
  onTemplate: (templateId: string, tabId?: string) => void;
}): ContextMenuEntry[] {
  return tidyEntries([
    {
      kind: "action",
      label: "Blank tab",
      icon: Plus,
      onSelect: options.onBlank,
    },
    options.templates.length > 0 && { kind: "separator" },
    options.templates.length > 0 && { kind: "heading", label: "From template" },
    ...options.templates.map((template) => {
      const tabs = templateTabChoices(template);
      if (tabs.length <= 1) {
        return {
          kind: "action" as const,
          label: template.name || "Untitled",
          icon: LayoutTemplate,
          onSelect: () => options.onTemplate(template.id, tabs[0]?.id || undefined),
        };
      }
      return {
        kind: "submenu" as const,
        label: template.name || "Untitled",
        icon: LayoutTemplate,
        items: tabs.map((tab) => ({
          kind: "action" as const,
          label: tab.name,
          onSelect: () => options.onTemplate(template.id, tab.id),
        })),
      };
    }),
  ]);
}
