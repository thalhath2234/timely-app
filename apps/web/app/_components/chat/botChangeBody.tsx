"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import {
  notItMessage,
  previewCard,
  proposalFacts,
  sourceLabel,
  watchTitle,
  type PreviewWatch,
  type WatchInput,
} from "@timely/contract/bots";
import type { ReviewBotRow, ReviewGroup } from "@timely/contract/changeReview";
import {
  ListGroup,
  ListRow,
  ListSubLabel,
} from "@/app/_components/_ui/groupedList";
import { RailRow, RailRows } from "@/app/_components/_ui/pageWithRail";
import { useBotActions } from "@/app/_components/bots/botActions";
import { BotCard } from "@/app/_components/bots/botCard";
import { BotMark, botSites } from "@/app/_components/bots/botMark";
import { cn } from "@/app/utils/cn";
import { useBotIcons } from "@/app/utils/hooks/bots";
import NotItPopover from "./notItPopover";

type BotGroup = Extract<ReviewGroup, { kind: "bot" }>;

/**
 * What the person can say back to a proposed bot from its card: pick another
 * price on the page (sent as their message), or say it in their own words.
 */
export type BotReplyActions = {
  send: (text: string) => void;
  compose: (text: string) => void;
  disabled?: boolean;
};

/** Code-point runs of an excerpt: the price it reads marked, struck prices struck. */
function excerptRuns(excerpt: NonNullable<PreviewWatch["excerpt"]>) {
  const chars = Array.from(excerpt.text);
  const kind = chars.map(() => "plain" as "plain" | "mark" | "struck");
  for (const [from, to] of excerpt.struck ?? [])
    for (let i = Math.max(0, from); i < Math.min(to, chars.length); i++)
      kind[i] = "struck";
  const [from, to] = excerpt.mark ?? [0, 0];
  for (let i = Math.max(0, from); i < Math.min(to, chars.length); i++)
    kind[i] = "mark";
  const runs: { kind: (typeof kind)[number]; text: string }[] = [];
  chars.forEach((ch, i) => {
    const last = runs[runs.length - 1];
    if (last && last.kind === kind[i]) last.text += ch;
    else runs.push({ kind: kind[i], text: ch });
  });
  return runs;
}

/** The line under "Right now it reads", by what the watch reads. */
function readsSub(read: PreviewWatch, watch: WatchInput | undefined) {
  if (read.kind === "feed") return "The newest posts in the feed, read once";
  if (read.kind === "price")
    return `The price from ${sourceLabel(watch?.source ?? "")}, read once`;
  if (read.read === "product_price" || read.read === "selector_price")
    return "The price I found on the page, read once without any tools";
  return "The part I found on the page, read once without any tools";
}

function Excerpt({ read }: { read: PreviewWatch }) {
  const box =
    "mt-3 rounded-[10px] bg-muted px-3.5 py-3 font-mono text-[13px] leading-6 text-muted-foreground";
  if (read.excerpt?.text)
    return (
      <p className={cn(box, "whitespace-pre-wrap break-words")}>
        {excerptRuns(read.excerpt).map((run, i) =>
          run.kind === "mark" ? (
            <mark
              key={i}
              className="rounded-[4px] bg-warning/28 px-0.5 text-foreground"
            >
              {run.text}
            </mark>
          ) : run.kind === "struck" ? (
            <s key={i}>{run.text}</s>
          ) : (
            <Fragment key={i}>{run.text}</Fragment>
          ),
        )}
      </p>
    );
  if (read.items?.length)
    return (
      <ul className={cn(box, "space-y-1 font-sans")}>
        {read.items.slice(0, 5).map((item, i) => (
          <li key={`${i}:${item.url}`} className="truncate text-foreground">
            {item.title || item.url}
          </li>
        ))}
      </ul>
    );
  if (read.text)
    return (
      <p className={cn(box, "line-clamp-4 whitespace-pre-wrap break-words")}>
        {read.text}
      </p>
    );
  return null;
}

/** "Right now it reads: ₹19,999", the excerpt it read, and "That's not it". */
function ReadsBox({
  read,
  watch,
  label,
  reply,
}: {
  read: PreviewWatch;
  watch: WatchInput | undefined;
  /** The watch's name, when the bot has two or more. */
  label?: string;
  reply?: BotReplyActions;
}) {
  return (
    <section
      aria-label={label ? `What ${label} reads` : "What it reads"}
      className="rounded-[12px] border border-border bg-card p-4"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {label ? (
            <p className="truncate text-xs font-medium text-muted-foreground">
              {label}
            </p>
          ) : null}
          {read.ok ? (
            <>
              <h4 className="text-sm font-semibold tabular-nums">
                Right now it reads: {read.summary || "nothing yet"}
              </h4>
              <p className="text-[13px] text-muted-foreground">
                {readsSub(read, watch)}
              </p>
            </>
          ) : (
            <>
              <h4 className="text-sm font-semibold">
                It couldn’t read it just now
              </h4>
              <p className="text-[13px] text-destructive">
                {read.health?.line || "The page did not answer."}
              </p>
            </>
          )}
        </div>
        {reply ? (
          <NotItPopover
            candidates={read.ok ? (read.candidates ?? []) : []}
            current={read.value}
            disabled={reply.disabled}
            onPick={(candidate) =>
              reply.send(
                notItMessage(candidate, { site: read.site, url: watch?.url }),
              )
            }
            onOther={() => reply.compose("That’s not it: ")}
          />
        ) : null}
      </div>
      {read.ok ? <Excerpt read={read} /> : null}
    </section>
  );
}

