"use client";
import {
  createElement,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  FileText,
  ListChecks,
  Pencil,
  Plus,
  RotateCcw,
  Sun,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  reviewGroups,
  reviewProgress,
  reviewStats,
  type DocBlock,
  type ReviewField,
  type ReviewGroup,
  type ReviewNames,
  type ReviewProgress,
  type ReviewSheetTab,
  type ReviewTaskRow,
} from "@timely/contract/changeReview";
import Button from "@/app/_components/_ui/button";
import { revealProps } from "@/app/_components/_ui/motion";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import type { ChatStep } from "@/app/utils/api/chat";
import { cn } from "@/app/utils/cn";
import { useDocs } from "@/app/utils/hooks/docs";
import { useProjects } from "@/app/utils/hooks/projects";
import { useSheets } from "@/app/utils/hooks/sheets";
import { useTasks } from "@/app/utils/hooks/tasks";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { stepIcon, stepTarget } from "./chatMeta";

/** Names for the ids a plan mentions, from the lists the app already has. */
function useReviewNames(): ReviewNames {
  const workspaces = useWorkspaces().data;
  const projects = useProjects().data;
  const sheets = useSheets().data;
  const docs = useDocs().data;
  const tasks = useTasks().data;
  return useMemo(() => {
    const index = <T,>(
      items: T[] | undefined,
      id: (item: T) => string,
      name: (item: T) => string | undefined,
    ) => {
      const map = new Map<string, string>();
      for (const item of items ?? []) {
        const value = name(item);
        if (value) map.set(id(item), value);
      }
      return (key: string) => map.get(key);
    };
    const all = workspaces ?? [];
    return {
      workspace: index(
        all,
        (w) => w.id,
        (w) => w.name,
      ),
      project: index(
        projects,
        (p) => p.id,
        (p) => p.title,
      ),
      task: index(
        tasks,
        (t) => t.id,
        (t) => t.name,
      ),
      doc: index(
        docs,
        (d) => d.id,
        (d) => d.title,
      ),
      sheet: (id: string) => {
        const sheet = sheets?.find((s) => s.id === id);
        return sheet
          ? {
              title: sheet.title,
              icon: sheet.icon ?? undefined,
              tabs: sheet.tabs,
              columns: sheet.columns,
            }
          : undefined;
      },
      label: index(
        all.flatMap((w) => w.lables ?? []),
        (l) => l.id,
        (l) => l.name,
      ),
      status: index(
        all.flatMap((w) => w.status ?? []),
        (s) => s.id,
        (s) => s.name,
      ),
      customField: index(
        all.flatMap((w) => w.customFields ?? []),
        (f) => f.id,
        (f) => f.name,
      ),
    };
  }, [workspaces, projects, sheets, docs, tasks]);
}

/** Apply or set aside one change while the proposal waits for review. */
export type ReviewActions = {
  apply: (steps: number[]) => void;
  discard: (steps: number[], keep: boolean) => void;
  disabled?: boolean;
};

const KIND_ICONS: Record<string, LucideIcon> = {
  sheet: Table2,
  doc: FileText,
  tasks: ListChecks,
  events: CalendarDays,
};

const STATE: Record<
  ReviewProgress["state"],
  { label: string; className: string }
> = {
  pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
  active: { label: "Applying", className: "bg-primary/12 text-primary" },
  done: { label: "Done", className: "bg-success/12 text-success" },
  failed: { label: "Failed", className: "bg-destructive/12 text-destructive" },
  discarded: {
    label: "Discarded",
    className: "bg-muted text-muted-foreground",
  },
  partial: { label: "Partly done", className: "bg-primary/12 text-primary" },
};

function StatusPill({ progress }: { progress: ReviewProgress }) {
  const state = STATE[progress.state];
  const label =
    progress.state === "partial" ||
    (progress.state === "active" && progress.total > 1)
      ? `${progress.done} of ${progress.total} done`
      : state.label;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium",
        state.className,
      )}
    >
      {progress.state === "active" ? (
        <LogoSpinner size={10} tone="mono" label="Applying" />
      ) : null}
      {progress.state === "done" ? (
        <Check className="size-3" strokeWidth={3} />
      ) : null}
      {label}
    </span>
  );
}

function OpenLink({
  step,
  label,
}: {
  step: ChatStep | undefined;
  label?: string;
}) {
  const target = step && step.status === "done" ? stepTarget(step) : null;
  if (!target) return null;
  return (
    <Link
      href={target.href}
      className="inline-flex max-w-full items-center gap-1 text-[13px] font-medium text-primary hover:underline hover:underline-offset-4"
      aria-label={`Open ${target.noun}${target.title ? `: ${target.title}` : ""}`}
    >
      {label ?? `Open ${target.noun}`}
      <ArrowUpRight className="size-3.5 shrink-0" />
    </Link>
  );
}

