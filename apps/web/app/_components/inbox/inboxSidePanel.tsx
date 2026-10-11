"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { buttonClass, Kbd } from "@/app/_components/_ui/button";
import { useDecisions } from "@/app/utils/hooks/decisions";

const card = "rounded-xl border border-border bg-card p-4";
const label = "text-xs font-medium text-muted-foreground";

const KEYS: [string, string][] = [
  ["T", "Make it a task"],
  ["R", "Remind me"],
  ["S", "Later"],
  ["Del", "Delete"],
  ["C", "Capture"],
  ["N", "New task anywhere"],
];

/**
 * The Inbox's right column on wide screens: how much is waiting and how old it
 * is, the triage keys, and a pointer to smart suggestions when they are off.
 * It only summarises; the Up next card keeps the page's one strong colour.
 */
export default function InboxSidePanel({
  fresh,
  recent,
  stale,
  oldestDays,
}: {
  /** Captured today. */
  fresh: number;
  /** One or two days old. */
  recent: number;
  /** Old enough to count as stale. */
  stale: number;
  oldestDays: number;
}) {
  const decisions = useDecisions();
  const total = fresh + recent + stale;
  const rows = [
    { key: "fresh", name: "New today", count: fresh, swatch: "bg-success" },
    { key: "recent", name: "This week", count: recent, swatch: "bg-primary/45" },
    { key: "stale", name: "Getting stale", count: stale, swatch: "bg-warning" },
  ];

  return (
    <aside aria-label="Inbox summary" className="sticky top-0 flex flex-col gap-3" data-testid="inbox-side-panel">
      <section className={card}>
        <h2 className={label}>Waiting for a decision</h2>
        <p className="mt-1 flex items-baseline gap-1.5">
          <span className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">{total}</span>
          <span className="text-sm text-muted-foreground">{total === 1 ? "capture" : "captures"}</span>
        </p>
        {total > 0 ? (
          <>
            <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              {rows.map((row) =>
                row.count > 0 ? (
                  <span key={row.key} className={row.swatch} style={{ flexGrow: row.count, flexBasis: 0 }} />
                ) : null,
              )}
            </div>
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {rows.map((row) => (
                <li key={row.key} className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${row.swatch}`} aria-hidden />
                  <span className="flex-1 text-muted-foreground">{row.name}</span>
                  <span className="font-medium tabular-nums text-foreground">{row.count}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
              {oldestDays > 1
                ? `The oldest has waited ${oldestDays} days. It is up next.`
                : "Nothing has waited long. Keep it that way."}
            </p>
          </>
        ) : null}
      </section>

      {decisions.data && !decisions.data.available ? (
        <section className={card}>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Sparkles className="size-4 text-primary" aria-hidden />
            Suggested next steps
          </h2>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            With smart suggestions on, Up next shows what each capture looks like: a task, how long it takes,
            and when it is due. The Clarify form opens already filled in.
          </p>
          <Link href="/settings?tab=agent" className={buttonClass({ variant: "outline", size: "sm", className: "mt-3" })}>
            Turn on in Settings
          </Link>
        </section>
      ) : null}

      <section className={card}>
        <h2 className={label}>Keys</h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
          {KEYS.map(([key, action]) => (
            <div key={key} className="contents">
              <dt>
                <Kbd className="h-5 min-w-6 text-[11px] opacity-100 text-muted-foreground">{key}</Kbd>
              </dt>
              <dd className="text-muted-foreground">{action}</dd>
            </div>
          ))}
        </dl>
      </section>
    </aside>
  );
}
