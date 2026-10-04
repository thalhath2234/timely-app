import { ContextMenuHost, useContextMenuStore } from "@timely/ui";
import {
  CalendarClock, CalendarDays, Check, Circle, Copy, ExternalLink, Flag, Folder, Link2, Pencil, Sun, Tag, Target, Trash2,
} from "lucide-react";
import { useEffect } from "react";

const noop = () => undefined;

export const TaskRow = () => {
  useEffect(() => {
    useContextMenuStore.getState().open({
      x: 40,
      y: 24,
      title: "Draft onboarding flow",
      items: [
        { kind: "action", label: "Open details", icon: ExternalLink, shortcut: "Enter", onSelect: noop },
        { kind: "action", label: "Mark complete", icon: Check, shortcut: "X", onSelect: noop },
        { kind: "action", label: "Start focus", icon: Target, shortcut: "mod+F", onSelect: noop },
        { kind: "action", label: "Plan for Today", icon: Sun, onSelect: noop },
        { kind: "separator" },
        { kind: "submenu", label: "Status", icon: Circle, items: [
          { kind: "action", label: "In progress", color: "#0090FF", checked: true, onSelect: noop },
          { kind: "action", label: "Done", color: "#30A66D", onSelect: noop },
        ] },
        { kind: "submenu", label: "Priority", icon: Flag, items: [] },
        { kind: "submenu", label: "Project", icon: Folder, items: [] },
        { kind: "submenu", label: "Labels", icon: Tag, items: [] },
        { kind: "submenu", label: "Deadline", icon: CalendarDays, items: [] },
        { kind: "action", label: "Find time on calendar", icon: CalendarClock, shortcut: "S", onSelect: noop },
        { kind: "separator" },
        { kind: "action", label: "Duplicate", icon: Copy, shortcut: "mod+D", onSelect: noop },
        { kind: "action", label: "Copy link", icon: Link2, shortcut: "mod+shift+C", onSelect: noop },
        { kind: "separator" },
        { kind: "action", label: "Delete", icon: Trash2, danger: true, shortcut: "mod+Backspace", onSelect: noop },
      ],
    });
  }, []);
  return <ContextMenuHost />;
};

export const PickerWithHeading = () => {
  useEffect(() => {
    useContextMenuStore.getState().open({
      x: 40,
      y: 24,
      title: "Website relaunch",
      items: [
        { kind: "heading", label: "Status" },
        { kind: "action", label: "Planning", color: "#889096", onSelect: noop },
        { kind: "action", label: "Active", color: "#0090FF", checked: true, onSelect: noop },
        { kind: "action", label: "On hold", color: "#FFB224", onSelect: noop },
        { kind: "action", label: "Shipped", color: "#30A66D", disabled: true, onSelect: noop },
        { kind: "separator" },
        { kind: "action", label: "Rename", icon: Pencil, shortcut: "F2", onSelect: noop },
      ],
    });
  }, []);
  return <ContextMenuHost />;
};
