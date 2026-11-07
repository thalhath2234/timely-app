"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, FlaskConical, Trash2 } from "lucide-react";
import {
  READ_OPTIONS,
  cleanWatchInput,
  draftErrors,
  formatMoney,
  readingKind,
  type PreviewCandidate,
  type PreviewInput,
  type ReadMode,
  type WatchInput,
  type WatchKind,
  type WatchView,
} from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import {
  GroupHint,
  GroupLabel,
  ListGroup,
  ListRow,
} from "@/app/_components/_ui/groupedList";
import SegmentedControl from "@/app/_components/_ui/segmentedControl";
import Select from "@/app/_components/_ui/select";
import { requestConfirm } from "@/app/_store/confirmStore";
import { cn } from "@/app/utils/cn";
import { useBotPreview } from "@/app/utils/hooks/bots";
import { BOT_KEYS_HREF } from "./botActions";
import { RowInput } from "./editPill";
import { defaultRules } from "./rulesGroup";

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY"];

const isStock = (source: string | undefined) =>
  !source || source === "stock" || source === "finnhub";

/** The currencies a source quotes in: Finnhub's stock prices are in USD only. */
const currenciesFor = (source: string | undefined) =>
  isStock(source) ? ["USD"] : CURRENCIES;

/** A fresh watch of `kind`, with the rules a new watch of that kind gets. */
export function blankWatch(kind: WatchKind): WatchInput {
  const w: WatchInput =
    kind === "price"
      ? { kind, source: "stock", symbol: "" }
      : kind === "feed"
        ? { kind, url: "" }
        : { kind, url: "", read: "text" };
  return { ...w, rules: defaultRules(w) };
}

/** A watch's fields changed: keep its rules when it still gives the same kind of reading. */
function reshape(prev: WatchInput, next: WatchInput): WatchInput {
  return readingKind(prev) === readingKind(next)
    ? next
    : { ...next, rules: defaultRules(next) };
}

/** The watch's own problems, in the words Create uses (the bot's name left out). */
function watchErrors(
  w: WatchInput,
  hasKey: (source: string) => boolean,
): string[] {
  return draftErrors(
    {
      name: "x",
      description: "",
      intervalMinutes: 0,
      watches: [{ ...w, rules: [] }],
    },
    hasKey,
  );
}

