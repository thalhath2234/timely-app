"use client";

import { Sparkles } from "lucide-react";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import type { ClarifySuggestions } from "@/app/utils/api/decisions";

const DATE_FIELD: Record<NonNullable<ClarifySuggestions["dateRole"]>, string> = {
  deadline: "a deadline",
  start: "a start date",
  reminder: "a reminder time",
};

const MISSING: Record<NonNullable<ClarifySuggestions["missing"]>, string> = {
  duration: "It is not clear how long this takes.",
  place: "It may need a place.",
  date: "It may need a date.",
  scope: "It is not clear what done looks like.",
};

/** Notes from smart suggestions above the Clarify form. The fields they
 * filled stay editable; these lines only point at things worth a look. */
export default function ClarifyHints({
  loading,
  suggestions,
  onOpenDuplicate,
}: {
  loading: boolean;
  suggestions?: ClarifySuggestions;
  onOpenDuplicate: (id: string) => void;
}) {
  if (loading) {
    return (
      <p
        className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"
        data-testid="clarify-suggestions-loading"
      >
        <LogoSpinner size={12} label="Getting suggestions" />
        Getting suggestions…
      </p>
    );
  }
  if (!suggestions) return null;

  const notes: string[] = [];
  if (suggestions.looksLikeEvent)
    notes.push("This looks like an event at a fixed time. It may belong on the calendar.");
  if (suggestions.dateRole)
    notes.push(
      `The date in the name looks like ${DATE_FIELD[suggestions.dateRole]}. Set it in the fields on the right.`,
    );
  if (suggestions.severalActions)
    notes.push("This looks like more than one action. Consider splitting it.");
  if (suggestions.notReady)
    notes.push("This may not be ready to act on yet. It can stay in the Inbox.");
  if (suggestions.missing) notes.push(MISSING[suggestions.missing]);
  const duplicates = suggestions.duplicates ?? [];

  return (
    <div
      className="mt-3 flex flex-col gap-1.5 rounded-lg border border-primary/25 bg-primary/[0.04] px-3 py-2 text-xs text-muted-foreground"
      data-testid="clarify-suggestions"
    >
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <Sparkles className="size-3.5 text-primary" />
        Some fields were filled in for you. Check them before you save.
      </p>
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
      {duplicates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span>Might already exist:</span>
          {duplicates.map((dup) => (
            <button
              key={dup.id}
              type="button"
              onClick={() => onOpenDuplicate(dup.id)}
              className="max-w-56 truncate rounded-md border border-border bg-background px-1.5 py-0.5 text-foreground hover:bg-muted/60"
              title="Open this task (the Inbox item stays in the Inbox)"
            >
              {dup.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