// ------------------------------------------------------------ sheet rows

const ROWS_SHOWN = 5;

/** Scroll shadows: a wide table fades at the edge it can still scroll to,
 * so a cut-off column reads as "more this way" rather than a broken row. */
const SCROLL_EDGES: CSSProperties = {
  background: [
    "linear-gradient(to right, var(--card) 30%, transparent) left / 32px 100% no-repeat local",
    "linear-gradient(to left, var(--card) 30%, transparent) right / 32px 100% no-repeat local",
    "radial-gradient(farthest-side at 0 50%, color-mix(in oklab, var(--foreground) 16%, transparent), transparent) left / 12px 100% no-repeat scroll",
    "radial-gradient(farthest-side at 100% 50%, color-mix(in oklab, var(--foreground) 16%, transparent), transparent) right / 12px 100% no-repeat scroll",
  ].join(", "),
};

function SheetTab({ tab, steps }: { tab: ReviewSheetTab; steps: ChatStep[] }) {
  const [all, setAll] = useState(false);
  const rows = all ? tab.rows : tab.rows.slice(0, ROWS_SHOWN);
  return (
    <div className="border-t border-border">
      <div className="flex min-h-9 flex-wrap items-baseline gap-x-2 px-4 pb-1 pt-2.5">
        <h4 className="text-[13px] font-semibold">{tab.name}</h4>
        <span className="text-xs font-medium text-muted-foreground">
          {tab.rows.length} {tab.rows.length === 1 ? "entry" : "entries"}
        </span>
        {tab.same.length ? (
          <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">
            Each with{" "}
            {tab.same.map((field, i) => (
              <span key={field.label}>
                {i ? ", " : ""}
                {field.label}{" "}
                <span className="font-medium text-foreground">
                  {field.value}
                </span>
              </span>
            ))}
          </span>
        ) : null}
      </div>
      <div className="overflow-x-auto" style={SCROLL_EDGES}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border">
              {tab.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap px-2.5 py-1.5 text-xs font-medium text-muted-foreground first:pl-4 last:pr-4",
                    column.numeric ? "text-right" : "text-left",
                  )}
                >
                  {column.name}
                  {column.unit ? (
                    <span className="font-normal"> ({column.unit})</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr
                key={r}
                className={cn(
                  "border-b border-border last:border-b-0",
                  steps[row.step]?.status === "discarded" &&
                    "text-muted-foreground line-through",
                )}
              >
                {row.cells.map((cell, c) => (
                  <td
                    key={c}
                    className={cn(
                      "max-w-60 truncate whitespace-nowrap px-2.5 py-1.5 first:pl-4 last:pr-4",
                      tab.columns[c].numeric && "text-right tabular-nums",
                      c === tab.lead && "font-medium",
                    )}
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tab.rows.length > ROWS_SHOWN ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll(!all)}
          className="w-full border-t border-border px-4 py-2 text-left text-[13px] font-medium text-primary hover:bg-muted/50"
        >
          {all ? "Show fewer" : `Show all ${tab.rows.length}`}
        </button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ docs

/** A doc's blocks as the doc will show them: tick boxes, not "[ ]". */
export function DocBlocks({
  blocks,
  className,
}: {
  blocks: DocBlock[];
  className?: string;
}) {
  return (
    <div className={cn("space-y-1 text-sm leading-6", className)}>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <p
                key={i}
                className={cn(
                  "font-semibold",
                  block.level <= 1 ? "pt-2 text-base" : "pt-1.5 text-sm",
                  i === 0 && "pt-0",
                )}
              >
                {block.text}
              </p>
            );
          case "check":
            return (
              <p
                key={i}
                className="flex items-start gap-2.5"
                style={{ paddingLeft: block.depth * 20 }}
              >
                <span
                  aria-label={block.checked ? "Ticked" : "Not ticked"}
                  className={cn(
                    "mt-1 flex size-4 shrink-0 items-center justify-center rounded-[5px] border",
                    block.checked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input",
                  )}
                >
                  {block.checked ? (
                    <Check className="size-3" strokeWidth={3} />
                  ) : null}
                </span>
                <span
                  className={cn(
                    block.checked && "text-muted-foreground line-through",
                  )}
                >
                  {block.text}
                </span>
              </p>
            );
          case "bullet":
            return (
              <p
                key={i}
                className="flex items-start gap-2.5"
                style={{ paddingLeft: block.depth * 20 }}
              >
                <span
                  aria-hidden
                  className="w-4 shrink-0 text-center text-muted-foreground"
                >
                  {block.marker}
                </span>
                <span>{block.text}</span>
              </p>
            );
          case "quote":
            return (
              <p
                key={i}
                className="border-l-2 border-border pl-3 text-muted-foreground"
              >
                {block.text}
              </p>
            );
          case "code":
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-5"
              >
                {block.text}
              </pre>
            );
          case "divider":
            return <hr key={i} className="my-2 border-border" />;
          case "image":
            return (
              <p key={i} className="text-xs text-muted-foreground">
                Image{block.alt ? `: ${block.alt}` : ""}
              </p>
            );
          default:
            return <p key={i}>{block.text}</p>;
        }
      })}
    </div>
  );
}

