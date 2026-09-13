"use client";

import { saveStatusLabel, type SaveStatus } from "@/app/utils/hooks/useAutosave";

export default function SaveStatusBadge({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry?: () => void;
}) {
  if (status === "idle") return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {saveStatusLabel(status)}
      {status === "error" && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="font-medium text-foreground underline underline-offset-2"
        >
          Retry
        </button>
      ) : null}
    </span>
  );
}
