"use client";

import {
  formatMoney,
  signedPct,
  type PriceHistoryModel,
} from "@timely/contract/bots";
import { cn } from "@/app/utils/cn";
import { PriceChart } from "./priceChart";

/**
 * One price watch as drawn: the price now with the line it watches, 30 days
 * of closes, then the low and the change side by side. The Bots rail's Price
 * section and a doc's price block share it.
 */
export function PriceSummary({ model }: { model: PriceHistoryModel }) {
  const { currency } = model;
  return (
    <>
      <div className="min-w-0">
        <p className="text-[26px] font-semibold leading-8 tracking-[-0.02em] tabular-nums text-foreground">
          {model.value != null ? formatMoney(model.value, currency) : "—"}
        </p>
        <p className="truncate text-xs tabular-nums text-muted-foreground">
          {model.value != null
            ? `Now${model.under ? ` · ${model.under}` : ""}`
            : "Not read yet"}
        </p>
      </div>
      <div className="mt-3.5">
        <PriceChart
          points={model.points}
          threshold={model.threshold}
          currency={currency}
        />
      </div>
      {model.low != null ? (
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3.5">
          <div className="min-w-0">
            <p className="text-[17px] font-semibold tabular-nums text-foreground">
              {formatMoney(model.low, currency)}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              30-day low, {model.lowDay}
            </p>
          </div>
          {model.changePct != null ? (
            <div className="min-w-0">
              <p
                className={cn(
                  "text-[17px] font-semibold tabular-nums",
                  model.good ? "text-success-text" : "text-foreground",
                )}
              >
                {signedPct(model.changePct)}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                since {model.since}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
