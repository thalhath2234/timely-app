/**
 * Bots, as the web and phone apps draw them: the wire types of `/bots`, the
 * limits the API keeps, and the pure rules both apps share so the board says
 * the same thing on both: which group a bot sits in, what its card says, how
 * a fix reads, how often it may be checked, and the starters. Nothing here
 * fetches or renders; each app draws these with its own kit.
 *
 * Wire types mirror the Go JSON in apps/api/internal/features/bots (view.go,
 * models.go, validate.go, preview.go, ask.go, keys.go). Where they disagree,
 * the server wins.
 */

// ── Wire types ──

export type BotStatus = "active" | "paused";
export type PauseReason = "person" | "strikes" | "mcp";
export type BotOrigin = "app" | "chat" | "mcp";
export type WatchKind = "page" | "feed" | "price";
export type ReadMode = "text" | "selector" | "product_price" | "selector_price";
export type RuleKind = "any_change" | "above" | "below" | "move_pct" | "words_appear" | "words_disappear" | "new_item";
export type MoveDirection = "up" | "down" | "any";
/** How smart a bot is. Only `rules` exists today; the others are Later. */
export type JudgeMode = "rules";

/** One condition on a watch. The server fills `id`, `stepPercent` and `resetPercent`. */
export type Rule = {
  id?: string;
  kind: RuleKind;
  /** above and below. */
  threshold?: number;
  /** move_pct. */
  percent?: number;
  /** move_pct. */
  direction?: MoveDirection;
  /** above/below: fire again after a further this-much move; 0 means 5. */
  stepPercent?: number;
  /** above/below: re-arm once this far back past the line; 0 means 0.5. */
  resetPercent?: number;
  /** words_appear, words_disappear, and new_item (optional filter). */
  words?: string[];
};

/** One watch as a client sends it. A watch that keeps its id keeps its readings. */
export type WatchInput = {
  id?: string;
  kind: WatchKind;
  url?: string;
  read?: ReadMode;
  selector?: string;
  /** price: `stock` (saved as finnhub), `crypto` (coinbase) or a source name. */
  source?: string;
  symbol?: string;
  currency?: string;
  /** Left out on an edit: the watch keeps its rules. Empty on create: the defaults. */
  rules?: Rule[];
};

/** A new bot (`POST /bots`). intervalMinutes 0 means the default for its watches. */
export type BotInput = {
  name: string;
  description: string;
  intervalMinutes: number;
  judgeMode?: string;
  urgent?: boolean;
  desktop?: boolean;
  phone?: boolean;
  watches: WatchInput[];
};

/** An edit (`PATCH /bots/:id`); a field left out stays. `watches` is the full list. */
export type BotPatch = {
  name?: string;
  description?: string;
  intervalMinutes?: number;
  judgeMode?: string;
  urgent?: boolean;
  desktop?: boolean;
  phone?: boolean;
  watches?: WatchInput[];
};

/** Strike codes: a check that fails with one counts toward the pause at 5. */
export const STRIKE_CODES = [
  "source_down",
  "needs_key",
  "captcha",
  "forbidden",
  "not_found",
  "too_big",
  "blocked",
  "unsupported",
  "cant_find",
  "server_error",
] as const;
export type StrikeCode = (typeof STRIKE_CODES)[number];
export type HealthCode = "new" | "working" | "offline" | "rate_limited" | "waiting" | "robots" | StrikeCode;

/** A status code with a line written for the person. */
export type Health = { code: HealthCode | (string & {}); line: string };

export type ItemBrief = { title: string; url: string; publishedAt: string | null };

export type Feedback = "useful" | "not_useful";
export type FeedbackReason = "" | "too_small" | "not_wanted" | "already_knew";
/** Where an alert went: sent (""), kept while snoozed, or over the day's cap. */
export type AlertHeld = "" | "snoozed" | "cap";

/** The newest alert of a bot, on its card. */
export type AlertBrief = {
  id: string;
  title: string;
  body: string;
  url: string;
  held: AlertHeld;
  createdAt: string;
  feedback: Feedback | null;
};

export type WatchView = {
  id: string;
  kind: WatchKind;
  url: string;
  read: ReadMode | "";
  selector: string;
  source: string;
  symbol: string;
  currency: string;
  rules: Rule[];
  health: Health;
  lastReadingAt: string | null;
  /** "₹27,499", "12 items", "Text, 4,210 characters". */
  summary: string;
  /** Registrable domain; "" for a price. */
  site: string;
  /** The page's own title (product name), "" when none. */
  title: string;
  /** The last price read, for price readings. */
  value: number | null;
  /** ≤160 characters: the selected text, the line with a rule's word, or a feed's newest title. */
  excerpt: string;
  latestItem: ItemBrief | null;
  /** Detail only: the newest 5 feed items. */
  items?: ItemBrief[];
  lastChangedAt: string | null;
  /** Price readings: ≤31 [unixSeconds, value], the last 30 daily closes and now. */
  spark: [number, number][] | null;
  dayChangePct: number | null;
};

/** One mark per check, oldest first. */
export type StripMark = "n" | "c" | "f" | "x" | "o";

export type BotView = {
  id: string;
  name: string;
  description: string;
  status: BotStatus;
  pauseReason: PauseReason | null;
  origin: BotOrigin;
  /** The outside app's name (its API key's name) when origin is mcp, else "". */
  originClient: string;
  judgeMode: string;
  intervalMinutes: number;
  urgent: boolean;
  desktop: boolean;
  phone: boolean;
  snoozedUntil: string | null;
  nextCheckAt: string | null;
  lastCheckAt: string | null;
  lastOkAt: string | null;
  strikes: number;
  health: Health;
  alertsToday: number;
  watches: WatchView[];
  createdAt: string;
  updatedAt: string;
  /** A check is running now. */
  checking: boolean;
  /** When Check now can run, while the floor holds it back; else null. */
  runNowAt: string | null;
  /** "Shop prices are checked every 6 hours at most". */
  floorLine: string;
  /** ≤28 marks (StripMark), oldest first. */
  strip: string;
  latestAlert: AlertBrief | null;
  /** New feed items in today's alerts. */
  itemsToday: number;
};

export type BotsSummary = { checksToday: number; alertsToday: number; nextCheckAt: string | null };

/** `GET /bots`. */
export type BotsList = { bots: BotView[]; summary: BotsSummary };

export type CheckTrigger = "schedule" | "wake" | "run_now" | "ask";
export type CheckOutcome =
  | "baseline"
  | "unchanged"
  | "not_modified"
  | "changed"
  | "fired"
  | "offline"
  | "rate_limited"
  | "site_busy"
  | "robots"
  | "strike"
  | "superseded";

export type FiredRule = { watchId: string; ruleId: string; kind: RuleKind };

export type CheckView = {
  id: string;
  trigger: CheckTrigger;
  startedAt: string;
  outcome: CheckOutcome;
  errorKind: string;
  error: string;
  fired: FiredRule[] | null;
};

/** The numbers behind an alert. */
export type AlertFigures = {
  rule?: RuleKind;
  price?: number;
  currency?: string;
  was?: number;
  threshold?: number;
  changePct?: number;
  items?: number;
};

export type AlertKind = "alert" | "more" | "paused";

export type AlertView = {
  id: string;
  kind: AlertKind;
  held: AlertHeld;
  title: string;
  body: string;
  url: string;
  urgent: boolean;
  moreCount: number;
  createdAt: string;
  checkId: string | null;
  figures: AlertFigures | null;
  feedback: Feedback | null;
  feedbackReason: FeedbackReason;
  feedbackNote: string;
  feedbackAt: string | null;
};

/** One UTC day of a price watch. Points are [unixSeconds, price]. */
export type PriceDay = {
  watchId: string;
  /** YYYY-MM-DD, UTC. */
  day: string;
  currency: string;
  points: [number, number][] | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
};

export type Lesson = { id: string; botId: string; alertId: string | null; text: string; createdAt: string };

/** A below/above rule that armed again without an alert ("Armed again, no alert"). */
export type Rearm = { at: string; watchId: string; ruleId: string; value: number; currency: string };

/** `GET /bots/:id`. */
export type BotDetail = BotView & {
  checks: CheckView[] | null;
  alerts: AlertView[] | null;
  prices: PriceDay[] | null;
  lessons: Lesson[] | null;
  /** The last 7 days; alerts of kind alert. */
  week: { checks: number; alerts: number };
  /** Alerts in the last 30 days. */
  alertsMonth: number;
  /** The last 30 days, newest first, at most 5. */
  rearms: Rearm[] | null;
};

/** `POST /bots/:id/run` (202). */
export type RunResult = { jobId: string; runAt: string; line: string };

/** A typed note on the findings board. It never holds raw page text. */
export type Finding = {
  id: string;
  botId: string;
  checkId: string | null;
  watchId: string | null;
  kind: "change" | "price" | "item" | "status";
  title: string;
  why: string;
  url: string;
  price: number | null;
  currency: string;
  changePct: number | null;
  urgency: "low" | "normal" | "high";
  outsideData: boolean;
  alerted: boolean;
  digestedAt: string | null;
  createdAt: string;
};

/** `POST /bots/:id/alerts/:alertId/feedback`. */
export type FeedbackInput =
  | { feedback: "useful" }
  | { feedback: "not_useful"; reason?: FeedbackReason; note?: string }
  | { feedback: null };

/** `POST /bots/preview`: watches (1–5) or a saved bot's watches. */
export type PreviewInput = { watches: WatchInput[] } | { botId: string };

/** A price found on a previewed page; picking one makes a selector_price watch. */
export type PreviewCandidate = {
  label: string;
  amount: number;
  currency: string;
  /** "" for a structured price (JSON-LD, og, itemprop). */
  selector: string;
  struck: boolean;
  from: "jsonld" | "og" | "itemprop" | "text";
};

export type PreviewExcerpt = {
  text: string;
  /** Character offsets of the price read. */
  mark: [number, number];
  /** Character offsets of struck-out prices. */
  struck: [number, number][] | null;
};

