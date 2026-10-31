"use client";

import { createContext, Fragment, useContext, useMemo, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ChevronRight, Sparkles } from "lucide-react";
import type { ComponentRenderProps, ComponentRenderer } from "@openuidev/react-lang";
import { chartNumber, genuiColorHex, genuiNodes, type GenuiName, type GenuiProps } from "@timely/contract/genui";
import { motion as MOTION } from "@timely/contract/designTokens";
import { checklistItems, findChecklistItem } from "@timely/contract/docChecklist";
import { isOverdue, todayInZone } from "@timely/contract/workStatus";
import { useTask, useTasks, useUpdateTask } from "@/app/utils/hooks/tasks";
import { useDoc, useDocs, useSetChecklistItem } from "@/app/utils/hooks/docs";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { useToastStore } from "@/app/_store/toastStore";
import { fileHref } from "@/app/utils/fileRoutes";
import { cn } from "@/app/utils/cn";
import { TaskCheck } from "@/app/_components/_ui/taskCheck";
import { Fill, StatNumber } from "@/app/_components/_ui/dataMotion";
import { easeOut } from "@/app/_components/_ui/motion";

/*
 * The kit behind reply cards (chat) and described cards (dashboard): the
 * shared OpenUI components of packages/contract/src/genui.ts drawn with
 * Timely's own parts. A tick or a link acts at once, as it does anywhere else
 * in the app. Chat wraps cards in borders; on the dashboard the board card is
 * the frame, so sections sit flat inside it.
 */

export type KitProps<N extends GenuiName> = ComponentRenderProps<GenuiProps<N>>;

/** Sends text as the person's next chat message; unset outside chat or while it can't take one. */
export const Ask = createContext<((text: string) => void) | undefined>(undefined);
/** Where a component sits: straight under the chat text or on a board card, inside a card, or as a card in Columns. */
export const Place = createContext<"top" | "card" | "column">("top");
/** Chat draws cards with their own border; a board card is already one. */
export const Surface = createContext<"chat" | "board">("chat");
/** The card has timed rows, so every row keeps the time column for alignment. */
const Timed = createContext(false);

const TIMED = new Set(["TaskRow", "EventRow", "FreeRow"]);

export const CARD = "@container/card overflow-hidden rounded-[12px] border border-border bg-card";
const HATCH: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--muted) 80%, transparent) 6px 7px)",
};
const GROW_SECONDS = 20 / MOTION.fps;

function clock(value: string | undefined) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A standalone block: its own bordered card in chat, flat on a board card. */
function Framed({ children }: { children: ReactNode }) {
  const place = useContext(Place);
  const surface = useContext(Surface);
  return place === "top" && surface === "chat" ? <section className={CARD}>{children}</section> : <>{children}</>;
}

/** Rows that share a time column when any of them has a time. */
export function RowGroup({ rows, renderNode }: { rows: unknown; renderNode: (node: unknown) => ReactNode }) {
  const nodes = genuiNodes(rows);
  const timed = nodes.some((row) => TIMED.has(row.typeName) && row.props.time);
  // Share bars line up when the value column fits the longest value, such as an amount of money.
  const longest = Math.max(0, ...nodes.filter((row) => row.typeName === "ShareRow").map((row) => String(row.props.value ?? "").length));
  const shares = longest ? ({ "--share-value": `max(84px, ${longest + 1}ch)` } as CSSProperties) : undefined;
  return (
    <Place.Provider value="card">
      <Timed.Provider value={timed}>
        <div className="divide-y divide-border" style={shares}>
          {nodes.map((row, index) => (
            <Fragment key={index}>{renderNode(row)}</Fragment>
          ))}
        </div>
      </Timed.Provider>
    </Place.Provider>
  );
}

