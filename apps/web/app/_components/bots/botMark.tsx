import { Bot, ChartCandlestick, Globe, Rss, Tag } from "lucide-react";
import {
  hostOf,
  monogram,
  watchKindIcon,
  type WatchInput,
  type WatchView,
} from "@timely/contract/bots";
import { cn } from "@/app/utils/cn";

/** Site logos by site, as data URIs; null when a site has none (`useBotIcons`). */
export type SiteIcons = Record<string, string | null> | undefined;

const KIND_ICONS = {
  tag: Tag,
  globe: Globe,
  rss: Rss,
  "chart-candlestick": ChartCandlestick,
};

const TILE = {
  24: "size-6 rounded-[8px]",
  32: "size-8 rounded-[10px]",
  40: "size-10 rounded-[12px]",
} as const;
const LOGO = { 24: 16, 32: 20, 40: 24 } as const;

type MarkWatch = Pick<WatchView, "kind"> &
  Partial<Pick<WatchView, "site" | "url" | "read" | "symbol" | "source">>;

/** The site of a page or feed watch; "" for a price. */
export function watchSite(w: MarkWatch | WatchInput): string {
  if (w.kind === "price") return "";
  return ("site" in w && w.site) || hostOf(w.url);
}

/** Every site a list of bots reads, for one logo request. */
export function botSites(watches: (MarkWatch | WatchInput)[]): string[] {
  return [...new Set(watches.map(watchSite).filter(Boolean))].sort();
}

function SiteLogo({
  site,
  src,
  px,
  ring,
}: {
  site: string;
  src: string | null | undefined;
  px: number;
  ring?: boolean;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a re-encoded 64 px logo served as a data URI
      <img
        src={src}
        alt=""
        width={px}
        height={px}
        className={cn(
          "block shrink-0 rounded-[4px] object-contain",
          ring && "shadow-[0_0_0_1.5px_var(--fill)]",
        )}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-[5px] bg-card font-semibold leading-none text-foreground",
        ring
          ? "shadow-[0_0_0_1.5px_var(--fill)]"
          : "shadow-[0_0_0_1px_var(--border)]",
      )}
      style={{ width: px, height: px, fontSize: Math.round(px * 0.6) }}
    >
      {(site.charAt(0) || "?").toUpperCase()}
    </span>
  );
}

/**
 * A bot's mark: its site's logo (or the site's first letter), two overlapped
 * logos when it reads two or more sites, or the symbol's letters for a price,
 * with the first watch's kind as a small corner badge.
 */
export function BotMark({
  watches,
  size = 32,
  icons,
  badge = size >= 32,
  className,
}: {
  watches: (MarkWatch | WatchInput)[];
  size?: 24 | 32 | 40;
  icons?: SiteIcons;
  badge?: boolean;
  className?: string;
}) {
  const first = watches[0];
  const sites = botSites(watches);
  const px = LOGO[size];
  let inner;
  if (!first) {
    inner = <Bot aria-hidden className="size-1/2 text-muted-foreground" />;
  } else if (sites.length === 0) {
    const letters = monogram(first);
    const scale =
      letters.length >= 4 ? 0.28 : letters.length === 3 ? 0.32 : 0.42;
    inner = (
      <span
        aria-hidden
        className="font-semibold leading-none tracking-[-0.02em] text-foreground"
        style={{ fontSize: Math.round(size * scale) }}
      >
        {letters}
      </span>
    );
  } else if (sites.length === 1) {
    inner = <SiteLogo site={sites[0]} src={icons?.[sites[0]]} px={px} />;
  } else {
    // The first site's logo nearly full size, the second a smaller one on
    // an opaque backing in its corner, so the two read apart.
    const big = Math.round(px * 0.84);
    const small = Math.round(px * 0.6);
    inner = (
      <span
        aria-hidden
        className="relative"
        style={{ width: px + 2, height: px + 2 }}
      >
        <span className="absolute left-0 top-0">
          <SiteLogo site={sites[0]} src={icons?.[sites[0]]} px={big} />
        </span>
        <span className="absolute bottom-0 right-0 rounded-[4px] bg-card">
          <SiteLogo site={sites[1]} src={icons?.[sites[1]]} px={small} ring />
        </span>
      </span>
    );
  }
  const Kind = first ? KIND_ICONS[watchKindIcon(first)] : null;
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center bg-fill",
        TILE[size],
        className,
      )}
    >
      {inner}
      {badge && Kind ? (
        <span
          aria-hidden
          className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-card text-muted-foreground shadow-[0_0_0_1px_var(--border)]"
        >
          <Kind className="size-2.5" />
        </span>
      ) : null}
    </span>
  );
}
