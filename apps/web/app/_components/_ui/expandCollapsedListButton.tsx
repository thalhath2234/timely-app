"use client";

import { PanelLeftOpen } from "lucide-react";
import { useCollapsedPanel } from "@/app/utils/hooks/useCollapsedPanel";

export default function ExpandCollapsedListButton({
  storageKey,
  label,
}: {
  storageKey: string;
  label: string;
}) {
  const { collapsed, toggle } = useCollapsedPanel(storageKey);
  if (!collapsed) return null;

  return (
    <button
      type="button"
      title={`Expand ${label}`}
      onClick={toggle}
      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
    >
      <PanelLeftOpen className="size-4" />
    </button>
  );
}
