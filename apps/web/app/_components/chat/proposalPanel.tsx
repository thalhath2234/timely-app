"use client";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  ClipboardList,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import type { Chat } from "@/app/utils/api/chat";
import { cn } from "@/app/utils/cn";
import ChangeCards from "./changeCards";
import { isBusy, phaseLabel, sharedTarget } from "./chatMeta";

const button =
  "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${button} bg-primary text-primary-foreground shadow-sm hover:bg-primary/90`;
const secondary = `${button} border border-border bg-card text-foreground hover:border-primary/30 hover:bg-muted/50`;

/**
 * The live plan: waiting for approval, being applied, finished, stopped or
 * failed. Superseded plans live in the message list as archives.
 */
export default function ProposalPanel({
  chat,
  pending,
  receiptDirty,
  act,
}: {
  chat: Chat;
  pending: boolean;
  receiptDirty: boolean;
  act: (action: string, body?: unknown) => void;
}) {
  const steps = chat.plan;
  const done = steps.filter((s) => s.status === "done").length;
  const busy = isBusy(chat.status);
  const applying = busy && chat.phase === "apply";
  const activeIndex = applying
    ? steps.findIndex((s) => s.status !== "done")
    : -1;
  const complete = done === steps.length;
  // When everything applied changed one page, offer it from the header.
  const target =
    !busy && chat.status !== "approval" ? sharedTarget(steps) : null;
  const heading =
    chat.status === "approval"
      ? "Ready for your review"
      : applying
        ? "Applying changes"
        : chat.status === "failed"
          ? "Some changes did not finish"
          : chat.status === "stopped"
            ? "Stopped before finishing"
            : complete
              ? "Changes applied"
              : "Your changes";
  const hint =
    chat.status === "approval"
      ? receiptDirty
        ? "Receipt fields changed. Select Review sheet changes before applying."
        : chat.imageReview?.status === "review"
          ? "Apply saves these changes and removes the temporary images."
          : "Nothing is saved until you apply. To adjust, just reply below."
      : chat.status === "failed"
        ? "Finished changes are kept. Retry continues from the first unfinished step."
        : chat.status === "stopped"
          ? "Completed changes are kept. Resume to review what is left."
          : applying
            ? "You can leave this chat; progress is saved as it goes."
            : "";
  return (
    <section
      aria-label="Proposed changes"
      className={cn(
        "mt-6 overflow-hidden rounded-2xl border bg-muted/30",
        chat.status === "approval" ? "border-warning/40" : "border-border",
      )}
    >
      <header className="flex items-center gap-3 px-4 pt-4">
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            chat.status === "approval"
              ? "bg-warning/15 text-warning"
              : complete
                ? "bg-success/15 text-success"
                : "bg-primary/10 text-primary",
          )}
        >
          {complete ? (
            <Check className="size-4" />
          ) : (
            <ClipboardList className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-5">{heading}</h2>
          <p className="text-xs text-muted-foreground">
            {done} of {steps.length} {steps.length === 1 ? "change" : "changes"}{" "}
            applied
          </p>
        </div>
        {target && (
          <Link href={target.href} title={target.title} className={secondary}>
            Open {target.noun}
            <ArrowUpRight className="size-3.5" />
          </Link>
        )}
        {applying && (
          <button
            type="button"
            aria-label="Stop run"
            disabled={pending}
            onClick={() => act("/stop")}
            className={secondary}
          >
            <Square className="size-3.5 fill-current" />
            Stop
          </button>
        )}
      </header>
      <div className="px-4 pt-3">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
          className="h-1 overflow-hidden rounded-full bg-border"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500",
              chat.status === "failed" ? "bg-destructive" : "bg-primary",
            )}
            style={{
              width: `${steps.length ? (done / steps.length) * 100 : 0}%`,
            }}
          />
        </div>
      </div>
      <div className="p-4">
        <ChangeCards steps={steps} activeIndex={activeIndex} />
      </div>
      {(hint ||
        chat.status === "approval" ||
        ["failed", "stopped"].includes(chat.status)) && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-card/60 px-4 py-3">
          <p className="max-w-md text-xs leading-5 text-muted-foreground">
            {hint}
          </p>
          <div className="flex items-center gap-2">
            {chat.status === "approval" && (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act("/reject", { revision: chat.revision })}
                  className={secondary}
                >
                  <Trash2 className="size-3.5" />
                  Discard
                </button>
                <button
                  type="button"
                  disabled={pending || receiptDirty}
                  onClick={() => act("/approve", { revision: chat.revision })}
                  className={primary}
                >
                  <Check className="size-4" />
                  Apply changes
                </button>
              </>
            )}
            {["failed", "stopped"].includes(chat.status) && (
              <button
                type="button"
                disabled={pending}
                onClick={() => act("/retry")}
                className={primary}
              >
                <RefreshCw className="size-3.5" />
                {chat.phase === "apply"
                  ? "Review unfinished changes"
                  : "Try again"}
              </button>
            )}
          </div>
        </footer>
      )}
      {applying && !hint && (
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          {phaseLabel(chat.phase)}
        </p>
      )}
    </section>
  );
}