const DOC_SHOWN = 16;

function DocBody({ group }: { group: Extract<ReviewGroup, { kind: "doc" }> }) {
  const [all, setAll] = useState(false);
  const blocks = all ? group.blocks : group.blocks.slice(0, DOC_SHOWN);
  return (
    <>
      {group.fields.length ? <FieldRows fields={group.fields} /> : null}
      {blocks.length ? (
        <div className="border-t border-border px-4 py-3">
          <DocBlocks blocks={blocks} />
        </div>
      ) : null}
      {group.blocks.length > DOC_SHOWN ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll(!all)}
          className="w-full border-t border-border px-4 py-2 text-left text-[13px] font-medium text-primary hover:bg-muted/50"
        >
          {all ? "Show less" : `Show the whole doc`}
        </button>
      ) : null}
    </>
  );
}

// ----------------------------------------------------------------- tasks

const TASK_LEADS: Record<
  ReviewTaskRow["action"],
  { icon: LucideIcon; className: string; label: string }
> = {
  create: {
    icon: Plus,
    className: "border border-dashed border-primary/60 text-primary",
    label: "New",
  },
  complete: {
    icon: Check,
    className: "bg-success text-white",
    label: "Mark done",
  },
  reopen: {
    icon: RotateCcw,
    className: "border border-border text-muted-foreground",
    label: "Reopen",
  },
  focus: {
    icon: Sun,
    className: "border border-border text-muted-foreground",
    label: "Focus",
  },
  update: {
    icon: Pencil,
    className: "border border-border text-muted-foreground",
    label: "Changes",
  },
  other: {
    icon: Pencil,
    className: "border border-border text-muted-foreground",
    label: "Changes",
  },
};

function Change({ field }: { field: ReviewField }) {
  return (
    <span>
      {field.label}{" "}
      {field.was ? (
        <>
          <s className="text-muted-foreground/80">{field.was}</s> →{" "}
        </>
      ) : null}
      <span className="text-foreground">{field.value}</span>
    </span>
  );
}