export type PreviewWatch = {
  index: number;
  /** "" for a watch not saved yet. */
  watchId: string;
  ok: boolean;
  kind: WatchKind;
  read: ReadMode | "";
  site: string;
  summary: string;
  value: number | null;
  currency: string;
  /** ≤600 characters, for text and selector reads. */
  text: string;
  items: ItemBrief[] | null;
  excerpt: PreviewExcerpt | null;
  candidates: PreviewCandidate[] | null;
  /** Why it could not read, when ok is false. */
  health: Health | null;
  at: string;
};

export type PreviewResult = { watches: PreviewWatch[] };

/** `GET /bots/keys`: one row per keyed price source. The key itself never comes back. */
export type SourceKeyView = {
  source: string;
  label: string;
  keySet: boolean;
  /** "…abcd", or "". */
  keyHint: string;
  state: "ok" | "refused" | "";
  checkedAt: string | null;
};

/** `GET/PUT /bots/defaults`: where a new bot alerts. */
export type BotSettings = { desktop: boolean; phone: boolean; urgent: boolean };

export const DEFAULT_BOT_SETTINGS: BotSettings = { desktop: true, phone: true, urgent: false };

export type AnswerFresh = "checked_now" | "recent" | "waiting" | "paused" | "limited" | "floor";

export type AnswerWatch = {
  id: string;
  kind: WatchKind;
  site: string;
  title: string;
  summary: string;
  value: number | null;
  currency: string;
  excerpt: string;
  items: ItemBrief[] | null;
  lastChangedAt: string | null;
};

/** A tagged bot's answer in chat (`Message.botAnswers[]`, the `ask_bot` result). */
export type BotAnswer = {
  bot: { id: string; name: string; status: BotStatus; pauseReason: PauseReason | null; health: Health };
  fresh: AnswerFresh;
  /** "Checked just now", "Paused, so this is from Nov 2", … */
  freshLine: string;
  checkedAt: string | null;
  nextCheckAt: string | null;
  watches: AnswerWatch[];
  findings: Finding[];
  alertsToday: number;
};

// ── Limits ──

/**
 * What the API allows (apps/api/internal/features/bots/bots.go and
 * validate.go). The API's contract test reads these lines and fails when the
 * two drift, so keep each value a plain number literal.
 */
export const BOT_LIMITS = {
  maxBots: 25,
  maxWatches: 5,
  maxRulesPerWatch: 5,
  alertsPerDay: 3,
  maxLessons: 20,
  maxStrikes: 5,
  maxNameLen: 80,
  maxDescriptionLen: 2000,
  minEveryMinutes: { page: 15, feed: 15, price: 5, shop: 360 },
  maxEveryMinutes: 10080,
  maxSnoozeDays: 30,
} as const;

/** The rows of the "Limits · Kept by Timely" card. */
export function limitRows(): [string, string][] {
  const L = BOT_LIMITS;
  return [
    ["Bots", `Up to ${L.maxBots}`],
    ["Watches per bot", `Up to ${L.maxWatches}`],
    ["Rules per watch", `Up to ${L.maxRulesPerWatch}`],
    ["Shop page", `Every ${L.minEveryMinutes.shop / 60} h at most`],
    ["Pages and feeds", `Every ${L.minEveryMinutes.page} min at most`],
    ["Prices", `Every ${L.minEveryMinutes.price} min at most`],
  ];
}

// ── Times ──

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

type ZoneParts = { weekday: string; day: string; month: string; year: string; time: string; key: string };
const zoneFormats = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock parts of `at` in `tz` (the host's zone when left out). */
function zoneParts(at: number, tz?: string): ZoneParts {
  const id = tz ?? "";
  let f = zoneFormats.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    zoneFormats.set(id, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(at))) p[part.type] = part.value;
  const hour = p.hour === "24" ? "00" : p.hour;
  return {
    weekday: p.weekday,
    day: p.day,
    month: p.month,
    year: p.year,
    time: `${hour}:${p.minute}`,
    key: `${p.year}-${p.month}-${p.day}`,
  };
}

/** "Nov 5". */
export function shortDate(iso: string, tz?: string): string {
  const t = ms(iso);
  if (t === null) return "";
  const p = zoneParts(t, tz);
  return `${p.month} ${p.day}`;
}

/** "Nov 5, 22:40". */
export function dateTime(iso: string, tz?: string): string {
  const t = ms(iso);
  if (t === null) return "";
  const p = zoneParts(t, tz);
  return `${p.month} ${p.day}, ${p.time}`;
}

/**
 * A coming time, as short as it can be read: "00:12" within a day, "Mon 09:00"
 * within a week, else "Nov 14, 09:00".
 */
export function clockLabel(iso: string, now: Date, tz?: string): string {
  const t = ms(iso);
  if (t === null) return "";
  const p = zoneParts(t, tz);
  const ahead = t - now.getTime();
  if (ahead < DAY) return p.time;
  if (ahead < 6 * DAY) return `${p.weekday} ${p.time}`;
  return `${p.month} ${p.day}, ${p.time}`;
}

/** "just now", "12 min ago", "3 h ago", else "Nov 2". */
export function agoLabel(iso: string, now: Date, tz?: string): string {
  const t = ms(iso);
  if (t === null) return "";
  const d = now.getTime() - t;
  if (d < MINUTE) return "just now";
  if (d < HOUR) return `${Math.floor(d / MINUTE)} min ago`;
  if (d < 2 * DAY) return `${Math.floor(d / HOUR)} h ago`;
  return shortDate(iso, tz);
}

/** "in under a minute", "in 4 min", "in 2 h", "in 3 days". */
export function inLabel(iso: string, now: Date): string {
  const t = ms(iso);
  if (t === null) return "";
  const d = t - now.getTime();
  if (d < MINUTE) return "in under a minute";
  if (d < HOUR) return `in ${Math.round(d / MINUTE)} min`;
  if (d < 2 * DAY) return `in ${Math.round(d / HOUR)} h`;
  return `in ${Math.round(d / DAY)} days`;
}

// ── Money and numbers ──

const MONEY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥" };

/** Puts commas between thousands in a string of digits. */
function group(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.length % 3;
  const parts = head > 0 ? [digits.slice(0, head)] : [];
  for (let i = head; i < digits.length; i += 3) parts.push(digits.slice(i, i + 3));
  return parts.join(",");
}

/**
 * A price for a person, the same as the API's formatMoney (view.go): a symbol
 * for USD, EUR, GBP, INR and JPY ("₹27,499", "$187.20"), else "1,234.50 CHF".
 * Whole amounts drop their decimals; JPY never has any, and tiny crypto prices
 * keep enough.
 */
/**
 * a.toFixed(d), but an exact binary tie rounds half to even, as Go's
 * strconv.FormatFloat does (toFixed rounds it up): 187.125 → "187.12".
 */
function toFixedEven(a: number, d: number): string {
  const up = a.toFixed(d);
  if (a >= 1e21) return up;
  // toFixed is exact up to 100 digits, which holds every double from about
  // 1e-14 up; smaller values never tie at 8 decimals or fewer.
  const exact = a.toFixed(100);
  const dot = exact.indexOf(".");
  if (!/^50*$/.test(exact.slice(dot + 1 + d))) return up;
  const down = exact.slice(0, d === 0 ? dot : dot + 1 + d);
  return (down.charCodeAt(down.length - 1) - 48) % 2 === 0 ? down : up;
}

export function formatMoney(v: number, currency: string): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  let decimals = 2;
  if (currency === "JPY") decimals = 0;
  else if (a !== 0 && a < 1) decimals = Math.min(8, Math.max(2, Math.ceil(-Math.log10(a)) + 3));
  else if (a === Math.trunc(a)) decimals = 0;
  let s = toFixedEven(a, decimals);
  if (decimals > 2) s = s.replace(/0+$/, "");
  const dot = s.indexOf(".");
  const whole = dot < 0 ? s : s.slice(0, dot);
  const frac = dot < 0 ? "" : s.slice(dot + 1);
  s = group(whole) + (frac ? `.${frac}` : "");
  const sign = v < 0 ? "-" : "";
  const sym = MONEY_SYMBOLS[currency];
  if (sym) return sign + sym + s;
  if (!currency) return sign + s;
  return `${sign}${s} ${currency}`;
}

/** "5", "0.5", "12.25": a percent without trailing zeros. */
function pctNumber(p: number): string {
  return String(Number(p.toFixed(2)));
}

/** "+2.4%" / "−8.3%" (a true minus). */
export function signedPct(p: number): string {
  const s = Math.abs(p).toFixed(1);
  return `${p < 0 && s !== "0.0" ? "−" : "+"}${s}%`;
}

/** The currency of a watch: its own, else the one its last reading was shown in. */
export function watchCurrency(w: Pick<WatchView, "currency" | "summary">): string {
  if (w.currency) return w.currency;
  const s = w.summary ?? "";
  for (const [code, sym] of Object.entries(MONEY_SYMBOLS)) {
    if (s.startsWith(sym) || s.startsWith(`-${sym}`)) return code;
  }
  const code = /\s([A-Z]{3})$/.exec(s);
  return code ? code[1] : "";
}

// ── Watches ──

/** The fields that decide what a watch reads; a saved watch and an input both fit. */
type KindRead = { kind: WatchKind; read?: ReadMode | "" };

type WatchLike = KindRead & { url?: string; source?: string; symbol?: string; site?: string; title?: string };

/** The kind of reading a watch gives: text, price or feed. */
export function readingKind(w: KindRead): "text" | "price" | "feed" {
  if (w.kind === "feed") return "feed";
  if (w.kind === "price" || w.read === "product_price" || w.read === "selector_price") return "price";
  return "text";
}

export const isPriceReading = (w: KindRead) => readingKind(w) === "price";
const isShop = (w: KindRead) =>
  w.kind === "page" && (w.read === "product_price" || w.read === "selector_price");
