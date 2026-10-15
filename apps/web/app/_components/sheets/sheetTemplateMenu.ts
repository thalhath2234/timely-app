"use client";

import { LayoutTemplate, Plus, Trash2 } from "lucide-react";
import type { SheetTemplate } from "@/app/_types/types";
import { tidyEntries, type ContextMenuEntry } from "@/app/_store/contextMenuStore";
import { templateTabChoices } from "@/app/utils/sheetWorkbook";
import type { CreateSheetPayload } from "@timely/contract/sheet";
import { BUILTIN_SHEET_TEMPLATES, builtinSheetTemplate } from "@timely/contract/sheetTemplates";

/** What to send to create a sheet: a stored template's id, or a built-in sheet built here. */
export function sheetCreatePayload(templateId?: string): CreateSheetPayload {
  if (!templateId) return {};
  const builtin = builtinSheetTemplate(templateId);
  if (builtin) return builtin.build({ year: new Date().getFullYear() });
  return { templateId };
}

export function newSheetMenuItems(options: {
  templates: SheetTemplate[];
  onBlank: () => void;
  onTemplate: (templateId: string) => void;
  /** Offers "Delete template" for the person's own templates (never the ready-made ones). */
  onDeleteTemplate?: (template: SheetTemplate) => void;
}): ContextMenuEntry[] {
  const { onDeleteTemplate } = options;
  return tidyEntries([
    {
      kind: "action",
      label: "Blank sheet",
      icon: Plus,
      onSelect: options.onBlank,
    },
    { kind: "separator" },
    { kind: "heading", label: "Ready-made" },
    ...BUILTIN_SHEET_TEMPLATES.map((template) => ({
      kind: "action" as const,
      label: `${template.icon} ${template.name}`,
      onSelect: () => options.onTemplate(template.id),
    })),
    options.templates.length > 0 && { kind: "separator" },
    options.templates.length > 0 && { kind: "heading", label: "Your templates" },
    ...options.templates.map((template) => ({
      kind: "action" as const,
      label: template.name || "Untitled",
      icon: LayoutTemplate,
      onSelect: () => options.onTemplate(template.id),
    })),
    onDeleteTemplate && options.templates.length > 0 && { kind: "separator" },
    onDeleteTemplate &&
      options.templates.length > 0 && {
        kind: "submenu",
        label: "Delete template",
        icon: Trash2,
        items: options.templates.map((template) => ({
          kind: "action" as const,
          label: template.name || "Untitled",
          danger: true,
          onSelect: () => onDeleteTemplate(template),
        })),
      },
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
