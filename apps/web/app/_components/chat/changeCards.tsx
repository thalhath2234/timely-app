"use client";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  FileText,
  FolderKanban,
  CalendarDays,
  Table2,
  Circle,
  ArrowUpRight,
} from "lucide-react";
import type { ChatStep } from "@/app/utils/api/chat";
import ChatText from "./chatText";

function label(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, (s) => s.toUpperCase());
}
function Value({ value, field = "" }: { value: unknown; field?: string }) {
  if (value == null || value === "")
    return <span className="text-muted-foreground">Empty</span>;
  if (typeof value === "string") {
    if (field === "markdown" || field === "description")
      return <ChatText text={value} />;
    if (/^\$\d+\./.test(value))
      return (
        <span>From change {Number(value.slice(1).split(".")[0]) + 1}</span>
      );
    return <span className="whitespace-pre-wrap break-words">{value}</span>;
  }
  if (typeof value === "number" || typeof value === "boolean")
    return <span>{String(value)}</span>;
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
              <thead className="bg-muted">
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
                className="grid gap-1 sm:grid-cols-[120px_minmax(0,1fr)]"
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
function target(step: ChatStep) {
  const result = step.result;
  if (!result) return null;
  for (const [key, path] of [
    ["sheet", "sheets"],
    ["task", "tasks"],
    ["project", "projects"],
    ["doc", "docs"],
  ]) {
    const item = result[key] as Record<string, unknown> | undefined;
    if (typeof item?.id === "string")
      return {
        href:
          key === "task"
            ? `/tasks?taskId=${encodeURIComponent(item.id)}`
            : `/${path}/${encodeURIComponent(item.id)}`,
        title: String(item.title || item.name || `Open ${key}`),
      };
  }
  if (typeof result.id === "string") {
    const kind = step.tool.includes("sheet_template")
      ? "sheets/templates"
      : step.tool.includes("doc")
        ? "docs"
        : step.tool.includes("project")
          ? "projects"
          : step.tool.includes("event")
            ? "calendar"
            : "";
    if (kind)
      return {
        href:
          kind === "calendar"
            ? "/calendar"
            : `/${kind}/${encodeURIComponent(result.id)}`,
        title: String(result.title || result.name || "Open item"),
      };
  }
  return null;
}
export default function ChangeCards({ steps }: { steps: ChatStep[] }) {
  return (
    <div className="space-y-2">
      {steps.map((step, index) => {
        const Icon = step.tool.includes("sheet")
          ? Table2
          : step.tool.includes("doc")
            ? FileText
            : step.tool.includes("event") || step.tool.includes("schedule")
              ? CalendarDays
              : FolderKanban;
        const link = target(step);
        return (
          <div
            key={index}
            className="overflow-hidden rounded-xl border border-border bg-background"
          >
            <div className="flex items-start gap-3 p-4">
              <div className="rounded-lg bg-muted p-2 text-muted-foreground">
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-6">{step.summary}</p>
                {link && (
                  <Link
                    className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    href={link.href}
                  >
                    {link.title}
                    <ArrowUpRight className="size-3" />
                  </Link>
                )}
              </div>
              {step.status === "done" ? (
                <Check
                  aria-label="Completed"
                  className="mt-2 size-4 text-primary"
                />
              ) : (
                <Circle
                  aria-label="Pending"
                  className="mt-2 size-3 text-muted-foreground"
                />
              )}
            </div>
            <details className="group border-t border-border/60">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground">
                <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
                Review details
              </summary>
              <div className="max-h-96 overflow-auto border-t border-border/60 p-4">
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
          </div>
        );
      })}
    </div>
  );
}