const isPartRead = (w: { read?: ReadMode | "" }) => w.read === "selector" || w.read === "selector_price";

/** The rule kinds that fit a watch, in the order the editor offers them. */
export function rulesFor(w: KindRead): RuleKind[] {
  switch (readingKind(w)) {
    case "feed":
      return ["new_item"];
    case "price":
      return ["below", "above", "move_pct", "any_change"];
  }
  return ["any_change", "words_appear", "words_disappear"];
}

export const RULE_LABELS: Record<RuleKind, string> = {
  below: "Price is below",
  above: "Price is above",
  move_pct: "Moves by a percent",
  any_change: "Any change",
  words_appear: "Words appear",
  words_disappear: "Words disappear",
  new_item: "A new post",
};

/** The page read modes, as the "Reads" row offers them. */
export const READ_OPTIONS: { id: ReadMode; label: string }[] = [
  { id: "text", label: "Readable text" },
  { id: "selector", label: "One part of the page" },
  { id: "product_price", label: "Shop price" },
  { id: "selector_price", label: "One price on the page" },
];

/** "How smart". Rules only exists today. */
export const HOW_SMART: { id: string; label: string; later?: true }[] = [
  { id: "rules", label: "Rules only" },
  { id: "ai", label: "AI judges", later: true },
  { id: "research", label: "Research", later: true },
];

/** The "Not useful" reasons. */
export const FEEDBACK_REASONS: { id: Exclude<FeedbackReason, "">; label: string }[] = [
  { id: "too_small", label: "Change too small" },
  { id: "not_wanted", label: "Not what I want" },
  { id: "already_knew", label: "Already knew" },
];

const SOURCE_LABELS: Record<string, string> = {
  finnhub: "Finnhub",
  stock: "Finnhub",
  coinbase: "Coinbase",
  crypto: "Coinbase",
  coingecko: "CoinGecko",
  yahoo: "Yahoo Finance",
};

/** The price source a watch reads from, by name ("Coinbase"). */
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** The registrable-looking host of an address, without "www.". */
export function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const siteOf = (w: WatchLike) => w.site || hostOf(w.url);

const READ_TITLES: Record<string, string> = {
  product_price: "Product price",
  selector_price: "Price on the page",
  selector: "Part of the page",
  text: "Page text",
};

/**
 * A watch's name: "amazon.in · Sony WH-1000XM6 Wireless" from the page's
 * title, else "amazon.in · Product price"; "BTC-USD · Coinbase" for a price;
 * "go.dev · New posts" for a feed. The API's watchTitle follows the same rule.
 */
export function watchTitle(w: WatchLike): string {
  if (w.kind === "price") return `${w.symbol || "Price"} · ${sourceLabel(w.source ?? "")}`;
  const site = siteOf(w) || "New page";
  if (w.kind === "feed") return `${site} · ${w.title || "New posts"}`;
  return `${site} · ${w.title || READ_TITLES[w.read ?? ""] || "Page"}`;
}

/** The kind badge: `tag` (a shop price), `globe` (a page), `rss`, `chart-candlestick`. */
export function watchKindIcon(w: KindRead): "tag" | "globe" | "rss" | "chart-candlestick" {
  if (w.kind === "price") return "chart-candlestick";
  if (w.kind === "feed") return "rss";
  return isShop(w) ? "tag" : "globe";
}

/** The letters on a logo tile with no logo: "BTC", "NVDA", or the site's first letter. */
export function monogram(w: WatchLike): string {
  if (w.kind === "price") return (w.symbol ?? "").split(/[-/.:=^]/)[0].slice(0, 4).toUpperCase() || "?";
  return (siteOf(w).charAt(0) || "?").toUpperCase();
}

/** "r/buildapcsales, slickdeals.net": a bot's feeds, under a feed card's value. */
export function feedSources(bot: Pick<BotView, "watches">): string | null {
  const names = bot.watches
    .filter((w) => w.kind === "feed")
    .map((w) => {
      let path = "";
      try {
        path = new URL(w.url).pathname;
      } catch {
        // keep the site
      }
      const sub = /^\/r\/([^/]+)/.exec(path);
      return sub && siteOf(w).endsWith("reddit.com") ? `r/${sub[1]}` : siteOf(w);
    })
    .filter(Boolean);
  return names.length ? [...new Set(names)].join(", ") : null;
}

/** The threshold a watch's first below/above rule draws as a line, if any. */
export function lineOf(w: Pick<WatchInput, "rules">): number | null {
  const r = (w.rules ?? []).find((x) => (x.kind === "below" || x.kind === "above") && x.threshold != null);
  return r?.threshold ?? null;
}

// ── Schedule ──

/** The shortest interval a watch may be checked at, in minutes. */
export function minEveryMinutes(w: KindRead): number {
  const m = BOT_LIMITS.minEveryMinutes;
  if (w.kind === "price") return m.price;
  if (isShop(w)) return m.shop;
  return w.kind === "feed" ? m.feed : m.page;
}

/** A bot's floor in minutes: the largest of its watches' (5 with none). */
export function floorMinutes(watches: KindRead[]): number {
  return watches.reduce<number>((f, w) => Math.max(f, minEveryMinutes(w)), BOT_LIMITS.minEveryMinutes.price);
}

/** The interval a bot saved with 0 gets: the API's DefaultInterval. */
export function defaultMinutes(watches: KindRead[]): number {
  let d = floorMinutes(watches);
  for (const w of watches) {
    d = Math.max(d, w.kind === "price" ? 15 : w.kind === "feed" ? 30 : isShop(w) ? 360 : 60);
  }
  return d;
}

/** Why a shorter interval is refused, the API's floorLine. */
export function floorLine(watches: KindRead[]): string {
  const f = floorMinutes(watches);
  if (f >= BOT_LIMITS.minEveryMinutes.shop) return "Shop prices are checked every 6 hours at most";
  if (f >= BOT_LIMITS.minEveryMinutes.page) return "Pages and feeds are checked every 15 minutes at most";
  return "Prices are checked every 5 minutes at most";
}

/** The schedule group's hint: why the floor is what it is. */
export function floorHint(watches: KindRead[]): string {
  const f = floorMinutes(watches);
  if (f >= BOT_LIMITS.minEveryMinutes.shop) {
    return "A shop page is read at most every 6 hours, so the site doesn’t see Timely as a crawler.";
  }
  if (f >= BOT_LIMITS.minEveryMinutes.page) return "Pages and feeds are read at most every 15 minutes.";
  return "Prices are read at most every 5 minutes.";
}

const INTERVALS = [5, 15, 30, 60, 120, 360, 720, 1440, 10080];

/**
 * The "Checks every" choices in minutes, from the bot's floor up to a week.
 * A saved value that is not one of them stays offered.
 */
