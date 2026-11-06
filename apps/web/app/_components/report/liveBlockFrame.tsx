"use client";

import { useMemo, type ReactNode } from "react";
import { LayoutDashboard } from "lucide-react";
import { describedSources, SOURCE_LABELS } from "@timely/contract/dashboard";
import { liveBlockCards } from "@timely/contract/genuiBoard";
import { SkeletonLines } from "@/app/_components/_ui/skeleton";
import DescribedCardView from "./describedCard";
import { useDashboardData } from "./useDashboard";

/*
 * The parts of a live block (a described card inside a doc) that the doc
 * editor and the Describe dialog's preview share, so the preview is the
 * block as the doc will show it. Styles: .doc-live in globals.css.
 */

/** "tasks and events": what a program reads, for its hint. */
export function liveSourcesText(program: string) {
  const names = describedSources(program).map((source) => SOURCE_LABELS[source].replace("Calendar events", "events").toLowerCase());
  if (names.length <= 1) return names.join("") || "data";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The block's frame: its name and a Live mark above the drawn card. */
export function LiveBlockFrame({
  title,
  program,
  actions,
  children,
}: {
  title: string;
  program: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const hint = program.trim() ? `Reads your ${liveSourcesText(program)} each time the doc opens. The AI isn't asked again.` : undefined;
  return (
    <>
      <div className="doc-live-head" contentEditable={false}>
        <LayoutDashboard className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{title}</span>
        <span className="doc-live-mark" title={hint}>
          <span className="doc-live-dot" aria-hidden />
          Live
        </span>
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div> : null}
      </div>
      {children}
    </>
  );
}

/** The program drawn over the person's data, at the doc's width. */
export function LiveBlockBody({ program }: { program: string }) {
  const cards = useMemo(() => liveBlockCards([program]), [program]);
  const { data, loading, timeZone } = useDashboardData(cards);
  const now = useMemo(() => new Date(), []);
  const waiting = describedSources(program).some((source) => loading[source as keyof typeof loading]);
  return (
    <div className="doc-live-body" contentEditable={false}>
      {waiting ? <SkeletonLines lines={3} className="px-4 py-3" /> : <DescribedCardView program={program} data={data} timeZone={timeZone} now={now} layout="doc" />}
    </div>
  );
}
