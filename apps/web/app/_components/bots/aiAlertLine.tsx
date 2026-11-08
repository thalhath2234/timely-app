"use client";

import {
  alertAi,
  alsoSeenLine,
  sharedLine,
  type AlertBrief,
} from "@timely/contract/bots";
import { cn } from "@/app/utils/cn";
import { Pill } from "./countPill";

type AiAlert = Pick<
  AlertBrief,
  "aiState" | "aiWhy" | "held" | "alsoSeenBy" | "sharedWith"
> &
  Partial<Pick<AlertBrief, "kind">>;

/**
 * What the AI judge did with an alert, and who else saw the same thing.
 * `compact` (the Needs you card) is one muted line for the judge and one for
 * "Also seen by", each clamped to a line, with no pill. `full` (the rail)
 * adds the "Not checked by AI" pill and lets the lines wrap; a held shared
 * alert says which alert already told the person. Renders nothing on a
 * rules-only alert seen by no other bot.
 */
export function AiAlertLine({
  alert,
  variant,
  className,
}: {
  alert: AiAlert;
  variant: "compact" | "full";
  className?: string;
}) {
  const ai = alertAi(alert);
  const seen = alsoSeenLine(alert);
  const shared = sharedLine(alert);

  if (variant === "compact") {
    if (!ai.short && !seen) return null;
    return (
      <div className={cn("min-w-0 text-xs text-muted-foreground", className)}>
        {ai.short ? (
          <p className="truncate" title={ai.line ?? ai.short}>
            {ai.short}
          </p>
        ) : null}
        {seen ? <p className="truncate">{seen}</p> : null}
      </div>
    );
  }

  if (!ai.pill && !ai.line && !seen && !shared) return null;
  // "Held back by AI" is the eyebrow of a held item, so its line keeps only the why.
  const line =
    alert.held === "judged" && ai.line
      ? ai.line.replace(/^Held back by AI:?\s*/, "")
      : ai.line;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 text-xs leading-relaxed text-muted-foreground",
        className,
      )}
    >
      {ai.pill ? (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Pill tone="warning">{ai.pill}</Pill>
          {line ? <span className="min-w-0">{line}</span> : null}
        </span>
      ) : line ? (
        <p className="min-w-0">{line}</p>
      ) : null}
      {shared ? <p className="min-w-0">{shared}</p> : null}
      {seen ? <p className="min-w-0">{seen}</p> : null}
    </div>
  );
}