function RowValue({
  row,
  icons,
}: {
  row: ReviewBotRow;
  icons: Record<string, string | null> | undefined;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
      {row.site && row.kind ? (
        <BotMark
          watches={[{ kind: row.kind, site: row.site }]}
          size={24}
          badge={false}
          icons={icons}
        />
      ) : null}
      {row.before ? (
        <>
          <s className="truncate text-muted-foreground/80">{row.before}</s>
          <span aria-hidden>→</span>
        </>
      ) : null}
      <span className="truncate text-foreground/80 tabular-nums">
        {row.value}
      </span>
    </span>
  );
}

/**
 * A proposed bot in chat, as Option 2 draws it: the bot's rows (Watches,
 * Checks every, Tells me when, How smart, Alerts on) beside how it lands on
 * the board, then what each watch reads right now with "That's not it".
 */
export default function BotChangeBody({
  group,
  status,
  reply,
  footer,
}: {
  group: BotGroup;
  /** Shown instead of the New/Edit pill once the change is applied or fails. */
  status?: ReactNode;
  /** While the proposal waits: "That's not it". */
  reply?: BotReplyActions;
  footer?: ReactNode;
}) {
  const now = useMemo(() => new Date(), []);
  const actions = useBotActions(() => {});
  // The header mark takes each watch's site from the reading (the
  // registrable domain, as the rows and the board preview show it), not the
  // address's full host.
  const marked = useMemo(
    () =>
      group.args.watches.map((w, i) => {
        const site = group.preview?.watches?.find((r) => r.index === i)?.site;
        return site ? { ...w, site } : w;
      }),
    [group.args.watches, group.preview],
  );
  const sites = botSites(marked);
  const icons = useBotIcons(sites).data;
  const card = useMemo(
    () => previewCard(group.args, group.preview, now),
    [group.args, group.preview, now],
  );
  const reads = group.preview?.watches ?? [];
  const several = group.args.watches.length > 1;
  let lastWatch: number | undefined;
  const rows: ReactNode[] = [];
  group.rows.forEach((row, i) => {
    if (row.watch && row.watchIndex !== lastWatch)
      rows.push(<ListSubLabel key={`sub:${i}`}>{row.watch}</ListSubLabel>);
    lastWatch = row.watchIndex;
    rows.push(
      <ListRow key={`row:${i}`} label={row.label}>
        <RowValue row={row} icons={icons} />
      </ListRow>,
    );
  });
  return (
    <div className="@container/bot space-y-3">
      <div className="grid gap-3 @min-[720px]/bot:grid-cols-[minmax(0,1fr)_260px]">
        <ListGroup className="self-start">
          <div className="flex items-center gap-3 px-3.5 py-3">
            <BotMark watches={marked} size={40} icons={icons} />
            <div className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {group.eyebrow}
              </span>
              <h3 className="truncate text-sm font-semibold leading-5">
                {group.name}
              </h3>
            </div>
            {status ?? (
              <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-primary/12 px-2 text-[11px] font-medium text-primary">
                {group.action === "create" ? "New" : "Edit"}
              </span>
            )}
          </div>
          {rows}
        </ListGroup>
        <aside aria-label="On your board" className="min-w-0 space-y-2">
          <p className="px-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            On your board
          </p>
          <BotCard
            bot={card}
            now={now}
            variant="preview"
            icons={icons}
            actions={actions}
          />
          <div className="rounded-[12px] border border-border bg-card px-3.5 py-1">
            <RailRows>
              {proposalFacts(group.args).map(([label, value]) => (
                <RailRow key={label} label={label} value={value} />
              ))}
            </RailRows>
          </div>
        </aside>
      </div>
      {reads.map((read) => {
        const watch = group.args.watches[read.index];
        return (
          <ReadsBox
            key={read.index}
            read={read}
            watch={watch}
            label={
              several && watch
                ? watchTitle({ ...watch, site: read.site })
                : undefined
            }
            reply={reply}
          />
        );
      })}
      {group.previewError ? (
        <section
          aria-label="What it reads"
          className="flex items-start gap-3 rounded-[12px] border border-border bg-card p-4"
        >
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold">
              It couldn’t read it just now
            </h4>
            <p className="text-[13px] text-destructive">{group.previewError}</p>
          </div>
          {reply ? (
            <NotItPopover
              candidates={[]}
              disabled={reply.disabled}
              onPick={() => {}}
              onOther={() => reply.compose("That’s not it: ")}
            />
          ) : null}
        </section>
      ) : null}
      {footer}
    </div>
  );
}