function Row({
  time,
  lead,
  meta,
  tone = "default",
  children,
  className,
  style,
}: {
  time?: string;
  lead?: ReactNode;
  meta?: ReactNode;
  tone?: "default" | "warning" | "success";
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const timed = useContext(Timed);
  const metaTone = tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-muted-foreground";
  // The meta sits on the right of a roomy card and under the title in a
  // narrow one; it gives up its width before the title does.
  return (
    <div
      className={cn("flex min-h-11 items-center gap-3 px-4 py-1.5 text-sm", tone === "warning" && "bg-warning/10", className)}
      style={style}
    >
      {timed || time ? (
        <span className="w-12 shrink-0 whitespace-nowrap text-[13px] font-medium tabular-nums text-muted-foreground">{time}</span>
      ) : null}
      {lead !== undefined ? <span className="flex w-[18px] shrink-0 items-center justify-center self-stretch">{lead}</span> : null}
      <span className="min-w-0 flex-auto">
        {children}
        {meta ? <span className={cn("block truncate text-xs font-medium @sm/card:hidden", metaTone)}>{meta}</span> : null}
      </span>
      {meta ? (
        <span className={cn("hidden min-w-0 shrink-[4] truncate text-[13px] font-medium @sm/card:block", metaTone)}>{meta}</span>
      ) : null}
    </div>
  );
}

function Card({ props, renderNode }: KitProps<"Card">) {
  const place = useContext(Place);
  const surface = useContext(Surface);
  return (
    <section className={surface === "chat" ? CARD : "@container/card"} aria-label={props.title}>
      <header className="flex min-h-10 items-center gap-3 px-4 pb-1.5 pt-2.5">
        <h3
          className={cn(
            "min-w-0 truncate",
            place === "column"
              ? "text-sm font-semibold text-foreground"
              : "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground",
          )}
        >
          {props.title}
        </h3>
        {props.meta ? (
          <span className="ml-auto min-w-0 shrink-[4] truncate text-[13px] font-medium text-muted-foreground">{props.meta}</span>
        ) : null}
      </header>
      <RowGroup rows={props.rows} renderNode={renderNode} />
      {props.open ? <footer className="border-t border-border px-4 py-2.5">{renderNode(props.open)}</footer> : null}
    </section>
  );
}

function Columns({ props, renderNode }: KitProps<"Columns">) {
  const surface = useContext(Surface);
  const cards = genuiNodes(props.cards);
  return (
    <Place.Provider value="column">
      <div
        className={
          surface === "chat"
            ? cn("grid items-start gap-3", cards.length >= 2 && "@2xl/board:grid-cols-2", cards.length >= 3 && "@4xl/board:grid-cols-3")
            : // On a board card the columns share the frame and a hairline.
              cn(
                "grid items-start divide-y divide-border",
                cards.length >= 2 && "@xl/board:grid-cols-2 @xl/board:divide-x @xl/board:divide-y-0",
                cards.length >= 3 && "@3xl/board:grid-cols-3",
              )
        }
      >
        {cards.map((card, index) => (
          <Fragment key={index}>{renderNode(card)}</Fragment>
        ))}
      </div>
    </Place.Provider>
  );
}

function Stats({ props, renderNode }: KitProps<"Stats">) {
  const items = genuiNodes(props.items);
  if (!items.length) return null;
  // Rows stay full: two by two for four on a narrow card, otherwise one row.
  const narrow = items.length === 4 ? 2 : Math.min(items.length, 3);
  return (
    <Framed>
      <div
        className="grid grid-cols-[repeat(var(--narrow),minmax(0,1fr))] gap-px bg-border @lg/card:grid-cols-[repeat(var(--wide),minmax(0,1fr))]"
        style={{ "--narrow": narrow, "--wide": Math.min(items.length, 4) } as CSSProperties}
      >
        {items.map((item, index) => (
          <Fragment key={index}>{renderNode(item)}</Fragment>
        ))}
      </div>
    </Framed>
  );
}

function Stat({ props }: KitProps<"Stat">) {
  // "18/22" reads as 18 out of 22: the total sits small and muted.
  const [main, ...rest] = String(props.value).split("/");
  const total = rest.join("/");
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <p className="truncate text-[22px] font-semibold leading-tight tracking-[-0.02em]">
        <StatNumber value={main} />
        {total ? <span className="text-sm font-medium text-muted-foreground">/{total}</span> : null}
      </p>
      <p className="truncate text-xs font-medium text-muted-foreground">{props.label}</p>
      {props.hint ? <p className="text-xs text-muted-foreground">{props.hint}</p> : null}
    </div>
  );
}