export function intervalOptions(watches: KindRead[], current?: number): number[] {
  const floor = floorMinutes(watches);
  const out = INTERVALS.filter((m) => m >= floor);
  if (current && current >= floor && current <= BOT_LIMITS.maxEveryMinutes && !out.includes(current)) {
    out.push(current);
    out.sort((a, b) => a - b);
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "5 minutes", "1 hour", "6 hours", "1 day", "1 week". */
export function intervalLabel(minutes: number): string {
  if (minutes % 10080 === 0) return plural(minutes / 10080, "week");
  if (minutes % 1440 === 0) return plural(minutes / 1440, "day");
  if (minutes % 60 === 0) return plural(minutes / 60, "hour");
  return plural(minutes, "minute");
}

/** "every 5 min", "every hour", "every 6 h", "daily", "weekly": a card's sub line. */
export function everyLabel(minutes: number): string {
  if (minutes === 10080) return "weekly";
  if (minutes === 1440) return "daily";
  if (minutes % 1440 === 0) return `every ${minutes / 1440} days`;
  if (minutes === 60) return "every hour";
  if (minutes % 60 === 0) return `every ${minutes / 60} h`;
  return `every ${minutes} min`;
}

// ── Rules ──

const quoted = (words: string[] | undefined) => (words ?? []).map((w) => `“${w}”`).join(" or ");

/**
 * A rule as a row label: "Price is below ₹25,000", "Moves 5% either way",
 * "“Add to cart” appears", "Any change", "A new post".
 */
export function ruleLine(rule: Rule, watch: Pick<WatchView, "currency" | "summary"> | Pick<WatchInput, "currency">): string {
  const cur = "summary" in watch ? watchCurrency(watch) : (watch.currency ?? "");
  const money = (v: number | undefined) => (v == null ? "…" : formatMoney(v, cur));
  switch (rule.kind) {
    case "below":
      return `Price is below ${money(rule.threshold)}`;
    case "above":
      return `Price is above ${money(rule.threshold)}`;
    case "move_pct": {
      const p = rule.percent == null ? "…" : pctNumber(rule.percent);
      if (rule.direction === "up") return `Rises ${p}%`;
      if (rule.direction === "down") return `Drops ${p}%`;
      return `Moves ${p}% either way`;
    }
    case "words_appear":
      return `${quoted(rule.words) || "Words"} appears`;
    case "words_disappear":
      return `${quoted(rule.words) || "Words"} disappears`;
    case "new_item":
      return rule.words?.length ? `A new post with ${quoted(rule.words)}` : "A new post";
  }
  return "Any change";
}

const stepOf = (r: Rule) => r.stepPercent || 5;
const resetOf = (r: Rule) => r.resetPercent || 0.5;

/** "Each further 5% drop" (below) / "Each further 5% rise" (above); null for other rules. */
export function againLine(rule: Rule): string | null {
  if (rule.kind !== "below" && rule.kind !== "above") return null;
  const step = stepOf(rule);
  if (step >= 100) return "Not again until it starts over";
  return `Each further ${pctNumber(step)}% ${rule.kind === "below" ? "drop" : "rise"}`;
}

/** The "Tell me again" choices for a below/above rule, as stepPercent values. */
export function againOptions(rule: Rule): { value: number; label: string }[] {
  if (rule.kind !== "below" && rule.kind !== "above") return [];
  return [5, 10, 100].map((value) => ({ value, label: againLine({ ...rule, stepPercent: value }) ?? "" }));
}

/** "Once the price is 0.5% back above your line (₹25,125)"; null for other rules. */
export function resetLine(rule: Rule, watch: Pick<WatchView, "currency" | "summary"> | Pick<WatchInput, "currency">): string | null {
  if (rule.kind !== "below" && rule.kind !== "above") return null;
  const reset = resetOf(rule);
  const side = rule.kind === "below" ? "above" : "below";
  if (rule.threshold == null) return `Once the price is ${pctNumber(reset)}% back ${side} your line`;
  const cur = "summary" in watch ? watchCurrency(watch) : (watch.currency ?? "");
  const at = rule.kind === "below" ? rule.threshold * (1 + reset / 100) : rule.threshold * (1 - reset / 100);
  return `Once the price is ${pctNumber(reset)}% back ${side} your line (${formatMoney(Math.round(at * 100) / 100, cur)})`;
}

// ── The board ──

export type NeedsReason = "new_alert" | "broken" | "waiting_ok" | "stopped" | "needs_key";
export type BoardGroup = "needs" | "watching" | "paused";

const STRIKES = new Set<string>(STRIKE_CODES);
const NEW_ALERT_FOR = 48 * HOUR;

/** Why a bot sits in "Needs you", or null. */
export function needsReason(bot: BotView, now: Date): NeedsReason | null {
  if (bot.status === "paused") {
    if (bot.pauseReason === "mcp") return "waiting_ok";
    if (bot.pauseReason === "strikes") return "stopped";
    return null;
  }
  if (bot.health.code === "needs_key") return "needs_key";
  if (bot.strikes > 0 && STRIKES.has(bot.health.code)) return "broken";
  const a = bot.latestAlert;
  const at = ms(a?.createdAt);
  if (a && a.feedback === null && a.held !== "snoozed" && at !== null && now.getTime() - at < NEW_ALERT_FOR) {
    return "new_alert";
  }
  return null;
}

/** "needs", "watching" or "paused". */
export function boardGroup(bot: BotView, now: Date): BoardGroup {
  if (needsReason(bot, now)) return "needs";
  return bot.status === "paused" ? "paused" : "watching";
}

const NEEDS_RANK: Record<NeedsReason, number> = { new_alert: 0, broken: 1, needs_key: 2, waiting_ok: 3, stopped: 4 };

/** The "Needs you" bots in order: new alerts, broken, keys, waiting, stopped, then newest change. */
export function needsOrder(bots: BotView[], now: Date): BotView[] {
  return bots
    .map((bot) => ({ bot, reason: needsReason(bot, now) }))
    .filter((x): x is { bot: BotView; reason: NeedsReason } => x.reason !== null)
    .sort((a, b) => NEEDS_RANK[a.reason] - NEEDS_RANK[b.reason] || (ms(b.bot.updatedAt) ?? 0) - (ms(a.bot.updatedAt) ?? 0))
    .map((x) => x.bot);
}

/** How many bots need the person: the sidebar and tab badge. */
export function needsYouCount(bots: BotView[] | undefined, now: Date = new Date()): number {
  return (bots ?? []).filter((b) => needsReason(b, now) !== null).length;
}

/**
 * The board's three sections. Watching and Paused keep the newest bot first
 * by when it was made, so a check never moves a card.
 */
export function boardSections(bots: BotView[], now: Date): Record<BoardGroup, BotView[]> {
  const byMade = (a: BotView, b: BotView) => (ms(b.createdAt) ?? 0) - (ms(a.createdAt) ?? 0);
  return {
    needs: needsOrder(bots, now),
    watching: bots.filter((b) => boardGroup(b, now) === "watching").sort(byMade),
    paused: bots.filter((b) => boardGroup(b, now) === "paused").sort(byMade),
  };
}

/** The "Bots" order Previous/Next walk: Needs you, Watching, Paused. */
export function boardOrder(bots: BotView[], now: Date): string[] {
  const s = boardSections(bots, now);
  return [...s.needs, ...s.watching, ...s.paused].map((b) => b.id);
}

/** The watch a card speaks for: the failing one when the bot is broken, else the first. */
export function primaryWatch(bot: Pick<BotView, "watches" | "health">): WatchView | undefined {
  return bot.watches.find((w) => w.health.code === bot.health.code && STRIKES.has(w.health.code)) ?? bot.watches[0];
}

// ── Fixes ──

export type FixAction = "pick_part" | "edit_url" | "add_key" | "change_source" | "check_now" | "turn_on" | "resume";
export type FixButton = { action: FixAction | "edit"; label: string };

const FIX_LABELS: Record<FixAction, string> = {
  pick_part: "Pick the part again",
  edit_url: "Edit",
  add_key: "Add key",
  change_source: "Change source",
  check_now: "Check now",
  turn_on: "Turn on",
  resume: "Resume",
};

const isStopped = (bot: BotView) => bot.status === "paused" && bot.pauseReason === "strikes";

/** What fixes a bot that needs one. */
export function fixAction(bot: BotView): FixAction {
  if (bot.status === "paused" && bot.pauseReason === "mcp") return "turn_on";
  const w = primaryWatch(bot);
  const code = bot.health.code;
  let action: FixAction = "resume";
  switch (code) {
    case "needs_key":
      action = "add_key";
      break;
    case "cant_find":
    case "not_found":
    case "too_big":
    case "unsupported":
      action = w && isPartRead(w) ? "pick_part" : "edit_url";
      break;
    case "robots":
    case "captcha":
    case "forbidden":
    case "blocked":
    case "source_down":
      action = "change_source";
      break;
    case "offline":
    case "rate_limited":
    case "waiting":
    case "server_error":
      action = "check_now";
      break;
  }
  // A paused bot cannot be checked; resuming it runs a check.
  if (action === "check_now" && bot.status === "paused") return "resume";
  return action;
}

/**
 * The two buttons of a fix. Coldplay (stopped, not_found, selector): "Pick
 * the part again" + "Edit"; visa (broken, cant_find, selector): "Pick the part
 * again" + "Check now".
 */
export function fixButtons(bot: BotView): { primary: FixButton; secondary: FixButton } {
  const action = fixAction(bot);
  const primary: FixButton = { action, label: FIX_LABELS[action] };
  const notFoundPick = action === "pick_part" && bot.health.code === "not_found";
  const wantsEdit = bot.status === "paused" || notFoundPick || action === "check_now";
  let secondary: FixButton = wantsEdit ? { action: "edit", label: "Edit" } : { action: "check_now", label: "Check now" };
  if (secondary.action === "edit" && action === "edit_url") secondary = { action: "resume", label: "Resume" };
  return { primary, secondary };
}

/** Per strike code: why it may have happened, and what to do once the bot paused itself. */
export const STRIKE_COPY: Record<StrikeCode, { why: string; stopped: string }> = {
  cant_find: {
    why: "The site may have changed its layout.",
    stopped: "The site may have changed its layout. Pick the part again, then resume the bot.",
  },
  not_found: {
    why: "The page may have moved or been taken down.",
    stopped: "The page may have moved. Point the watch at the new page, then pick the part again.",
  },
  too_big: {
    why: "The page grew past what Timely reads.",
    stopped: "The page grew past what Timely reads. Point the watch at a smaller page or one part of it.",
  },
  unsupported: {
    why: "The address no longer gives a page or feed Timely can read.",
    stopped: "The address no longer gives a page or feed Timely can read. Point the watch at another address.",
  },
  captcha: {
    why: "The site asked for a robot check, which Timely never answers.",
    stopped: "The site keeps asking for a robot check. Try another source for the same thing.",
  },
  forbidden: {
    why: "The site turned the request away.",
    stopped: "The site keeps turning the request away. Try another source for the same thing.",
  },
  blocked: {
    why: "Timely only reads public web addresses.",
    stopped: "Timely only reads public web addresses. Point the watch at a public one.",
  },
  server_error: {
    why: "The site had trouble answering. It may pass on its own.",
    stopped: "The site had trouble answering 5 times in a row. Resume the bot to try again.",
  },
  source_down: {
    why: "The price source isn’t answering.",
    stopped: "The price source stopped answering. Resume the bot to try again, or pick another source.",
  },
  needs_key: {
    why: "Add your free Finnhub key in Settings › Agent.",
    stopped: "Add your free Finnhub key in Settings › Agent, then resume the bot.",
  },
};

/** The copy of a fix: eyebrow, title and the meta line under it. */
export function fixCopy(bot: BotView): { eyebrow: string; title: string; meta: string } {
  const max = BOT_LIMITS.maxStrikes;
  const stopped = isStopped(bot);
  const code = bot.health.code as StrikeCode;
  const copy = STRIKE_COPY[code];
  const w = primaryWatch(bot);
  let title = bot.health.line;
  let meta = "";
  if (stopped) {
    if (code === "not_found" && w && w.kind !== "price" && bot.health.line === "The page is gone") {
      title = `The page answered “Not found” ${bot.strikes || max} times in a row`;
      meta =
        w.read && isPartRead(w)
          ? copy.stopped
          : "The page may have moved. Point the watch at the new page, then resume the bot.";
    } else if (code === "cant_find" && !(w && isPartRead(w))) {
      meta = "The page changed what it shows. Edit the watch, then resume the bot.";
    } else {
      meta = copy?.stopped ?? "Fix the watch, then resume the bot.";
    }
  } else {
    meta = `${bot.strikes} of ${max} strikes.${copy ? ` ${copy.why}` : ""} At ${max} the bot pauses itself.`;
  }
  return { eyebrow: stopped ? "Paused itself" : "Needs a fix", title, meta };
}

// ── Card lines ──

const firstRule = (w: WatchView | undefined, kinds: RuleKind[]) => w?.rules.find((r) => kinds.includes(r.kind));

const MAX_STRIKE_DELAY_MIN = 24 * 60;

/** The wait after a failed check, as the API's StrikeDelay (schedule.go). */
function strikeDelayMinutes(interval: number, strikes: number): number {
  let d = interval;
  for (let i = 1; i < strikes && d < MAX_STRIKE_DELAY_MIN; i++) d *= 2;
  return Math.min(d, MAX_STRIKE_DELAY_MIN);
}

/**
 * When the failing run of a bot that paused itself began: its last check
 * less the backed-off waits between its strikes, never before its last good
 * read. The API does not send this time, so it is worked out from the strike
 * count and interval; null when the bot was never checked.
 */
export function firstStrikeAt(bot: Pick<BotView, "lastCheckAt" | "lastOkAt" | "strikes" | "intervalMinutes" | "watches">): string | null {
  const last = ms(bot.lastCheckAt);
  if (last == null) return bot.lastOkAt;
  const interval = bot.intervalMinutes || defaultMinutes(bot.watches);
  let back = 0;
  for (let k = 1; k < bot.strikes; k++) back += strikeDelayMinutes(interval, k);
  const start = last - back * 60_000;
  const ok = ms(bot.lastOkAt);
  return new Date(ok != null && ok > start ? ok : start).toISOString();
}

/**
 * The muted line above a text value: "Last good read, 3 h ago" (broken),
 * "Not checked yet", "Since Nov 5, 21:40" (paused itself, from the first
 * strike of the run), "Last post seen, Nov 1" (a feed), else null.
 */
export function captionLine(bot: BotView, now: Date, tz?: string): string | null {
  const reason = needsReason(bot, now);
  if (reason === "stopped") {
    const since = firstStrikeAt(bot);
    return since ? `Since ${dateTime(since, tz)}` : "Not checked yet";
  }
  if (reason === "broken") return bot.lastOkAt ? `Last good read, ${agoLabel(bot.lastOkAt, now, tz)}` : "No good read yet";
  if (!bot.lastCheckAt) return "Not checked yet";
  const w = primaryWatch(bot);
  if (w?.kind === "feed" && w.latestItem && bot.itemsToday === 0) {
    const seen = w.latestItem.publishedAt ?? w.lastChangedAt;
    return seen ? `Last post seen, ${shortDate(seen, tz)}` : "Last post seen";
  }
  return null;
}

export type CardValue = {
  kind: "number" | "text";
  text: string;
  /** A small word after a number: "new today". */
  unit?: string;
  tone: "default" | "destructive";
};

/** A card's big value: a number (24/600) or a text (15/500). */
export function cardValue(bot: BotView): CardValue {
  const w = primaryWatch(bot);
  if (bot.status === "paused" && bot.pauseReason === "mcp" && !bot.lastCheckAt) return { kind: "text", text: "Starts paused", tone: "default" };
  if (
    isStopped(bot) &&
    bot.health.code === "not_found" &&
    w?.kind !== "price" &&
    bot.health.line === "The page is gone"
  ) {
    return { kind: "text", text: "The page is gone", tone: "destructive" };
  }
  if (!w) return { kind: "text", text: "Nothing to watch", tone: "default" };
  if (isPriceReading(w) && w.value != null) {
    return { kind: "number", text: formatMoney(w.value, watchCurrency(w)), tone: "default" };
  }
  if (w.kind === "feed") {
    if (bot.itemsToday > 0) return { kind: "number", text: String(bot.itemsToday), unit: "new today", tone: "default" };
    const title = w.latestItem?.title || w.excerpt;
    return { kind: "text", text: title ? `“${title}”` : "No posts yet", tone: "default" };
  }
  if (w.excerpt) {
    const words = firstRule(w, ["words_appear", "words_disappear"]);
    return { kind: "text", text: words ? `“${w.excerpt}”` : w.excerpt, tone: "default" };
  }
  if (w.summary) return { kind: "text", text: w.summary, tone: "default" };
  return { kind: "text", text: bot.lastCheckAt ? "Nothing read yet" : "Waiting for its first check", tone: "default" };
}

export const valueKind = (bot: BotView): CardValue["kind"] => cardValue(bot).kind;
export const valueText = (bot: BotView): string => cardValue(bot).text;

/**
 * The line under a card's value: "₹2,499 above your line", "+2.4% today ·
 * $1,588 to go", "3 new today", "Tells you when “Add to cart” appears".
 */
export function valueLine(bot: BotView): string | null {
  const w = primaryWatch(bot);
  if (!w) return null;
  if (w.kind === "feed") return bot.itemsToday > 0 ? `${bot.itemsToday} new today` : null;
  if (isPriceReading(w)) {
    const cur = watchCurrency(w);
    const day = w.kind === "price" && w.dayChangePct != null ? `${signedPct(w.dayChangePct)} today` : null;
    const r = firstRule(w, ["below", "above", "move_pct"]);
    if (w.value == null) return r ? ruleLine(r, w) : null;
    if (r && (r.kind === "below" || r.kind === "above") && r.threshold != null) {
      const gap = formatMoney(Math.abs(w.value - r.threshold), cur);
      let line: string;
      if (r.kind === "below") line = w.value > r.threshold ? `${gap} above your line` : `${gap} under your line`;
      else line = w.value < r.threshold ? `${gap} to go` : `${gap} over your line`;
      return day ? `${day} · ${line}` : line;
    }
    if (r?.kind === "move_pct" && r.percent != null) {
      const band = r.direction === "up" ? `+${pctNumber(r.percent)}` : r.direction === "down" ? `−${pctNumber(r.percent)}` : `±${pctNumber(r.percent)}`;
      return day ? `${day} · line ${band}%` : `Line ${band}%`;
    }
    return day;
  }
  const words = firstRule(w, ["words_appear", "words_disappear"]);
  if (words) return `Tells you when ${ruleLine(words, w)}`;
  return "Tells you when it changes";
}

/** The compact card's value and the change under it: "₹27,499" / "₹2,499 above". */
export function miniValue(bot: BotView, now: Date): { text: string; change: string | null } | null {
  const reason = needsReason(bot, now);
  if (reason === "broken" || reason === "stopped" || reason === "waiting_ok") return null;
  const w = primaryWatch(bot);
  if (!w || !bot.lastCheckAt) return null;
  const v = cardValue(bot);
  if (isPriceReading(w)) {
    if (w.value == null) return null;
    const cur = watchCurrency(w);
    if (w.kind === "price" && w.dayChangePct != null) return { text: v.text, change: signedPct(w.dayChangePct) };
    const r = firstRule(w, ["below", "above"]);
    if (r?.threshold != null) {
      const gap = formatMoney(Math.abs(w.value - r.threshold), cur);
      const above = w.value > r.threshold;
      return { text: v.text, change: r.kind === "below" ? (above ? `${gap} above` : `${gap} under`) : above ? `${gap} over` : `${gap} to go` };
    }
    return { text: v.text, change: null };
  }
  if (w.kind === "feed") return bot.itemsToday > 0 ? { text: String(bot.itemsToday), change: "new today" } : null;
  const text = v.text.replace(/^“|”$/g, "");
  const changed = ms(w.lastChangedAt);
  const days = changed === null ? 0 : Math.floor((now.getTime() - changed) / DAY);
  return { text, change: days >= 1 ? `same for ${plural(days, "day")}` : null };
}

/** The card's sub line: "amazon.in · Sony WH-1000XM6 Wireless · every 6 h", "2 feeds · every 30 min". */
export function cardSub(bot: Pick<BotView, "watches" | "intervalMinutes">): string {
  const every = everyLabel(bot.intervalMinutes || defaultMinutes(bot.watches));
  const ws = bot.watches;
  if (ws.length === 0) return "No watch yet";
  if (ws.length === 1) return `${watchTitle(ws[0])} · ${every}`;
  const kinds = new Set(ws.map((w) => w.kind));
  const noun = kinds.size > 1 ? "watches" : ws[0].kind === "feed" ? "feeds" : ws[0].kind === "price" ? "prices" : "pages";
  return `${ws.length} ${noun} · ${every}`;
}

/**
 * What an alert found, for a one-line sub: a feed alert's first item ("RTX
 * 4070 Super Founders Edition, $389"), a price alert's price ("₹24,990"),
 * else its title without the bot's name ("“Add to cart” appeared").
 */
export function alertFound(alert: Pick<AlertBrief, "title" | "body">, botName: string): string {
  const prefix = `${botName}: `;
  const what = alert.title.startsWith(prefix) ? alert.title.slice(prefix.length) : alert.title;
  // The API words a body as describe() in alerts.go does.
  const body = alert.body.replace(/ \(\+\d+ more\)$/, "");
  if (/^\d+ new items?$/.test(what) && body) {
    const item = body.replace(/ and \d+ more$/, "");
    // "… at Best Buy": drop a trailing store name, a few words with no digits.
    const at = item.lastIndexOf(" at ");
    const store = at > 0 ? item.slice(at + 4) : "";
    return store && !/\d/.test(store) && store.split(" ").length <= 3 ? item.slice(0, at) : item;
  }
  if (/^(?:below|above) |^(?:up|down) [\d.]+%$|^price changed$/.test(what)) {
    const price = /^(?:Now|\S+ now) (\S+)/.exec(body);
    if (price) return price[1];
  }
  return what;
}

/**
 * The compact card's sub line: the bot's state when it needs the person
 * ("New alert · RTX 4070 Super Founders Edition, $389", "Made by Claude Code
 * · 40 min ago", "bookmyshow.com · the page is gone"), else its watch and
 * interval.
 */
export function miniSub(bot: BotView, now: Date, tz?: string): string {
  const reason = needsReason(bot, now);
  if (reason === "new_alert" && bot.latestAlert) return `New alert · ${alertFound(bot.latestAlert, bot.name)}`;
  if (reason === "waiting_ok") return `Made by ${bot.originClient || "an outside app"} · ${agoLabel(bot.createdAt, now, tz)}`;
  if (reason === "stopped") {
    const w = primaryWatch(bot);
    const line = bot.health.line;
    const site = w ? siteOf(w) || watchTitle(w) : "";
    const what = line.charAt(0).toLowerCase() + line.slice(1);
    return site ? `${site} · ${what}` : line;
  }
  return cardSub(bot);
}

/** The origin chip: "Made in chat, Oct 9", "From Claude Code", or null for the app. */
export function originLine(bot: Pick<BotView, "origin" | "originClient" | "createdAt">, tz?: string): string | null {
  if (bot.origin === "chat") return `Made in chat, ${shortDate(bot.createdAt, tz)}`;
  if (bot.origin === "mcp") return `From ${bot.originClient || "an outside app"}`;
  return null;
}

const isSnoozed = (bot: Pick<BotView, "snoozedUntil">, now: Date) => (ms(bot.snoozedUntil) ?? 0) > now.getTime();

/**
 * The right side of a card's footer: "Next 00:12", "Made 40 min ago",
 * "Nov 5, 22:40" (when it paused itself), "No alerts yet", "No change in 6
 * days", "2 of 3 alerts today". Null on a bot the person paused, whose card
 * shows Resume there.
 */
export function footerRight(bot: BotView, now: Date, tz?: string): string | null {
  const reason = needsReason(bot, now);
  if (reason === "waiting_ok") return `Made ${agoLabel(bot.createdAt, now, tz)}`;
  if (reason === "stopped") return bot.lastCheckAt ? dateTime(bot.lastCheckAt, tz) : null;
  if (bot.status === "paused") return null;
  const next = bot.nextCheckAt ? `Next ${clockLabel(bot.nextCheckAt, now, tz)}` : null;
  if (reason === "broken" || reason === "needs_key" || isSnoozed(bot, now)) return next;
  if (bot.alertsToday > 0) return `${bot.alertsToday} of ${BOT_LIMITS.alertsPerDay} alerts today`;
  const w = primaryWatch(bot);
  if (w && !isPriceReading(w) && w.kind !== "feed") {
    const changed = ms(w.lastChangedAt);
    const days = changed === null ? 0 : Math.floor((now.getTime() - changed) / DAY);
    if (days >= 1) return `No change in ${plural(days, "day")}`;
  }
  if (!bot.latestAlert && bot.lastCheckAt) return "No alerts yet";
  return next;
}

export type HealthTone = "ok" | "warn" | "bad" | "off" | "primary";

const STRIKE_WORDS: Record<StrikeCode, string> = {
  cant_find: "Can’t read the page",
  not_found: "Page not found",
  too_big: "Page too large",
  unsupported: "Can’t read this address",
  captcha: "Blocked by a robot check",
  forbidden: "Refused by the site",
  blocked: "Not a public address",
  server_error: "The site had an error",
  source_down: "Price source down",
  needs_key: "Needs your Finnhub key",
};

/** The health line under a card: a tone dot, a bold word and a time. */
export function healthLine(bot: BotView, now: Date, tz?: string): { tone: HealthTone; word: string; time: string | null } {
  const reason = needsReason(bot, now);
  const ago = bot.lastCheckAt ? agoLabel(bot.lastCheckAt, now, tz) : null;
  if (bot.health.code === "preview") return { tone: "primary", word: bot.health.line || "Read once in chat", time: null };
  if (reason === "waiting_ok") return { tone: "warn", word: "Waiting for your OK", time: null };
  if (reason === "stopped") return { tone: "bad", word: `Paused after ${bot.strikes || BOT_LIMITS.maxStrikes} strikes`, time: null };
  if (bot.status === "paused") return { tone: "off", word: "Paused by you", time: shortDate(bot.updatedAt, tz) };
  if (isSnoozed(bot, now) && bot.snoozedUntil) {
    return { tone: "off", word: "Snoozed", time: `until ${clockLabel(bot.snoozedUntil, now, tz)}` };
  }
  if (bot.checking) return { tone: "ok", word: "Checking…", time: null };
  const code = bot.health.code;
  if (STRIKES.has(code)) {
    let word = STRIKE_WORDS[code as StrikeCode];
    const w = primaryWatch(bot);
    if (code === "cant_find" && w?.kind === "feed") word = "Can’t read the feed";
    else if (code === "cant_find" && w && isPriceReading(w)) word = "Can’t find the price";
    return { tone: "bad", word, time: ago };
  }
  switch (code) {
    case "offline":
      return { tone: "warn", word: "Offline", time: ago };
    case "rate_limited":
      return { tone: "warn", word: "The site asked to wait", time: ago };
    case "waiting":
      return { tone: "warn", word: "Waiting its turn", time: ago };
    case "robots":
      return { tone: "warn", word: "The site asks not to be read", time: ago };
    case "new":
      return { tone: "off", word: "Not checked yet", time: null };
  }
  if (!bot.lastCheckAt) return { tone: "off", word: "Not checked yet", time: null };
  return { tone: "ok", word: "Working", time: ago };
}

/** The mini card's health text: "Can’t read the page · 3 of 5" when broken. */
export function miniHealth(bot: BotView, now: Date, tz?: string): string {
  const h = healthLine(bot, now, tz);
  if (needsReason(bot, now) === "new_alert") return "Was it worth it?";
  if (needsReason(bot, now) === "broken") return `${h.word} · ${bot.strikes} of ${BOT_LIMITS.maxStrikes}`;
  return h.time ? `${h.word} · ${h.time}` : h.word;
}

/** The header line: "312 checks today · 2 alerts · next check in 4 min" (phone: "9 bots · 2 alerts today · …"). */
export function summaryLine(list: BotsList, now: Date, variant: "desktop" | "phone" = "desktop"): string {
  const { checksToday, alertsToday, nextCheckAt } = list.summary;
  const alerts = alertsToday === 0 ? "no alerts" : plural(alertsToday, "alert");
  const parts =
    variant === "phone"
      ? [plural(list.bots.length, "bot"), `${alerts} today`]
      : [plural(checksToday, "check") + " today", alerts];
  if (nextCheckAt) parts.push(`next check ${inLabel(nextCheckAt, now)}`);
  return parts.join(" · ");
}

// ── The check strip ──

export const STRIP_LABELS: Record<StripMark, string> = {
  n: "No change",
  c: "Changed",
  f: "Told you",
  x: "Failed (strike)",
  o: "Offline (no strike)",
};

/** The legend under a big strip, in a fixed order. */
export function stripLegend(): { mark: StripMark; label: string }[] {
  return (["n", "c", "f", "x", "o"] as const).map((mark) => ({ mark, label: STRIP_LABELS[mark] }));
}

/** The marks of a strip, the newest `count` (all by default), unknown letters dropped. */
export function stripMarks(strip: string, count?: number): StripMark[] {
  const marks = [...(strip ?? "")].filter((c): c is StripMark => c in STRIP_LABELS);
  return count != null && marks.length > count ? marks.slice(marks.length - count) : marks;
}

/** A strip read aloud: "Last 28 checks: 25 no change, 2 told you, 1 failed". */
export function stripSummary(strip: string): string {
  const marks = stripMarks(strip);
  if (marks.length === 0) return "No checks yet";
  const words: Record<StripMark, string> = { n: "no change", c: "changed", f: "told you", x: "failed", o: "offline" };
  const counts = (["n", "c", "f", "x", "o"] as const)
    .map((m) => [m, marks.filter((x) => x === m).length] as const)
    .filter(([, n]) => n > 0)
    .map(([m, n]) => `${n} ${words[m]}`);
  return `Last ${plural(marks.length, "check")}: ${counts.join(", ")}`;
}

// ── Grid ──

/** The board's column count for its content width. */
export function boardColumns(width: number): number {
  if (width < 560) return 1;
  if (width < 1040) return 2;
  if (width < 1600) return 4;
  return 6;
}

/** How many columns a wide (Needs you) card spans. */
export function wideSpan(cols: number): number {
  if (cols >= 6) return 3;
  return Math.min(2, cols);
}

export type GridItem = "card" | "wide" | "add";

/**
 * Each item's column span, so that no row of a section ends in a hole: an
 * item that does not fit closes its row by stretching the one before it, the
 * last item stretches to the end of its row, and the add tile takes the rest
 * of its row (a full row when its row is otherwise full).
 */
export function fillSpans(items: GridItem[], cols: number): number[] {
  const spans: number[] = [];
  let pos = 0;
  items.forEach((item, i) => {
    let span = item === "wide" ? wideSpan(cols) : item === "add" ? cols - pos : 1;
    if (span <= 0) span = cols;
    span = Math.min(span, cols);
    if (pos + span > cols) {
      if (spans.length) spans[spans.length - 1] += cols - pos;
      pos = 0;
      if (item === "add") span = cols;
    }
    if (i === items.length - 1) span = cols - pos;
    spans.push(span);
    pos = (pos + span) % cols;
  });
  return spans;
}

// ── Check now and snooze ──

export type RunNowState = {
  state: "ready" | "cooldown" | "checking" | "hidden";
  label: string;
  /** Why it waits: "Shop prices are checked every 6 hours at most". */
  hint: string;
};

/** The Check now button: ready, held back by the floor until a time, running, or hidden while paused. */
export function runNowState(bot: BotView, now: Date, tz?: string): RunNowState {
  const hint = bot.floorLine;
  if (bot.status === "paused") return { state: "hidden", label: "Check now", hint };
  if (bot.checking) return { state: "checking", label: "Checking…", hint };
  const at = ms(bot.runNowAt);
  if (at !== null && at > now.getTime() && bot.runNowAt) {
    return { state: "cooldown", label: `Checks at ${clockLabel(bot.runNowAt, now, tz)}`, hint };
  }
  return { state: "ready", label: "Check now", hint };
}

export type SnoozePreset = { for: "day" | "week"; until: string; label: string; long: string };

/**
 * "For a day" and "For a week", with when each ends as the API computes it
 * (now + 24 h, now + 7 days), in the person's time zone: "until Sun 14:30",
 * "until Sat 14 Nov"; `long` is "Sat 14 Nov, 14:30".
 */
export function snoozePresets(now: Date, tz?: string): SnoozePreset[] {
  const make = (kind: "day" | "week", span: number): SnoozePreset => {
    const t = now.getTime() + span;
    const p = zoneParts(t, tz);
    return {
      for: kind,
      until: new Date(t).toISOString(),
      label: kind === "day" ? `until ${p.weekday} ${p.time}` : `until ${p.weekday} ${p.day} ${p.month}`,
      long: `${p.weekday} ${p.day} ${p.month}, ${p.time}`,
    };
  };
  return [make("day", DAY), make("week", 7 * DAY)];
}

/** The latest time a snooze may end. */
export function maxSnoozeUntil(now: Date): Date {
  return new Date(now.getTime() + BOT_LIMITS.maxSnoozeDays * DAY);
}

/** "Snoozed until Mon 09:00", or null when not snoozed. */
export function snoozeLabel(bot: Pick<BotView, "snoozedUntil">, now: Date, tz?: string): string | null {
  if (!isSnoozed(bot, now) || !bot.snoozedUntil) return null;
  return `Snoozed until ${clockLabel(bot.snoozedUntil, now, tz)}`;
}

// ── Rail ──

/** A price watch's daily closes as [unixSeconds, value], oldest first. */
export function priceSeries(days: PriceDay[] | null | undefined, watchId: string): [number, number][] {
  return (days ?? [])
    .filter((d) => d.watchId === watchId && d.close != null)
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((d) => [Date.parse(`${d.day}T00:00:00Z`) / 1000, d.close as number]);
}

/** "₹24,990 / 30-day low, Oct 29" and "−8.3% / since Oct 9" from a watch's days. */
export function priceStats(
  days: PriceDay[] | null | undefined,
  watchId: string,
): { low: number; lowDay: string; changePct: number | null; since: string } | null {
  const own = (days ?? []).filter((d) => d.watchId === watchId).sort((a, b) => a.day.localeCompare(b.day));
  const closes = own.filter((d) => d.close != null);
  if (closes.length === 0) return null;
  let low = Infinity;
  let lowDay = "";
  for (const d of own) {
    const v = d.low ?? d.close;
    if (v != null && v < low) {
      low = v;
      lowDay = d.day;
    }
  }
  const first = closes[0].close as number;
  const last = closes[closes.length - 1].close as number;
  return {
    low,
    lowDay: shortDate(`${lowDay}T12:00:00Z`, "UTC"),
    changePct: first !== 0 && closes.length > 1 ? ((last - first) / Math.abs(first)) * 100 : null,
    since: shortDate(`${closes[0].day}T12:00:00Z`, "UTC"),
  };
}

/** The meta of an alert in Recent alerts: "Oct 29, 14:02 · down from ₹27,490". */
export function alertMeta(alert: Pick<AlertView, "createdAt" | "figures">, tz?: string): string {
  const at = dateTime(alert.createdAt, tz);
  const f = alert.figures;
  if (f?.was != null && f.price != null) {
    return `${at} · ${f.price < f.was ? "down" : "up"} from ${formatMoney(f.was, f.currency ?? "")}`;
  }
  if (f?.items) return `${at} · ${plural(f.items, "new item")}`;
  return at;
}

/** "Oct 30, 08:12 · back above ₹25,125, so it can tell you next time". */
export function rearmMeta(rearm: Rearm, rule: Rule | undefined, tz?: string): string {
  const side = rule?.kind === "above" ? "below" : "above";
  return `${dateTime(rearm.at, tz)} · back ${side} ${formatMoney(rearm.value, rearm.currency)}, so it can tell you next time`;
}

// ── Starters ──

export type StarterId = "price_drop" | "page_changed" | "stock_move" | "new_in_feed" | "morning_brief";

export type Starter = {
  id: StarterId;
  /** A lucide icon name. */
  icon: "trending-down" | "globe" | "chart-candlestick" | "rss" | "sunrise";
  name: string;
  /** The starter card's sub line. */
  sub: string;
  /** The add tile's sub line. */
  tileSub: string;
  /** The words in quotes on the card. */
  quote: string;
  rows: [string, string][];
  /** What "Describe in chat" puts in the composer. */
  chatText: string | null;
  /** What Use opens the editor with; null when it cannot be made yet. */
  draft: BotInput | null;
  needsKey?: "finnhub";
  later?: true;
};

const draftOfStarter = (name: string, interval: number, watch: WatchInput): BotInput => ({
  name,
  description: "",
  intervalMinutes: interval,
  watches: [watch],
});

export const STARTERS: Starter[] = [
  {
    id: "price_drop",
    icon: "trending-down",
    name: "Price drop",
    sub: "Page price · every 6 h",
    tileSub: "A shop page’s price",
    quote: "Tell me when this product drops under a price",
    rows: [
      ["Watches", "A shop page’s price"],
      ["Tells me when", "Below your price"],
      ["You fill in", "Link, price"],
    ],
    chatText: "Tell me when the price on this page drops under ",
    draft: draftOfStarter("", 360, { kind: "page", url: "", read: "product_price", rules: [{ kind: "below" }] }),
  },
  {
    id: "page_changed",
    icon: "globe",
    name: "Page changed",
    sub: "One part of a page · every 30 min",
    tileSub: "One part of a page",
    quote: "Tell me when this part of a page changes",
    rows: [
      ["Watches", "One part of a page"],
      ["Tells me when", "It changes"],
      ["You fill in", "Link, the part"],
    ],
    chatText: "Tell me when this part of a page changes: ",
    draft: draftOfStarter("", 30, { kind: "page", url: "", read: "selector", selector: "", rules: [{ kind: "any_change" }] }),
  },
  {
    id: "stock_move",
    icon: "chart-candlestick",
    name: "Stock move",
    sub: "Stock price · every 15 min",
    tileSub: "Moves 5% in a day",
    quote: "Tell me if NVDA moves more than 5% in a day",
    rows: [
      ["Watches", "Finnhub (free key)"],
      ["Tells me when", "Moves 5% either way"],
      ["You fill in", "Symbol"],
    ],
    chatText: "Tell me if NVDA moves more than 5% in a day",
    draft: draftOfStarter("NVDA moves 5% in a day", 0, {
      kind: "price",
      source: "stock",
      symbol: "NVDA",
      rules: [{ kind: "move_pct", percent: 5, direction: "any" }],
    }),
    needsKey: "finnhub",
  },
  {
    id: "new_in_feed",
    icon: "rss",
    name: "New in a feed",
    sub: "Feed · every 30 min",
    tileSub: "RSS or Atom posts",
    quote: "Tell me about new posts in this feed",
    rows: [
      ["Watches", "An RSS or Atom feed"],
      ["Tells me when", "A new post appears"],
      ["You fill in", "Feed link"],
    ],
    chatText: "Tell me about new posts in this feed: ",
    draft: draftOfStarter("", 0, { kind: "feed", url: "", rules: [{ kind: "new_item" }] }),
  },
  {
    id: "morning_brief",
    icon: "sunrise",
    name: "Morning brief",
    sub: "Brief · daily at 08:00",
    tileSub: "Sums up your bots",
    quote: "Each morning, sum up what my other bots found",
    rows: [
      ["Gathers", "Your other bots’ findings"],
      ["Tells me when", "Every morning at 08:00"],
      ["You fill in", "Which bots, the time"],
    ],
    chatText: null,
    draft: null,
    later: true,
  },
];

export function starterById(id: string | null | undefined): Starter | undefined {
  return STARTERS.find((s) => s.id === id);
}

// ── Drafts ──

/** A blank editor: no watch yet, alerts from the person's defaults. */
export function emptyDraft(defaults: BotSettings = DEFAULT_BOT_SETTINGS): BotInput {
  return { name: "", description: "", intervalMinutes: 0, ...defaults, watches: [] };
}

/** A starter's draft with the person's alert defaults, copied so edits never touch STARTERS. */
export function starterDraft(starter: Starter, defaults: BotSettings = DEFAULT_BOT_SETTINGS): BotInput | null {
  if (!starter.draft) return null;
  return { ...(JSON.parse(JSON.stringify(starter.draft)) as BotInput), ...defaults };
}

const trimmed = (s: string | undefined) => (s ?? "").trim();

const isWebAddress = (url: string) => {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname;
  } catch {
    return false;
  }
};

const fieldsOf = (r: Rule): Rule => {
  const out: Rule = { kind: r.kind };
  if (r.id) out.id = r.id;
  if (r.threshold != null) out.threshold = r.threshold;
  if (r.percent != null) out.percent = r.percent;
  if (r.direction) out.direction = r.direction;
  if (r.kind === "below" || r.kind === "above") {
    out.stepPercent = r.stepPercent || 5;
    out.resetPercent = r.resetPercent || 0.5;
  }
  const words = (r.words ?? []).map((w) => w.trim()).filter(Boolean);
  if (words.length) out.words = words;
  return out;
};

/** A watch ready to send: trimmed, with only the fields its kind takes. */
export function cleanWatchInput(w: WatchInput): WatchInput {
  const out: WatchInput = { kind: w.kind };
  if (w.id) out.id = w.id;
  if (w.kind === "price") {
    out.source = trimmed(w.source) || "stock";
    out.symbol = trimmed(w.symbol).toUpperCase();
    if (trimmed(w.currency)) out.currency = trimmed(w.currency).toUpperCase();
  } else {
    out.url = trimmed(w.url);
    if (w.kind === "page") {
      out.read = w.read ?? "text";
      if (isPartRead(out)) out.selector = trimmed(w.selector);
    }
  }
  if (w.rules) out.rules = w.rules.map(fieldsOf);
  return out;
}

/**
 * Why Create (or Save) is disabled: each reason a sentence for the person,
 * in the API's words where it has them. Empty when the draft can be sent.
 * `hasKey` tells whether a keyed price source has a saved key.
 */
export function draftErrors(draft: BotInput, hasKey?: (source: string) => boolean): string[] {
  const out: string[] = [];
  const name = draft.name.replace(/\s+/g, " ").trim();
  if (!name) out.push("Give the bot a name");
  else if ([...name].length > BOT_LIMITS.maxNameLen) out.push(`Keep the bot's name under ${BOT_LIMITS.maxNameLen} characters`);
  if ([...draft.description.trim()].length > BOT_LIMITS.maxDescriptionLen) {
    out.push(`Keep the description under ${BOT_LIMITS.maxDescriptionLen} characters`);
  }
  const ws = draft.watches;
  if (ws.length === 0) out.push("Give the bot something to watch: a page, a feed or a price");
  if (ws.length > BOT_LIMITS.maxWatches) out.push(`A bot can watch up to ${BOT_LIMITS.maxWatches} things`);
  ws.forEach((w, i) => {
    const name = ws.length > 1 ? `Watch ${i + 1}: ` : "";
    const add = (m: string) => out.push(name + m);
    if (w.kind === "price") {
      if (!trimmed(w.symbol)) add("Add a symbol, like NVDA");
      const source = trimmed(w.source) || "stock";
      if ((source === "stock" || source === "finnhub") && hasKey && !hasKey("finnhub")) {
        add("Stock prices need your free Finnhub key");
      }
    } else {
      const url = trimmed(w.url);
      if (!url) add(w.kind === "feed" ? "Add the feed’s link" : "Add the page’s link");
      else if (!isWebAddress(url)) add("Use a full web address, like https://example.com");
      if (w.kind === "page" && isPartRead(w) && !trimmed(w.selector)) add("Pick the part of the page to read");
    }
    const rules = w.rules ?? [];
    if (rules.length > BOT_LIMITS.maxRulesPerWatch) add(`A watch can have up to ${BOT_LIMITS.maxRulesPerWatch} rules`);
    const fits = rulesFor(w);
    for (const r of rules) {
      if (!fits.includes(r.kind)) add(`“${RULE_LABELS[r.kind]}” does not fit this watch`);
      else if ((r.kind === "below" || r.kind === "above") && !(r.threshold != null && r.threshold > 0)) add("Give the price to watch for");
      else if (r.kind === "move_pct" && !(r.percent != null && r.percent > 0 && r.percent <= 1000)) add("Give the percent it should move");
      else if ((r.kind === "words_appear" || r.kind === "words_disappear") && !(r.words ?? []).some((x) => x.trim())) {
        add("Give the words to look for");
      }
    }
  });
  const every = draft.intervalMinutes;
  if (every && ws.length) {
    if (every < floorMinutes(ws)) out.push(floorLine(ws));
    else if (every > BOT_LIMITS.maxEveryMinutes) out.push(`Check at least once a week (${BOT_LIMITS.maxEveryMinutes} minutes)`);
  }
  return out;
}

/** A draft ready for `POST /bots`. */
export function toInput(draft: BotInput): BotInput {
  const out: BotInput = {
    name: draft.name.replace(/\s+/g, " ").trim(),
    description: draft.description.trim(),
    intervalMinutes: draft.intervalMinutes || 0,
    watches: draft.watches.map(cleanWatchInput),
  };
  if (draft.judgeMode) out.judgeMode = draft.judgeMode;
  for (const k of ["urgent", "desktop", "phone"] as const) if (draft[k] !== undefined) out[k] = draft[k];
  return out;
}

/** A saved watch as an editable input. */
export function watchInputOf(w: WatchView): WatchInput {
  const out: WatchInput = { id: w.id, kind: w.kind, rules: w.rules.map(fieldsOf) };
  if (w.kind === "price") {
    out.source = w.source;
    out.symbol = w.symbol;
    if (w.currency) out.currency = w.currency;
  } else {
    out.url = w.url;
    if (w.kind === "page") {
      out.read = (w.read || "text") as ReadMode;
      if (isPartRead(out)) out.selector = w.selector;
    }
  }
  return out;
}

/** A saved bot as an editable draft. */
export function draftOf(view: BotView): BotInput {
  return {
    name: view.name,
    description: view.description,
    intervalMinutes: view.intervalMinutes,
    judgeMode: view.judgeMode,
    urgent: view.urgent,
    desktop: view.desktop,
    phone: view.phone,
    watches: view.watches.map(watchInputOf),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The edit that turns a saved bot into the draft: only what changed ({} when nothing did). */
export function toPatch(view: BotView, draft: BotInput): BotPatch {
  const next = toInput(draft);
  const patch: BotPatch = {};
  if (next.name !== view.name) patch.name = next.name;
  if (next.description !== view.description) patch.description = next.description;
  if (next.intervalMinutes && next.intervalMinutes !== view.intervalMinutes) patch.intervalMinutes = next.intervalMinutes;
  for (const k of ["urgent", "desktop", "phone"] as const) {
    if (next[k] !== undefined && next[k] !== view[k]) patch[k] = next[k];
  }
  const saved = view.watches.map((w) => cleanWatchInput(watchInputOf(w)));
  if (!same(saved, next.watches)) patch.watches = next.watches;
  return patch;
}

// ── Chat ──

/**
 * The "On your board" card of a proposed bot (chat proposal, or the New bot
 * rail when `preview` is left out), as a BotView the apps' cards draw. With a
 * reading it says "Read once in chat"; without one "Not checked yet".
 */
export function previewCard(args: BotInput, preview?: PreviewResult | null, now: Date = new Date()): BotView {
  const at = now.toISOString();
  const read = preview?.watches ?? [];
  const ok = read.some((p) => p.ok);
  const watches: WatchView[] = (args.watches ?? []).map((w, i) => {
    const p = read.find((x) => x.index === i);
    const value = p?.ok ? p.value : null;
    return {
      id: w.id ?? `preview_${i}`,
      kind: w.kind,
      url: w.url ?? "",
      read: (w.kind === "page" ? (w.read ?? "text") : "") as ReadMode | "",
      selector: w.selector ?? "",
      source: w.source ?? "",
      symbol: w.symbol ?? "",
      currency: w.currency || p?.currency || "",
      rules: (w.rules ?? []).map(fieldsOf),
      health: p && !p.ok && p.health ? p.health : { code: "new", line: "" },
      lastReadingAt: p?.ok ? p.at : null,
      summary: p?.ok ? p.summary : "",
      site: p?.site || hostOf(w.url),
      title: "",
      value: value ?? null,
      excerpt: p?.ok ? (p.text || p.items?.[0]?.title || "").slice(0, 160) : "",
      latestItem: p?.ok && p.items?.length ? p.items[0] : null,
      lastChangedAt: null,
      spark: null,
      dayChangePct: null,
    };
  });
  return {
    id: "preview",
    name: args.name || "Name your bot",
    description: args.description ?? "",
    status: "active",
    pauseReason: null,
    origin: "chat",
    originClient: "",
    judgeMode: "rules",
    intervalMinutes: args.intervalMinutes || defaultMinutes(watches),
    urgent: !!args.urgent,
    desktop: args.desktop ?? true,
    phone: args.phone ?? true,
    snoozedUntil: null,
    nextCheckAt: null,
    lastCheckAt: ok ? at : null,
    lastOkAt: ok ? at : null,
    strikes: 0,
    health: ok ? { code: "preview", line: "Read once in chat" } : { code: "new", line: "Not checked yet" },
    alertsToday: 0,
    watches,
    createdAt: at,
    updatedAt: at,
    checking: false,
    runNowAt: null,
    floorLine: floorLine(watches),
    strip: "",
    latestAlert: null,
    itemsToday: 0,
  };
}

/** The rows beside a proposal's card: First check, Then, At most. */
export function proposalFacts(args: BotInput): [string, string][] {
  const every = args.intervalMinutes || defaultMinutes(args.watches ?? []);
  return [
    ["First check", "On approve"],
    ["Then", `Every ${intervalLabel(every).replace(/^1 /, "")}`],
    ["At most", `${BOT_LIMITS.alertsPerDay} alerts a day`],
  ];
}

const MAX_LABEL_RUNES = 40;

/**
 * A candidate's label as quoted data: page text, so it is put on one line,
 * stripped of quote marks and clipped to 40 characters before it goes into a
 * message sent as the person's words.
 */
function pageLabel(label: string): string {
  const flat = label.replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
  const runes = Array.from(flat);
  if (runes.length <= MAX_LABEL_RUNES) return flat || "price";
  return `${runes.slice(0, MAX_LABEL_RUNES - 1).join("").trimEnd()}…`;
}

/** What "That's not it" sends when the person picks another price on the page. */
export function notItMessage(candidate: PreviewCandidate, watch: { site?: string; url?: string }): string {
  const site = watch.site || hostOf(watch.url) || "page";
  const money = formatMoney(candidate.amount, candidate.currency);
  const where = candidate.selector ? ` (selector ${JSON.stringify(candidate.selector)})` : "";
  return `That's not it. Follow the “${pageLabel(candidate.label)}”, ${money}, on the ${site} watch${where}.`;
}

const TAG_END = /[\n,.:;?!]/;
const MAX_TAG_QUERY = BOT_LIMITS.maxNameLen;

/**
 * The @-picker trigger: an "@" at the start or after whitespace, then what was
 * typed up to the caret, which may hold spaces (bot names do) but ends at a
 * newline or one of , . : ; ? !, as the server's tagBots reads a tag. Null
 * when the caret is not in a tag.
 */
export function botTagQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const start = before.lastIndexOf("@");
  if (start < 0) return null;
  if (start > 0 && !/\s/.test(before[start - 1])) return null;
  const query = before.slice(start + 1);
  if (TAG_END.test(query) || /^\s/.test(query) || query.length > MAX_TAG_QUERY) return null;
  return { query, start };
}