function TaskRows({
  group,
  steps,
}: {
  group: Extract<ReviewGroup, { kind: "tasks" }>;
  steps: ChatStep[];
}) {
  return (
    <ul className="divide-y divide-border border-t border-border">
      {group.rows.map((row) => {
        const lead = TASK_LEADS[row.action];
        const Icon = lead.icon;
        const step = steps[row.step];
        const target = step?.status === "done" ? stepTarget(step) : null;
        const facts = row.changes.length ? null : row.meta.join(" · ");
        return (
          <li
            key={row.step}
            className="flex min-h-11 items-start gap-3 px-4 py-2 text-sm"
          >
            <span
              aria-label={lead.label}
              title={lead.label}
              className={cn(
                "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full",
                lead.className,
              )}
            >
              <Icon className="size-3" strokeWidth={2.5} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-baseline gap-3">
                {target ? (
                  <Link
                    href={target.href}
                    className="min-w-0 truncate hover:underline hover:underline-offset-4"
                  >
                    {row.title}
                  </Link>
                ) : (
                  <span
                    className={cn(
                      "min-w-0 truncate",
                      step?.status === "discarded" &&
                        "text-muted-foreground line-through",
                    )}
                  >
                    {row.title}
                  </span>
                )}
                {facts ? (
                  <span className="ml-auto shrink-0 whitespace-nowrap text-[13px] font-medium text-muted-foreground">
                    {facts}
                  </span>
                ) : null}
              </p>
              {row.changes.length ? (
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs font-medium text-muted-foreground">
                  {row.changes
                    .filter((field) => !field.blocks)
                    .map((field) => (
                      <Change key={field.label} field={field} />
                    ))}
                </p>
              ) : null}
              {row.blocks?.length ? (
                <DocBlocks
                  blocks={row.blocks.slice(0, 6)}
                  className="mt-1 text-[13px] leading-5 text-muted-foreground"
                />
              ) : null}
              {step?.status === "failed" && step.error ? (
                <p className="mt-1 text-xs text-destructive">{step.error}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- events

function EventRows({
  group,
}: {
  group: Extract<ReviewGroup, { kind: "events" }>;
}) {
  return (
    <ul className="divide-y divide-border border-t border-border">
      {group.rows.map((row) => (
        <li
          key={row.step}
          className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm"
        >
          <span
            aria-hidden
            className="w-[3px] self-stretch rounded-full bg-primary"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate">{row.title}</p>
            {row.changes.length ? (
              <p className="flex flex-wrap gap-x-3 text-xs font-medium text-muted-foreground">
                {row.changes.map((field) => (
                  <Change key={field.label} field={field} />
                ))}
              </p>
            ) : row.meta.length ? (
              <p className="truncate text-xs font-medium text-muted-foreground">
                {row.meta.join(" · ")}
              </p>
            ) : null}
          </div>
          <span className="shrink-0 whitespace-nowrap text-[13px] font-medium tabular-nums text-muted-foreground">
            {row.when}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- fields

function FieldRows({ fields }: { fields: ReviewField[] }) {
  return (
    <dl className="divide-y divide-border border-t border-border">
      {fields.map((field) => (
        <div
          key={field.label}
          className={cn(
            "flex min-h-10 gap-4 px-4 py-2 text-[13px]",
            field.blocks ? "flex-col gap-1.5" : "items-center justify-between",
          )}
        >
          <dt className="shrink-0 font-medium">{field.label}</dt>
          <dd
            className={cn(
              "min-w-0 font-medium text-muted-foreground",
              !field.blocks && "text-right",
            )}
          >
            {field.blocks ? (
              <DocBlocks
                blocks={field.blocks}
                className="text-[13px] font-normal leading-5 text-foreground"
              />
            ) : (
              <span className="inline-flex max-w-full items-center gap-1.5">
                {field.color ? (
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: field.color }}
                  />
                ) : null}
                {field.was ? (
                  <>
                    <s className="text-muted-foreground/80">{field.was}</s>→
                  </>
                ) : null}
                <span className="whitespace-pre-wrap break-words text-foreground">
                  {field.value}
                </span>
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------ card

function GroupCard({
  group,
  steps,
  activeIndex,
  muted,
  index,
  open,
  onToggle,
  review,
}: {
  group: ReviewGroup;
  steps: ChatStep[];
  activeIndex: number;
  muted: boolean;
  index: number;
  open: boolean;
  onToggle: () => void;
  review?: ReviewActions;
}) {
  const bodyId = `review-${index}-${group.key.replace(/[^a-z0-9]/gi, "")}`;
  const progress = reviewProgress(group, steps, activeIndex);
  const own = group.steps.map((i) => steps[i]).filter(Boolean);
  // The changes this card can still apply or set aside, or bring back.
  const waiting = group.steps.filter(
    (i) =>
      steps[i] && steps[i].status !== "done" && steps[i].status !== "discarded",
  );
  const setAside = group.steps.filter((i) => steps[i]?.status === "discarded");
  const icon = createElement(
    group.kind === "change" ? stepIcon(group.tool) : KIND_ICONS[group.kind],
    { className: "size-4" },
  );
  const removal = group.removal && progress.state !== "done";
  // Rows open themselves (each task); the card opens what all of it changed.
  const opens =
    group.kind === "tasks" || group.kind === "events" || group.removal
      ? undefined
      : own.find((s) => s.status === "done");
  let body: ReactNode = null;
  if (group.kind === "sheet")
    body = group.tabs.map((tab) => (
      <SheetTab key={tab.name} tab={tab} steps={steps} />
    ));
  else if (group.kind === "tasks")
    body = <TaskRows group={group} steps={steps} />;
  else if (group.kind === "doc") body = <DocBody group={group} />;
  else if (group.kind === "events") body = <EventRows group={group} />;
  else
    body = (
      <>
        {group.table ? <SheetTab tab={group.table} steps={steps} /> : null}
        {group.fields.length ? <FieldRows fields={group.fields} /> : null}
      </>
    );
  const error =
    group.kind !== "tasks" && progress.state === "failed"
      ? progress.error
      : undefined;
  return (
    <motion.li
      {...revealProps(index)}
      aria-label={`${group.eyebrow}: ${group.title}`}
      className={cn(
        "@container/review overflow-hidden rounded-[12px] border bg-card",
        progress.state === "failed" || removal
          ? "border-destructive/40"
          : "border-border",
        muted && "opacity-80",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <div
          aria-hidden
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md text-base",
            removal
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground",
          )}
        >
          {"icon" in group && group.icon ? group.icon : icon}
        </div>
        <div className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {group.eyebrow}
          </span>
          <span
            role="heading"
            aria-level={3}
            className={cn(
              "block truncate text-sm font-semibold leading-5",
              progress.state === "discarded" &&
                "text-muted-foreground line-through",
            )}
          >
            {group.title}
          </span>
          {group.meta ? (
            <span className="block truncate text-xs font-medium text-muted-foreground @lg/review:hidden">
              {group.meta}
            </span>
          ) : null}
        </div>
        {group.meta ? (
          <span className="hidden min-w-0 shrink-[4] truncate text-[13px] font-medium text-muted-foreground @lg/review:block">
            {group.meta}
          </span>
        ) : null}
        {group.removal ? (
          <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
            Removes
          </span>
        ) : null}
        <StatusPill progress={progress} />
        <ChevronRight
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {error ? (
        <p
          role="alert"
          className="mx-4 mb-3 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs leading-5 text-destructive"
        >
          {error}
        </p>
      ) : null}
      {open ? (
        <div id={bodyId}>
          {body}
          {opens || (review && (waiting.length || setAside.length)) ? (
            <footer className="flex min-h-11 flex-wrap items-center gap-2 border-t border-border px-4 py-2">
              {opens ? <OpenLink step={opens} /> : null}
              {review && waiting.length ? (
                <span className="ml-auto flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={review.disabled}
                    onClick={() => review.discard(waiting, false)}
                    className="text-muted-foreground"
                  >
                    <Trash2 />
                    Discard
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={review.disabled}
                    onClick={() => review.apply(waiting)}
                  >
                    <Check />
                    Apply this
                  </Button>
                </span>
              ) : review && setAside.length ? (
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Won’t be applied
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={review.disabled}
                    onClick={() => review.discard(setAside, true)}
                  >
                    <RotateCcw />
                    Bring back
                  </Button>
                </span>
              ) : null}
            </footer>
          ) : null}
        </div>
      ) : null}
    </motion.li>
  );
}

/** What the plan adds up to, above the cards: "30 Sheet entries · 5 New tasks". */
function SummaryStrip({ groups }: { groups: ReviewGroup[] }) {
  const stats = reviewStats(groups);
  if (stats.reduce((n, stat) => n + stat.value, 0) < 2) return null;
  return (
    <dl
      aria-label="Summary"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-border bg-border @md/changes:grid-cols-[repeat(var(--stats),minmax(0,1fr))]"
      style={{ "--stats": Math.min(stats.length, 4) } as CSSProperties}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex min-w-0 flex-col-reverse bg-card px-4 py-2.5"
        >
          <dt className="truncate text-xs font-medium text-muted-foreground">
            {stat.label}
          </dt>
          <dd className="text-[22px] font-semibold leading-tight tracking-[-0.02em] tabular-nums">
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A plan as review cards: what it adds up to, then one card per change the
 * person will get (every entry for a sheet, the tasks, a doc), each drawn by
 * a fixed design for its kind. One card is open at a time: a failed one,
 * else the first. `activeIndex` marks the step the server is applying.
 */
export default function ChangeCards({
  steps,
  activeIndex = -1,
  muted = false,
  review,
}: {
  steps: ChatStep[];
  activeIndex?: number;
  muted?: boolean;
  /** While the proposal waits for review: each card's own Apply and Discard. */
  review?: ReviewActions;
}) {
  const names = useReviewNames();
  const groups = useMemo(() => reviewGroups(steps, names), [steps, names]);
  const failed = groups.find((group) =>
    group.steps.some((i) => steps[i]?.status === "failed"),
  )?.key;
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const open =
    picked === undefined ? (failed ?? groups[0]?.key ?? null) : picked;
  return (
    <div className="@container/changes space-y-3">
      <SummaryStrip groups={groups} />
      <ol className="space-y-2" aria-label="Changes">
        {groups.map((group, index) => (
          <GroupCard
            key={group.key}
            group={group}
            steps={steps}
            activeIndex={activeIndex}
            muted={muted}
            index={index}
            open={open === group.key}
            onToggle={() => setPicked(open === group.key ? null : group.key)}
            review={review}
          />
        ))}
      </ol>
    </div>
  );
}