/** The task as it is now: from the task list, or fetched on its own (a Reminder). */
function useLiveTask(id: string) {
  const list = useTasks();
  const listed = list.data?.find((task) => task.id === id);
  const single = useTask(list.isSuccess && !listed ? id : undefined);
  return listed ?? single.data;
}

function TaskRow({ props }: KitProps<"TaskRow">) {
  const task = useLiveTask(props.taskId);
  const update = useUpdateTask();
  const openTask = useEntityDetailStore((state) => state.openTask);
  const title = task?.name || props.title;
  const done = Boolean(task?.completedAt);
  const late = task ? isOverdue(task, todayInZone()) : false;
  const toggle = () => {
    if (!task) return;
    update.mutate(
      { id: task.id, completedAt: done ? "" : new Date().toISOString() },
      {
        onError: (error) =>
          useToastStore.getState().show(error instanceof Error ? error.message : "Could not update the task"),
      },
    );
  };
  return (
    <Row
      time={props.time}
      tone={late ? "warning" : "default"}
      meta={done ? "Done" : props.note}
      lead={
        <TaskCheck
          checked={done}
          onToggle={toggle}
          disabled={!task}
          label={done ? `Reopen ${title}` : `Complete ${title}`}
        />
      }
    >
      <button
        type="button"
        disabled={!task}
        onClick={() => task && openTask(task.id)}
        className={cn(
          "block max-w-full truncate text-left enabled:hover:underline enabled:hover:underline-offset-4",
          done ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {title}
      </button>
    </Row>
  );
}

/** The doc as it is now: from the docs list, or fetched on its own. */
function useLiveDoc(id: string) {
  const list = useDocs();
  const listed = list.data?.find((doc) => doc.id === id);
  const single = useDoc(list.isSuccess && !listed ? id : undefined);
  return listed ?? single.data;
}

/** A doc's checklist item: the tick ticks it in the doc, the words open the doc. */
function CheckRow({ props }: KitProps<"CheckRow">) {
  const doc = useLiveDoc(props.docId);
  const tick = useSetChecklistItem();
  const items = useMemo(() => checklistItems(doc?.content), [doc?.content]);
  const item = findChecklistItem(items, props.text, props.item);
  const text = item?.text ?? props.text;
  const done = Boolean(item?.done);
  const toggle = () => {
    if (!item) return;
    tick.mutate(
      { id: props.docId, item: item.item, text: item.text, done: !done },
      {
        onError: (error) =>
          useToastStore.getState().show(error instanceof Error ? error.message : "Could not tick the item"),
      },
    );
  };
  return (
    <Row
      meta={props.note}
      lead={<TaskCheck checked={done} onToggle={toggle} disabled={!item} label={done ? `Untick ${text}` : `Tick ${text}`} />}
    >
      <Link
        href={fileHref(props.docId)}
        className={cn(
          "block max-w-full truncate hover:underline hover:underline-offset-4",
          done ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {text}
      </Link>
    </Row>
  );
}

function EventRow({ props }: KitProps<"EventRow">) {
  return (
    <Row
      time={props.time}
      meta={props.length}
      lead={
        <span
          aria-hidden
          className="my-2.5 w-[3px] self-stretch rounded-full"
          style={{ backgroundColor: genuiColorHex(props.color) ?? "var(--primary)" }}
        />
      }
    >
      <span className="block truncate">{props.title}</span>
    </Row>
  );
}

function FreeRow({ props }: KitProps<"FreeRow">) {
  const ask = useContext(Ask);
  return (
    <Row
      time={props.from}
      lead={null}
      style={HATCH}
      meta={
        ask ? (
          <button
            type="button"
            onClick={() => ask(`Plan something for ${props.from}–${props.to}`)}
            className="inline-flex items-center gap-1 text-primary hover:underline hover:underline-offset-4"
          >
            <Sparkles className="size-3.5" />
            Plan something
          </button>
        ) : null
      }
    >
      <span className="block truncate text-muted-foreground">Free until {props.to}</span>
    </Row>
  );
}

function InfoRow({ props }: KitProps<"InfoRow">) {
  const tone = props.tone ?? "default";
  return (
    <Row tone={tone} meta={props.value}>
      <span className="block truncate">{props.label}</span>
      {props.note ? <span className="block truncate text-xs text-muted-foreground">{props.note}</span> : null}
    </Row>
  );
}

function ShareRow({ props }: KitProps<"ShareRow">) {
  const hex = genuiColorHex(props.color);
  // One line in a roomy card; in a narrow one the bar drops under the label.
  return (
    <div className="grid min-h-11 grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-sm @sm/card:grid-cols-[8px_minmax(0,1fr)_7rem_var(--share-value,84px)] @sm/card:py-1.5">
      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: hex ?? "var(--primary)" }} />
      <span className="truncate">{props.label}</span>
      <span className="truncate text-right text-[13px] font-medium tabular-nums text-muted-foreground @sm/card:col-start-4 @sm/card:row-start-1">
        {props.value}
      </span>
      <span className="col-span-2 col-start-2 @sm/card:col-span-1 @sm/card:col-start-3 @sm/card:row-start-1">
        <Fill value={props.share / 100} color={hex} height={6} />
      </span>
    </div>
  );
}

function BarChart({ props }: KitProps<"BarChart">) {
  const surface = useContext(Surface);
  const values = (Array.isArray(props.values) ? props.values : []).slice(0, 12);
  const labels = Array.isArray(props.labels) ? props.labels : [];
  const max = Math.max(...values, 0) || 1;
  const unit = props.unit ? ` ${props.unit}` : "";
  if (!values.length) return null;
  return (
    <Framed>
      {/* On a board card the chart takes the height the card has left. */}
      <figure className={cn("flex flex-col px-4 pb-3 pt-2.5", surface === "board" && "min-h-[150px] flex-1")}>
        <figcaption className="mb-1 text-xs font-medium text-muted-foreground">{props.title}</figcaption>
        <div className={cn("flex items-stretch gap-2.5", surface === "board" ? "min-h-0 flex-1" : "h-[124px]")} role="list">
          {values.map((value, index) => {
            const label = labels[index] ?? "";
            const high = props.highlight ? label === props.highlight : value === max;
            return (
              <div
                key={index}
                role="listitem"
                aria-label={`${label}: ${value}${unit}`}
                className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
              >
                <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-end gap-1.5">
                  <span className="text-[11px] tabular-nums text-muted-foreground">{chartNumber(value)}</span>
                  <motion.span
                    className={cn("block w-full max-w-[34px] origin-bottom rounded-t-[5px] rounded-b-[2px]", high ? "bg-primary" : "bg-fill")}
                    style={{ height: `max(2px, calc((100% - 22px) * ${value / max}))` }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: GROW_SECONDS, ease: easeOut }}
                  />
                </div>
                <span className="max-w-full truncate text-[11px] font-medium text-muted-foreground">{label}</span>
              </div>
            );
          })}
        </div>
      </figure>
    </Framed>
  );
}

function DayStrip({ props }: KitProps<"DayStrip">) {
  const from = clock(props.start);
  const to = clock(props.end);
  if (!(to > from)) return null;
  const span = to - from;
  const at = (minutes: number) => ((minutes - from) / span) * 100;
  const slots = genuiNodes(props.slots).map((node) => node.props as GenuiProps<"Slot">);
  const ticks: number[] = [];
  for (let tick = Math.ceil(from / 120) * 120; tick <= to; tick += 120) ticks.push(tick);
  const summary = slots
    .map((slot) => `${slot.from}–${slot.to} ${slot.kind === "free" ? "free" : (slot.label ?? slot.kind)}`)
    .join(", ");
  return (
    <Framed>
      <div className="px-4 pb-2.5 pt-1.5">
        <div role="img" aria-label={summary} className="relative h-[34px] overflow-hidden rounded-[8px] bg-muted">
          {slots.map((slot, index) => {
            const start = Math.max(clock(slot.from), from);
            const end = Math.min(clock(slot.to), to);
            if (!(end > start)) return null;
            const free = slot.kind === "free";
            const hex = genuiColorHex(slot.color);
            return (
              <span
                key={index}
                aria-hidden
                title={`${slot.from}–${slot.to}${slot.label ? ` ${slot.label}` : ""}`}
                className={cn(
                  "@container absolute inset-y-[5px] rounded-[5px] px-2 text-[11px] font-medium leading-6",
                  free
                    ? "border border-dashed border-border text-muted-foreground"
                    : slot.kind === "task" && !hex
                      ? "bg-primary text-primary-foreground"
                      : "text-white",
                )}
                style={{
                  left: `${at(start)}%`,
                  width: `calc(${at(end) - at(start)}% - 3px)`,
                  ...(free ? HATCH : !(slot.kind === "task" && !hex) ? { backgroundColor: hex ?? genuiColorHex("indigo") } : null),
                }}
              >
                {/* A label shows only where it fits (the slot is its own container). */}
                <span className="hidden truncate @[24px]:block">{free ? (slot.label ?? "Free") : slot.label}</span>
              </span>
            );
          })}
        </div>
        <div aria-hidden className="relative mt-1 h-4 text-[11px] tabular-nums text-muted-foreground">
          {ticks.map((tick, index) => (
            <span
              key={tick}
              className={cn(
                "absolute top-0",
                index === 0 && at(tick) < 4 ? "" : at(tick) > 96 ? "-translate-x-full" : "-translate-x-1/2",
              )}
              style={{ left: `${at(tick)}%` }}
            >
              {pad(Math.floor(tick / 60))}
            </span>
          ))}
        </div>
      </div>
    </Framed>
  );
}

function Text({ props }: KitProps<"Text">) {
  return <p className="px-4 py-2.5 text-sm leading-6 text-muted-foreground">{props.text}</p>;
}

const SCREENS = { today: "/today", calendar: "/calendar", tasks: "/tasks", inbox: "/inbox", dashboard: "/dashboard" } as const;
const LINK = "inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline hover:underline-offset-4";

function Open({ props }: KitProps<"Open">) {
  const openTask = useEntityDetailStore((state) => state.openTask);
  const openProject = useEntityDetailStore((state) => state.openProject);
  const body = (
    <>
      {props.label}
      <ChevronRight className="size-3.5" />
    </>
  );
  const { target, id } = props;
  if (target in SCREENS)
    return (
      <Link href={SCREENS[target as keyof typeof SCREENS]} className={LINK}>
        {body}
      </Link>
    );
  if (!id) return null;
  if (target === "doc" || target === "sheet")
    return (
      <Link href={fileHref(id)} className={LINK}>
        {body}
      </Link>
    );
  return (
    <button type="button" onClick={() => (target === "task" ? openTask(id) : openProject(id))} className={LINK}>
      {body}
    </button>
  );
}

// Slots are drawn by their DayStrip, which reads their props.
const Slot = () => null;

type KitName = Exclude<GenuiName, "Reply" | "Choices">;

/** Renderers for every shared component; chat adds Reply and Choices, the dashboard Panel and List. */
export const kit: { [N in KitName]: ComponentRenderer<GenuiProps<N>> } = {
  Card,
  Columns,
  Stats,
  Stat,
  TaskRow,
  CheckRow,
  EventRow,
  FreeRow,
  InfoRow,
  ShareRow,
  BarChart,
  DayStrip,
  Slot,
  Text,
  Open,
};