/** The page read once: what it says now, and the prices found on it to follow instead. */
function PreviewBox({
  input,
  watch,
  onPick,
}: {
  input: PreviewInput;
  watch: WatchInput;
  onPick: (candidate: PreviewCandidate) => void;
}) {
  const preview = useBotPreview(input);
  if (preview.isLoading) {
    return <GroupHint>Reading it once…</GroupHint>;
  }
  if (preview.error) {
    return (
      <GroupHint className="text-destructive">
        {preview.error.message}
      </GroupHint>
    );
  }
  const read = preview.data?.watches[0];
  if (!read) return null;
  if (!read.ok) {
    return (
      <GroupHint className="text-destructive">
        {read.health?.line || "It could not be read."}
      </GroupHint>
    );
  }
  const text = read.excerpt?.text || read.text;
  const candidates = read.candidates ?? [];
  return (
    <div className="mt-3 flex flex-col gap-2">
      <GroupLabel aside="Read once, nothing saved">
        Right now it reads
      </GroupLabel>
      <div className="rounded-[12px] border border-border bg-card p-3.5">
        <p className="text-sm font-semibold tabular-nums text-foreground">
          {read.summary || "Something, with no summary"}
        </p>
        {text ? (
          <p className="mt-2 line-clamp-4 rounded-[10px] bg-fill px-2.5 py-2 font-mono text-xs leading-relaxed text-foreground">
            {text}
          </p>
        ) : null}
        {read.items?.length ? (
          <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
            {read.items.slice(0, 5).map((item, i) => (
              <li key={`${item.url}-${i}`} className="truncate">
                {item.title}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {candidates.length ? (
        <>
          <GroupLabel aside="Pick one to follow it">
            Prices on the page
          </GroupLabel>
          <ListGroup>
            {candidates.slice(0, 6).map((c, i) => {
              const following =
                c.selector !== ""
                  ? watch.read === "selector_price" &&
                    watch.selector === c.selector
                  : watch.read === "product_price";
              return (
                <ListRow
                  key={`${c.selector}-${i}`}
                  label={
                    <span
                      className={cn("tabular-nums", c.struck && "line-through")}
                    >
                      {formatMoney(c.amount, c.currency)}
                    </span>
                  }
                  meta={`${c.label}${c.struck ? " · struck out" : ""}`}
                  onClick={following ? undefined : () => onPick(c)}
                >
                  {following ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                      <Check className="size-3.5" />
                      Following
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-primary">
                      Follow this
                    </span>
                  )}
                </ListRow>
              );
            })}
          </ListGroup>
        </>
      ) : null}
    </div>
  );
}

/**
 * One watch, edited in place of the editor's groups: a page (its address,
 * what it reads and the part), a feed (its address) or a price (stock or
 * coin, symbol, currency). Test reads it once without saving and offers the
 * prices it found. Save hands the watch back; nothing is sent from here.
 */
export function WatchEditor({
  watch: initial,
  view,
  isNew,
  isLast,
  unsaved = false,
  hasKey,
  onSave,
  onRemove,
  onBack,
}: {
  watch: WatchInput;
  view?: WatchView;
  isNew: boolean;
  /** The bot's only watch: it cannot be removed. */
  isLast: boolean;
  /** The bot is not created yet: a watch goes at once, even its only one. */
  unsaved?: boolean;
  hasKey: (source: string) => boolean;
  onSave: (watch: WatchInput) => void;
  onRemove?: () => void;
  onBack: () => void;
}) {
  const [w, setW] = useState<WatchInput>(initial);
  const [test, setTest] = useState<PreviewInput | null>(null);
  const [lastRefused, setLastRefused] = useState(false);
  const errors = watchErrors(w, hasKey);
  const needsKey =
    w.kind === "price" && isStock(w.source) && !hasKey("finnhub");
  const update = (next: WatchInput) => {
    setW(reshape(w, next));
    setTest(null);
  };
  const changeKind = (kind: WatchKind) => {
    if (kind === w.kind) return;
    setW(blankWatch(kind));
    setTest(null);
  };
  const partRead = w.read === "selector" || w.read === "selector_price";
  const urlOk =
    w.kind !== "price" &&
    !!w.url?.trim() &&
    !errors.some((e) => /address|link/.test(e));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          leading={<ArrowLeft />}
          onClick={onBack}
        >
          Watches
        </Button>
        <span className="text-[13px] font-semibold text-foreground">
          {isNew ? "New watch" : "Edit watch"}
        </span>
      </div>

      <section>
        <GroupLabel>What it reads</GroupLabel>
        <ListGroup>
          {[
            ...(isNew
              ? [
                  <ListRow key="kind" label="Watches">
                    <SegmentedControl
                      size="sm"
                      aria-label="Watches"
                      value={w.kind}
                      onChange={changeKind}
                      options={[
                        { value: "page", label: "A page" },
                        { value: "feed", label: "A feed" },
                        { value: "price", label: "A price" },
                      ]}
                    />
                  </ListRow>,
                ]
              : []),
            ...(w.kind === "price"
              ? [
                  <ListRow key="market" label="Kind">
                    <SegmentedControl
                      size="sm"
                      aria-label="Kind"
                      value={isStock(w.source) ? "stock" : "crypto"}
                      onChange={(v) =>
                        update({
                          ...w,
                          source: v,
                          currency: v === "crypto" ? w.currency || "USD" : "",
                        })
                      }
                      options={[
                        { value: "stock", label: "Stock" },
                        { value: "crypto", label: "Coin" },
                      ]}
                    />
                  </ListRow>,
                  <ListRow
                    key="symbol"
                    label="Symbol"
                    meta={
                      isStock(w.source)
                        ? "Like NVDA or AAPL"
                        : "Like BTC or ETH. Pick the currency below"
                    }
                  >
                    <RowInput
                      aria-label="Symbol"
                      value={w.symbol ?? ""}
                      placeholder={isStock(w.source) ? "NVDA" : "BTC"}
                      onChange={(symbol) =>
                        update({ ...w, symbol: symbol.toUpperCase() })
                      }
                    />
                  </ListRow>,
                  <ListRow key="currency" label="Currency">
                    <Select
                      variant="row"
                      aria-label="Currency"
                      value={w.currency ?? ""}
                      options={[
                        { value: "", label: "The source’s own" },
                        ...currenciesFor(w.source).map((c) => ({
                          value: c,
                          label: c,
                        })),
                      ]}
                      onChange={(currency) => update({ ...w, currency })}
                    />
                  </ListRow>,
                ]
              : [
                  <ListRow
                    key="url"
                    label={w.kind === "feed" ? "Feed link" : "Page link"}
                  >
                    <RowInput
                      type="url"
                      aria-label={w.kind === "feed" ? "Feed link" : "Page link"}
                      value={w.url ?? ""}
                      placeholder="https://"
                      onChange={(url) => update({ ...w, url })}
                    />
                  </ListRow>,
                  ...(w.kind === "page"
                    ? [
                        <ListRow key="read" label="Reads">
                          <Select
                            variant="row"
                            aria-label="Reads"
                            value={w.read ?? "text"}
                            options={READ_OPTIONS.map((o) => ({
                              value: o.id,
                              label: o.label,
                            }))}
                            onChange={(read) =>
                              update({ ...w, read: read as ReadMode })
                            }
                          />
                        </ListRow>,
                      ]
                    : []),
                  ...(partRead
                    ? [
                        <ListRow
                          key="selector"
                          label="The part"
                          meta="A CSS selector, like #price or .stock-status"
                        >
                          <RowInput
                            mono
                            aria-label="The part, as a CSS selector"
                            value={w.selector ?? ""}
                            placeholder="#price"
                            onChange={(selector) => update({ ...w, selector })}
                          />
                        </ListRow>,
                      ]
                    : []),
                  <ListRow
                    key="test"
                    label="Test it"
                    meta="Reads it once now. Nothing is saved."
                  >
                    <Button
                      size="sm"
                      leading={<FlaskConical />}
                      disabled={!urlOk}
                      onClick={() =>
                        setTest({
                          watches: [
                            cleanWatchInput({ ...w, rules: undefined }),
                          ],
                        })
                      }
                    >
                      Test
                    </Button>
                  </ListRow>,
                ]),
          ]}
        </ListGroup>
        {w.kind === "price" && isStock(w.source) ? (
          needsKey ? (
            <GroupHint>
              Stock prices need your free Finnhub key.{" "}
              <Link
                href={BOT_KEYS_HREF}
                className="font-medium text-primary hover:underline"
              >
                Add a free Finnhub key
              </Link>
            </GroupHint>
          ) : (
            <GroupHint>Prices from Finnhub (your free key).</GroupHint>
          )
        ) : w.kind === "price" ? (
          <GroupHint>Coin prices from Coinbase. No key needed.</GroupHint>
        ) : null}
        {test ? (
          <PreviewBox
            input={test}
            watch={w}
            onPick={(c) =>
              update(
                c.selector
                  ? { ...w, read: "selector_price", selector: c.selector }
                  : { ...w, read: "product_price", selector: undefined },
              )
            }
          />
        ) : null}
      </section>

      {!isNew ? (
        <section>
          <ListGroup>
            <ListRow
              label="Remove watch"
              tone="danger"
              icon={
                <Trash2
                  aria-hidden
                  className="size-4 shrink-0 text-destructive"
                />
              }
              onClick={() => {
                if (unsaved) {
                  onRemove?.();
                  return;
                }
                if (isLast) {
                  setLastRefused(true);
                  return;
                }
                requestConfirm({
                  title: "Remove this watch?",
                  description:
                    view?.kind === "price" || view?.read === "product_price"
                      ? "Its readings and price history go too."
                      : "Its readings go too.",
                  confirmLabel: "Remove",
                  onConfirm: () => onRemove?.(),
                });
              }}
            />
          </ListGroup>
          {lastRefused ? (
            <GroupHint className="text-destructive">
              A bot needs a watch. Delete the bot instead, or add another watch
              first.
            </GroupHint>
          ) : null}
        </section>
      ) : null}

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {errors[0] ??
            (isNew
              ? "Its rules start from the usual ones; change them after."
              : "Its rules stay as they are.")}
        </p>
        <Button variant="outline" onClick={onBack}>
          Cancel
        </Button>
        <Button
          disabled={errors.length > 0}
          onClick={() => onSave(cleanWatchInput(w))}
        >
          {isNew ? "Add watch" : "Save"}
        </Button>
      </div>
    </div>
  );
}
