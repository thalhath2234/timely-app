"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import { cn } from "@/app/utils/cn";

function describe(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

type LoadErrorProps = {
  /** What failed to load, e.g. "tasks". Used in the headline. */
  what: string;
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
};

/**
 * Full-height failure state for a list that has nothing cached yet. Never
 * render an "empty" placeholder for a request that failed: the user must be
 * able to tell "no work" from "could not load work".
 */
export default function LoadError({ what, error, onRetry, retrying, className }: LoadErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-6 py-12 text-center",
        className,
      )}
    >
      <AlertTriangle className="size-7 text-destructive" />
      <p className="text-sm font-medium text-foreground">Couldn&apos;t load {what}</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {describe(error, "The server did not respond. Nothing shown here is missing; it just has not loaded.")}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {retrying ? <LogoSpinner size={14} tone="mono" label="Retrying" /> : <RefreshCw className="size-3.5" />}
          {retrying ? "Retrying…" : "Retry"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Inline banner for a list that already has data on screen. The stale rows
 * stay visible; the banner says the latest refresh failed and offers Retry.
 */
export function LoadErrorBanner({ what, error, onRetry, retrying, className }: LoadErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-foreground",
        className,
      )}
    >
      <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">Couldn&apos;t refresh {what}.</span>{" "}
        <span className="text-muted-foreground">
          Showing the last loaded copy. {describe(error, "")}
        </span>
      </span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 font-medium text-secondary-foreground hover:bg-accent disabled:opacity-60"
        >
          {retrying ? <LogoSpinner size={12} label="Retrying" /> : <RefreshCw className="size-3" />}
          {retrying ? "Retrying…" : "Retry"}
        </button>
      ) : null}
    </div>
  );
}

/** Picks the banner when stale data exists and the full state otherwise. */
export function QueryFailure({
  what,
  error,
  hasData,
  onRetry,
  retrying,
  className,
}: LoadErrorProps & { hasData: boolean }) {
  if (hasData) {
    return (
      <LoadErrorBanner what={what} error={error} onRetry={onRetry} retrying={retrying} className={className} />
    );
  }
  return <LoadError what={what} error={error} onRetry={onRetry} retrying={retrying} className={className} />;
}
