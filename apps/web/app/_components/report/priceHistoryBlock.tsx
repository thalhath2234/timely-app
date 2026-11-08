"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { isBotId, PRICE_BLOCK, priceHistory } from "@timely/contract/bots";
import { Skeleton } from "@/app/_components/_ui/skeleton";
import { PriceSummary } from "@/app/_components/bots/priceSummary";
import { useBot } from "@/app/utils/hooks/bots";
import { LINK } from "../genui/kit";

/** The block's words when there is no chart to draw. */
function Note({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[15px] font-semibold text-foreground">{title}</p>
      {hint ? <p className="mt-0.5 text-[13px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/*
 * A bot's price history in a doc's live block (PriceHistory in genuiBoard.ts),
 * drawn as the Bots rail draws its Price section. Read-only: it reads the bot
 * itself, by id only, so a name or a reserved word is never fetched. A bot
 * that is gone says so rather than drawing an empty chart.
 */
export function PriceHistoryBlock({ bot, watch }: { bot: string; watch?: string }) {
  const valid = isBotId(bot);
  const query = useBot(valid ? bot : null, { enabled: valid });
  if (!valid) return <Note title={PRICE_BLOCK.failed} />;
  // A bot deleted while the doc was open says so, even with its old copy cached.
  if ((query.error as { status?: number } | null)?.status === 404)
    return <Note title={PRICE_BLOCK.deleted} hint={PRICE_BLOCK.deletedHint} />;
  if (!query.data) return query.isPending ? <Skeleton className="m-4 h-[150px]" /> : <Note title={PRICE_BLOCK.failed} />;
  const model = priceHistory(query.data, watch);
  if (!model) return <Note title={PRICE_BLOCK.noPrice} />;
  const meta = [model.multiple ? model.label : "", model.paused ? "Paused" : ""].filter(Boolean).join(" · ");
  return (
    <div>
      <div className="px-4 pb-4 pt-3">
        {meta ? <p className="mb-1 truncate text-xs font-medium text-muted-foreground">{meta}</p> : null}
        <PriceSummary model={model} />
      </div>
      <div className="border-t border-border px-4 py-2.5">
        <Link href={`/bots?bot=${encodeURIComponent(bot)}`} className={LINK}>
          {PRICE_BLOCK.open}
          <ChevronRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}
