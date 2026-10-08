"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Wrench, X } from "lucide-react";
import { BUILTIN_CARDS, CARD_TEMPLATES, type BuiltinCardType, type CardTemplate } from "@timely/contract/dashboard";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import { cn } from "@/app/utils/cn";
import { BuiltinIcon } from "./cardIcons";
import { DISPLAY_ICON } from "./cardWorkshop";

type Tab = "tools" | "templates";

export default function AddCardDialog({
  onAddBuiltin,
  onAddTemplate,
  onOpenWorkshop,
  onClose,
  present,
}: {
  onAddBuiltin: (type: BuiltinCardType) => void;
  onAddTemplate: (template: CardTemplate) => void;
  onOpenWorkshop: () => void;
  onClose: () => void;
  /** Built-in types already on the board, marked so a second copy is a choice. */
  present: Set<string>;
}) {
  const titleId = useId();
  const [tab, setTab] = useState<Tab>("tools");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <OverlayScrim className="z-[60] bg-black/55" onPointerDown={(event) => event.target === event.currentTarget && onClose()} />
      <OverlayFrame className="z-[60] items-center justify-center p-4">
        <OverlayPanel
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        >
          <header className="flex items-center gap-3 px-5 pb-2 pt-4">
            <h2 id={titleId} className="flex-1 text-base font-semibold text-foreground">
              Add a card
            </h2>
            <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
              <X className="size-4" />
            </button>
          </header>

          <div className="px-5">
            <button
              type="button"
              onClick={onOpenWorkshop}
              className="flex w-full items-center gap-3 rounded-xl border border-dashed border-primary/50 bg-accent/30 px-4 py-3 text-left transition-colors hover:bg-accent/60"
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Wrench className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">Build a custom card</span>
                <span className="block text-xs text-muted-foreground">
                  Open the card workshop: choose the data, filters, grouping, time range and chart.
                </span>
              </span>
            </button>
          </div>

          <div className="mt-4 flex gap-1 border-b border-border px-5" role="tablist">
            {(
              [
                ["tools", "Productivity tools"],
                ["templates", "Ready-made charts"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                  tab === value ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto p-5 sm:grid-cols-2">
            {tab === "tools"
              ? BUILTIN_CARDS.map((card) => (
                  <GalleryItem
                    key={card.type}
                    icon={<BuiltinIcon type={card.type} className="size-4" />}
                    title={card.title}
                    description={card.description}
                    badge={present.has(card.type) ? "On the board" : undefined}
                    onAdd={() => onAddBuiltin(card.type)}
                  />
                ))
              : CARD_TEMPLATES.map((template) => {
                  const Icon = DISPLAY_ICON[template.query.display];
                  return (
                    <GalleryItem
                      key={template.id}
                      icon={<Icon className="size-4" />}
                      title={template.title}
                      description={template.description}
                      onAdd={() => onAddTemplate(template)}
                    />
                  );
                })}
          </div>
        </OverlayPanel>
      </OverlayFrame>
    </>,
    document.body,
  );
}

function GalleryItem({
  icon,
  title,
  description,
  badge,
  onAdd,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="group flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          {badge ? <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{badge}</span> : null}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span>
      </span>
      <Plus className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
