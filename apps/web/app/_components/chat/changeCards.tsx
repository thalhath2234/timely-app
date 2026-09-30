"use client";
import Link from "next/link";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import type { ChatStep } from "@/app/utils/api/chat";
import { cn } from "@/app/utils/cn";
import ChatText from "./chatText";
import { stepIcon, stepMeta, stepTarget } from "./chatMeta";

function label(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, (s) => s.toUpperCase());
}
export function Value({
  value,
  field = "",
}: {
  value: unknown;
  field?: string;
}) {
  if (value == null || value === "")
    return <span className="text-muted-foreground">Empty</span>;
  if (typeof value === "string") {
    if (field === "markdown" || field === "description")
      return <ChatText text={value} />;
    if (/^\$\d+\./.test(value))
      return (
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
          From change {Number(value.slice(1).split(".")[0]) + 1}
        </span>
      );
    return <span className="whitespace-pre-wrap break-words">{value}</span>;
  }
  if (typeof value === "number" || typeof value === "boolean")
    return <span className="tabular-nums">{String(value)}</span>;
  if (Array.isArray(value))
    return (
      <div className="space-y-2">
        {value.map((v, i) => (
          <div key={i} className="border-l-2 border-border pl-3">
            <Value value={v} />
          </div>
        ))}
      </div>
    );
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const columns = Array.isArray(record.columns)
      ? (record.columns as { id?: string; name?: string; type?: string }[])
      : null;
    const rows = Array.isArray(record.rows)
      ? (record.rows as { cells?: Record<string, unknown> }[])
      : null;
    return (
      <div className="space-y-3">
        {columns && rows && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/70">
                <tr>
                  {columns.map((col, i) => (
                    <th
                      key={col.id || i}
                      className="whitespace-nowrap px-3 py-2 font-medium"
                    >
                      {col.name || `Column ${i + 1}`}
                      <span className="block font-normal text-muted-foreground">
                        {col.type}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-t border-border">
                    {columns.map((col, j) => (
                      <td key={col.id || j} className="max-w-64 px-3 py-2">
                        <Value value={row.cells?.[col.id || col.name || ""]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <dl className="space-y-2">
          {Object.entries(record)
            .filter(
              ([k]) =>
                !["id", "userId", "createdAt", "updatedAt"].includes(k) &&
                !(columns && rows && ["columns", "rows"].includes(k)),
            )
            .map(([k, v]) => (
              <div
                key={k}
                className="grid gap-1 sm:grid-cols-[132px_minmax(0,1fr)]"
              >
                <dt className="text-xs text-muted-foreground">{label(k)}</dt>
                <dd className="min-w-0 text-xs leading-6">
                  <Value value={v} field={k} />
                </dd>
              </div>
            ))}
        </dl>
      </div>
    );
  }
  return null;
}

/**
 * One card per proposed or completed write. `activeIndex` marks the step the
 * server is currently applying so it reads as in progress rather than pending.
 */
export default function ChangeCards({
  steps,
  activeIndex = -1,
  muted = false,
}: {
  steps: ChatStep[];
  activeIndex?: number;
  muted?: boolean;
}) {
  return (
    <ol className="space-y-2" aria-label="Changes">
      {steps.map((step, index) => {
        const Icon = stepIcon(step.tool);
        const status = stepMeta(step.status, index === activeIndex);
        const StatusIcon = status.icon;
        const link = stepTarget(step);
        return (
          <li
            key={index}
            className={cn(
              "overflow-hidden rounded-xl border bg-card transition-colors",
              step.status === "failed"
                ? "border-destructive/40"
                : "border-border",
              muted && "opacity-80",
            )}
          >
            <div className="flex items-start gap-3 p-3.5">
              <div className="relative shrink-0">
                <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </div>
                <span
                  aria-label={status.label}
                  title={status.label}
                  className={cn(
                    "absolute -bottom-1 -right-1 flex size-4.5 items-center justify-center rounded-full border-2 border-card",
                    status.className,
                  )}
                >
                  <StatusIcon
                    className={cn("size-2.5", status.spin && "animate-spin")}
                    strokeWidth={3}
                  />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-2 text-sm font-medium leading-5">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span
                    className={cn(
                      "min-w-0",
                      step.status === "discarded" &&
                        "text-muted-foreground line-through",
                    )}
                  >
                    {step.summary}
                  </span>
                </p>
                {step.status === "failed" && step.error && (
                  <p
                    role="alert"
                    className="mt-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs leading-5 text-destructive"
                  >
                    {step.error}
                  </p>
                )}
                {link && step.status === "done" && (
                  <Link
                    className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-primary/8 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/15"
                    href={link.href}
                  >
                    {link.title}
                    <ArrowUpRight className="size-3" />
                  </Link>
                )}
              </div>
            </div>
            <details className="group border-t border-border/60">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground">
                <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
                Review details
              </summary>
              <div className="max-h-96 overflow-auto border-t border-border/60 bg-muted/20 p-3.5">
                <Value value={step.arguments} />
                {step.before && (
                  <details className="mt-4 border-t border-border pt-3">
                    <summary className="cursor-pointer text-xs font-medium">
                      Existing content
                    </summary>
                    <div className="mt-3">
                      <Value value={step.before} />
                    </div>
                  </details>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
