"use client";

import { Calendar, Check, Home, ListTodo, Star } from "lucide-react";
import { RailSection } from "@/app/_components/_ui/pageWithRail";
import { usePreferences } from "@/app/_components/_layout/clientRuntime";

/** A small live picture of the app drawn with the current theme and accent:
 * the shell's rail, a page header, a stat card and a button. It changes as
 * the settings beside it change. */
export default function AppearancePreview() {
  const { theme, accent, reducedMotion } = usePreferences();
  const themeLabel = theme === "system" ? "System" : theme === "dark" ? "Dark" : "Light";
  return (
    <RailSection title="Preview" meta={`${themeLabel} · ${accent === "default" ? "Violet" : "Custom accent"}`} data-testid="appearance-preview">
      <div aria-hidden className="overflow-hidden rounded-[10px] border border-border bg-sidebar">
        <div className="flex h-44">
          <div className="flex w-9 shrink-0 flex-col items-center gap-2 py-2.5 text-sidebar-foreground">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Home className="size-3" />
            </span>
            <span className="flex size-6 items-center justify-center rounded-md text-muted-foreground">
              <ListTodo className="size-3" />
            </span>
            <span className="flex size-6 items-center justify-center rounded-md text-muted-foreground">
              <Calendar className="size-3" />
            </span>
          </div>
          <div className="min-w-0 flex-1 bg-background p-3 text-foreground">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[15px] font-semibold tracking-[-0.02em]">Today</span>
              <span className="inline-flex h-5 items-center gap-1 rounded-md bg-primary px-2 text-[10px] font-medium text-primary-foreground">
                <Star className="size-2.5" /> Add to focus
              </span>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <div className="rounded-[8px] border border-border bg-card p-2">
                <span className="block text-lg font-semibold leading-6 tabular-nums">3 of 5</span>
                <span className="block text-[10px] text-muted-foreground">focus done</span>
              </div>
              <div className="rounded-[8px] border border-border bg-card p-2">
                <span className="block text-lg font-semibold leading-6 tabular-nums text-primary">2h 30m</span>
                <span className="block text-[10px] text-muted-foreground">planned</span>
              </div>
            </div>
            <div className="mt-2 rounded-[8px] border border-border bg-card px-2 py-1.5">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-2.5" />
                </span>
                <span className="truncate text-muted-foreground line-through">Write the release notes</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px]">
                <span className="size-3.5 rounded-full border border-muted-foreground/40" />
                <span className="truncate">Review the design report</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {reducedMotion ? "Motion is off on this device: lists and panels appear in place." : "Lists rise in, panels pop, pages crossfade."}
      </p>
    </RailSection>
  );
}
