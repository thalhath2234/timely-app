"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cardValue, isPriceReading, PRICE_BLOCK, type BotView } from "@timely/contract/bots";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import { ListGroup, ListRow } from "@/app/_components/_ui/groupedList";
import { SkeletonRows } from "@/app/_components/_ui/skeleton";
import { BotMark, botSites } from "@/app/_components/bots/botMark";
import { useBotIcons, useBots } from "@/app/utils/hooks/bots";
import { cn } from "@/app/utils/cn";

/** A row focused from the keyboard shows as hovered, not with an outline the card clips. */
const ROW_FOCUS = "outline-none focus-visible:bg-muted/60";

/** A bot a price block can draw: one with a watch that reads a price. */
export const watchesPrice = (bot: BotView) => bot.watches.some(isPriceReading);

/**
 * The "/" menu's "Bot price chart": the person's bots that watch a price, as
 * grouped rows (mark, name, the board card's value). Picking one puts a live
 * block of its price history in the doc. No AI is needed.
 */
export default function PriceBlockPicker({ onPick, onClose }: { onPick: (bot: BotView) => void; onClose: () => void }) {
  const titleId = useId();
  const router = useRouter();
  const query = useBots();
  const bots = useMemo(() => (query.data?.bots ?? []).filter(watchesPrice), [query.data]);
  const sites = useMemo(() => botSites(bots.flatMap((bot) => bot.watches)), [bots]);
  const icons = useBotIcons(sites).data;
  const panel = useRef<HTMLDivElement>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The first row takes focus once the list is there, so the picker reads from the top.
  const ready = !query.isPending;
  useEffect(() => {
    if (ready) panel.current?.querySelector<HTMLElement>("[data-rows] button")?.focus();
  }, [ready]);

  if (typeof document === "undefined") return null;

  let body;
  if (query.isPending) {
    body = <SkeletonRows rows={3} height={48} />;
  } else if (!query.data) {
    body = (
      <>
        <p className="px-1 pb-2 text-[13px] text-muted-foreground">Couldn’t load your bots.</p>
        <ListGroup>
          <ListRow label="Try again" className={ROW_FOCUS} onClick={() => void query.refetch()} />
        </ListGroup>
      </>
    );
  } else if (!bots.length) {
    body = (
      <>
        <p className="px-1 pb-2 text-[13px] text-muted-foreground">{PRICE_BLOCK.pickEmpty}</p>
        <ListGroup>
          <ListRow
            label="Open Bots"
            className={ROW_FOCUS}
            meta="Make a bot that watches a price, then add its chart here"
            onClick={() => {
              onClose();
              router.push("/bots");
            }}
          />
        </ListGroup>
      </>
    );
  } else {
    body = (
      <ListGroup>
        {bots.map((bot) => {
          const value = cardValue(bot);
          return (
            <ListRow
              key={bot.id}
              label={bot.name}
              meta={bot.status === "paused" ? "Paused" : undefined}
              icon={<BotMark watches={bot.watches} kind={bot.kind} icons={icons} />}
              onClick={() => onPick(bot)}
              className={cn("h-12", ROW_FOCUS)}
              aria-label={`${bot.name}, ${value.text}`}
            >
              <span
                className={cn(
                  "truncate text-[13px] font-medium tabular-nums",
                  value.tone === "destructive" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {value.text}
              </span>
            </ListRow>
          );
        })}
      </ListGroup>
    );
  }

  return createPortal(
    <>
      <OverlayScrim className="z-[60] bg-black/55" onPointerDown={(event) => event.target === event.currentTarget && onClose()} />
      <OverlayFrame className="z-[60] items-start justify-center p-4 pt-[12vh]">
        <OverlayPanel
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="flex max-h-[min(70vh,620px)] w-full max-w-md flex-col overflow-hidden rounded-[20px] border border-border bg-background shadow-2xl"
        >
          <header className="flex items-center gap-3 border-b border-border px-5 py-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-semibold text-foreground">
                {PRICE_BLOCK.pick}
              </h2>
              <p className="text-xs text-muted-foreground">Its price over 30 days, kept current as the bot checks.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[10px] p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </header>
          <div data-rows className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {body}
          </div>
        </OverlayPanel>
      </OverlayFrame>
    </>,
    document.body,
  );
}
