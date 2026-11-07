"use client";

import type { ReactNode } from "react";
import { ChartCandlestick, Globe, Rss } from "lucide-react";
import {
  BOT_LIMITS,
  agoLabel,
  sourceLabel,
  watchTitle,
  type WatchInput,
  type WatchKind,
  type WatchView,
} from "@timely/contract/bots";
import {
  GroupHint,
  GroupLabel,
  ListGroup,
  ListRow,
} from "@/app/_components/_ui/groupedList";
import { BotMark, type SiteIcons } from "./botMark";

const READ_WORDS: Record<string, string> = {
  product_price: "Product price",
  selector_price: "Price on the page",
  selector: "Part of the page",
  text: "Page text",
};

/** "Product price · reads ₹27,499 · 12 min ago", "Feed · not read yet", or why it fails. */
export function watchMeta(
  w: WatchInput,
  view: WatchView | undefined,
  now: Date,
): string {
  const what =
    w.kind === "price"
      ? sourceLabel(w.source ?? "stock")
      : w.kind === "feed"
        ? "Feed"
        : READ_WORDS[w.read ?? "text"];
  if (!view) return `${what} · not read yet`;
  if (
    view.health.code !== "working" &&
    view.health.code !== "new" &&
    view.health.line
  )
    return `${what} · ${view.health.line}`;
  if (!view.lastReadingAt) return `${what} · not read yet`;
  const reads = view.summary ? ` · reads ${view.summary}` : "";
  return `${what}${reads} · ${agoLabel(view.lastReadingAt, now)}`;
}

function KindIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-fill text-muted-foreground [&_svg]:size-3.5"
    >
      {children}
    </span>
  );
}

const KINDS: {
  kind: WatchKind;
  label: string;
  meta: string;
  icon: ReactNode;
}[] = [
  {
    kind: "page",
    label: "A page",
    meta: "Its text, one part of it, or a shop price",
    icon: <Globe />,
  },
  {
    kind: "feed",
    label: "A feed",
    meta: "New posts in an RSS or Atom feed",
    icon: <Rss />,
  },
  {
    kind: "price",
    label: "A price",
    meta: "A stock or a coin, from a free source",
    icon: <ChartCandlestick />,
  },
];

/**
 * Watches: one row per thing the bot reads, each opening the watch editor,
 * and Add watch (up to 5). With none yet, three rows pick what to watch.
 */
export function WatchesGroup({
  watches,
  views,
  icons,
  now,
  onEdit,
  onAdd,
  error,
}: {
  watches: WatchInput[];
  views?: Map<string, WatchView>;
  icons?: SiteIcons;
  now: Date;
  onEdit: (index: number) => void;
  onAdd: (kind?: WatchKind) => void;
  error?: ReactNode;
}) {
  if (watches.length === 0) {
    return (
      <section>
        <GroupLabel aside="Pick one to start">Watches</GroupLabel>
        <ListGroup>
          {KINDS.map((k) => (
            <ListRow
              key={k.kind}
              label={k.label}
              meta={k.meta}
              icon={<KindIcon>{k.icon}</KindIcon>}
              onClick={() => onAdd(k.kind)}
            />
          ))}
        </ListGroup>
        {error ? (
          <GroupHint className="text-destructive">{error}</GroupHint>
        ) : null}
        <GroupHint>
          A bot can watch up to {BOT_LIMITS.maxWatches} things. Add more after
          the first.
        </GroupHint>
      </section>
    );
  }
  return (
    <section>
      <GroupLabel aside={`${watches.length} of ${BOT_LIMITS.maxWatches}`}>
        Watches
      </GroupLabel>
      <ListGroup>
        {[
          ...watches.map((w, index) => {
            const view = w.id ? views?.get(w.id) : undefined;
            return (
              <ListRow
                key={w.id ?? `new-${index}`}
                label={view ? watchTitle(view) : watchTitle(w)}
                meta={watchMeta(w, view, now)}
                icon={
                  <BotMark
                    watches={[view ?? w]}
                    size={24}
                    icons={icons}
                    badge={false}
                  />
                }
                onClick={() => onEdit(index)}
              />
            );
          }),
          ...(watches.length < BOT_LIMITS.maxWatches
            ? [
                <ListRow
                  key="add"
                  label="Add watch"
                  tone="add"
                  onClick={() => onAdd()}
                />,
              ]
            : []),
        ]}
      </ListGroup>
      {error ? (
        <GroupHint className="text-destructive">{error}</GroupHint>
      ) : null}
    </section>
  );
}
