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
export type RuleKind = "any_change" | "above" | "below" | "move_pct" | "words_appear" | "words_disappear" | "new_item" | "in_stock";
/**
 * Whether a shop page says its product can be bought (schema.org offer
 * availability). "unknown" when the page says nothing; an unknown never holds
 * an alert. Only a page read as product_price has one.
 */
export type Availability = "in_stock" | "out_of_stock" | "preorder" | "backorder" | "limited" | "discontinued" | "unknown";
export type MoveDirection = "up" | "down" | "any";
/** How smart a bot is: rules alone, or rules that spot and an AI that judges (Research is Later). */
export type JudgeMode = "rules" | "ai";
/** A watch bot reads pages, feeds and prices; a brief sums up other bots once a day. */
export type BotKind = "watch" | "brief";
/** How urgent an alert is: the AI judge's word, or high for an Urgent bot. */
export type Urgency = "low" | "normal" | "high";
/** What the AI judge did with an alert: nothing (rules only), judged, not reached, or judged later. */
export type AiState = "" | "judged" | "unchecked" | "rejudged";

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
  /**
   * Price rules on a product_price page: stay quiet while the page says it is
   * out of stock or discontinued, and fire once it can be bought. Left out
   * means true; the server keeps only false.
   */
  onlyInStock?: boolean;
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

/** A Pass to link as a client sends it. `botId` is the bot that checks what this one finds (an id or a name). */
export type LinkInput = { id?: string; botId: string; filter: string[]; enabled?: boolean };

/** The doc or sheet the AI judge reads each check, as data. */
export type KnowledgeInput = { kind: "doc" | "sheet"; id: string };

/**
 * A new bot (`POST /bots`). intervalMinutes 0 means the default for its
 * watches. A brief (`kind: "brief"`) has no watches and sums up `sources`
 * daily at `briefTime`.
 */
export type BotInput = {
  name: string;
  description: string;
  intervalMinutes: number;
  judgeMode?: JudgeMode;
  urgent?: boolean;
  desktop?: boolean;
  phone?: boolean;
  watches: WatchInput[];
  /** Create only; a bot's kind never changes. */
  kind?: BotKind;
  /** null clears it (an edit). */
  knowledge?: KnowledgeInput | null;
  /** The full list of Pass to links. */
  passesTo?: LinkInput[];
  /** A brief: the bots it sums up (ids or names), the full list. */
  sources?: string[];
  /** A source bot: alert only through its briefs. */
  briefOnly?: boolean;
  /** A brief: "Write it with AI". */
  briefAi?: boolean;
  /** A brief: "08:00". */
  briefTime?: string;
};

/** An edit (`PATCH /bots/:id`); a field left out stays. `watches`, `passesTo` and `sources` are full lists. */
export type BotPatch = {
  name?: string;
  description?: string;
  intervalMinutes?: number;
  judgeMode?: JudgeMode;
  urgent?: boolean;
  desktop?: boolean;
  phone?: boolean;
  watches?: WatchInput[];
  knowledge?: KnowledgeInput | null;
  passesTo?: LinkInput[];
  sources?: string[];
  briefOnly?: boolean;
  briefAi?: boolean;
  briefTime?: string;
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
/** `not_passed` ("Shouldn't have been passed on") is only for an alert that came through a Pass to link. */
export type FeedbackReason = "" | "too_small" | "not_wanted" | "already_knew" | "not_passed";
/**
 * Where an alert went: sent (""), kept while snoozed, over the day's cap,
 * held back by the AI judge, or folded into another bot's alert on the same
 * thing ("Also seen by").
 */
export type AlertHeld = "" | "snoozed" | "cap" | "judged" | "shared";

/** A bot by id and name. */
export type BotRef = { botId: string; name: string };
/** One step of "How this came to you": the bot that found it and the link it was passed on. */
export type ViaStep = { botId: string; name: string; linkId: string | null; title: string };
/** The alert a held `shared` alert joined. */
export type SharedRef = { alertId: string; botId: string; name: string };

/** The newest alert of a bot, on its card. */
export type AlertBrief = {
  id: string;
  kind: AlertKind;
  title: string;
  body: string;
  url: string;
  held: AlertHeld;
  createdAt: string;
  feedback: Feedback | null;
  aiState: AiState;
  /** The judge's line, or why it was not checked. */
  aiWhy: string;
  urgency: Urgency;
  /** Other bots that saw the same thing the same day. */
  alsoSeenBy: BotRef[];
  sharedWith: SharedRef | null;
  /** The bots it was passed through, first finder first. */
  via: ViaStep[];
  /** A brief: how many notes it held (figures.items), when the server sends it. */
  items?: number;
};

export type WatchView = {
  id: string;
  kind: WatchKind;
  url: string;
  read: ReadMode | "";
  selector: string;
  source: string;
  symbol: string;
  /** A price's pair, or a page's currency hint (from the address or what was sent); checks never change it. */
  currency: string;
  /** The last reading's currency, "" before the first read. For a page it wins over the hint. */
  readingCurrency: string;
  rules: Rule[];
  health: Health;
  lastReadingAt: string | null;
  /** "₹27,499", "12 items", "Text, 4,210 characters". */
  summary: string;
  /** A product_price page's last stated availability; "" for other watches and before the first read. */
  availability?: Availability | "";
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

/** The doc or sheet a bot's AI judge reads. `missing` when it was deleted or archived. */
export type KnowledgeView = { kind: "doc" | "sheet"; id: string; title: string; missing: boolean };

/** A better rule a rules-only bot suggests after three Not useful alerts in a row. */
export type Suggestion = {
  id: string;
  /** "Only tell me about moves over 8%?" */
  line: string;
  /** "Raise to 8%". */
  button: string;
  reason: string;
  watchId?: string;
  ruleId?: string;
  rule?: Rule;
  intervalMinutes?: number;
  judgeMode?: JudgeMode;
  alertIds: string[];
  createdAt: string;
};

/** Why a bot missed checks: Timely was closed, the computer slept, or Pause all was on. */
export type AwayReason = "closed" | "asleep" | "all_paused";

/** How long a bot missed checks and why. `since` (a bot only): when it fell behind. */
export type AwayView = { seconds: number; reason: AwayReason; since?: string };

export type BotView = {
  id: string;
  name: string;
  description: string;
  status: BotStatus;
  pauseReason: PauseReason | null;
  origin: BotOrigin;
  /** The outside app's name (its API key's name) when origin is mcp, else "". */
  originClient: string;
  judgeMode: JudgeMode;
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
  kind: BotKind;
  /** A source bot: alerts only through its briefs. */
  briefOnly: boolean;
  /** A brief: written with AI. */
  briefAi: boolean;
  /** A brief: "08:00"; "" for a watch bot. */
  briefTime: string;
  /** A brief: the ids of the bots it sums up, in the order they were added. */
  sources: string[];
  knowledge: KnowledgeView | null;
  aiChecksToday: number;
  suggestion: Suggestion | null;
  /** Checks it missed while Timely was closed, the computer slept or Pause all was on, until a check reads something; else null. */
  away: AwayView | null;
};

export type LinkKind = "pass" | "brief";

/**
 * A link between two bots. pass: what `fromBotId` finds goes to `toBotId` to
 * check first; brief: `fromBotId` is one of the bots the brief `toBotId` sums up.
 */
export type LinkView = {
  id: string;
  kind: LinkKind;
  fromBotId: string;
  toBotId: string;
  /** pass: words a note must hold (any one); [] passes everything. */
  filter: string[];
  enabled: boolean;
  offReason: "" | "person";
  passedToday: number;
  createdAt: string;
};

/** The account's AI provider as the judge uses it. No model ids are shown to the person. */
export type AiStatus = {
  ready: boolean;
  provider: string;
  /** "Anthropic API", "Claude Code". */
  label: string;
  model: string;
  reason: "" | "none" | "not_chosen" | "off";
};

export type BotsSummary = {
  checksToday: number;
  alertsToday: number;
  nextCheckAt: string | null;
  /** Today's alerts folded into another bot's alert ("Also seen by"). */
  sharedToday: number;
  aiChecksToday: number;
  aiCap: number;
  ai: AiStatus;
  /** "Pause all bots" is on. */
  allPaused: boolean;
  passedToday: number;
  links: LinkView[];
};

/** What a client shows before `GET /bots` answers. */
export const EMPTY_BOTS_SUMMARY: BotsSummary = {
  checksToday: 0,
  alertsToday: 0,
  nextCheckAt: null,
  sharedToday: 0,
  aiChecksToday: 0,
  aiCap: 200,
  ai: { ready: false, provider: "", label: "", model: "", reason: "" },
  allPaused: false,
  passedToday: 0,
  links: [],
};

/** `GET /bots`. */
export type BotsList = { bots: BotView[]; summary: BotsSummary };

export type CheckTrigger = "schedule" | "wake" | "run_now" | "ask" | "pass";
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
  | "superseded"
  | "judged_quiet"
  | "passed"
  | "held_stock";

export type FiredRule = { watchId: string; ruleId: string; kind: RuleKind };

export type CheckView = {
  id: string;
  trigger: CheckTrigger;
  startedAt: string;
  outcome: CheckOutcome;
  errorKind: string;
  error: string;
  fired: FiredRule[] | null;
  /** The first check after a gap: how long the bot was paused, and why; else null. */
  away: AwayView | null;
  /** held_stock: why nobody was told ("Price is below ₹90,000, but the page says it is out of stock"). */
  note?: string;
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
  /** "Paused for 9 hours while Timely was closed": the alert's catch-up line, also the body's last line. */
  away?: string;
};

export type AlertKind = "alert" | "more" | "paused" | "brief";

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
  aiState: AiState;
  aiWhy: string;
  urgency: Urgency;
  alsoSeenBy: BotRef[];
  sharedWith: SharedRef | null;
  via: ViaStep[];
  /** A brief: its rules-made lines (figures.lines), shown beside an AI-written body. */
  lines: string[];
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
  /** Every link from or to this bot. */
  links: LinkView[] | null;
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

/** `POST /bots/:id/alerts/:alertId/feedback`: the alert, and the lesson the rating wrote. */
export type RateResult = AlertView & { lesson: Lesson | null };

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
  /** product_price pages: what the page says about stock; "" for other reads. */
  availability?: Availability | "";
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
  availability?: Availability | "";
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
  aiPerBot: 20,
  aiPerAccount: 200,
  chainAi: 6,
  maxLinks: 4,
  maxBriefSources: 8,
  briefItemsPerBot: 5,
  linkPerDay: 20,
  passPerCheck: 10,
  chainSteps: 3,
  maxFilterWords: 5,
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
    ["AI checks", `${L.aiPerBot} a day per bot, ${L.aiPerAccount} in all`],
    ["Passing on", `${L.maxLinks} bots, ${L.linkPerDay} a day each`],
    ["Briefs", `Up to ${L.maxBriefSources} bots, ${L.briefItemsPerBot} items each`],
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

/**
 * When a snooze ends, always with its day so a time tomorrow never reads as
 * today: "Sun 09:00" within the week, else "Nov 14, 09:00".
 */
export function untilLabel(iso: string, now: Date, tz?: string): string {
  const t = ms(iso);
  if (t === null) return "";
  const p = zoneParts(t, tz);
  if (t - now.getTime() < 6 * DAY) return `${p.weekday} ${p.time}`;
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

/**
 * A typed amount as a number, or undefined: "25000", "25,000", "₹ 25 000",
 * "1,00,000", and a comma typed as the decimal point ("0,5", "24,99"), as a
 * phone's decimal keypad gives in many locales. A single comma with exactly
 * three digits after it ("25,000") is grouping; with both marks the last one
 * is the decimal point ("1.234,5").
 */
export function parseAmount(text: string): number | undefined {
  let clean = text.replace(/[^\d.,]/g, "");
  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    clean =
      comma > dot
        ? clean.replace(/\./g, "").replace(/,(?=[^,]*$)/, ".").replace(/,/g, "")
        : clean.replace(/,/g, "");
  } else if (comma >= 0) {
    const parts = clean.split(",");
    clean =
      parts.length === 2 && parts[1].length !== 3
        ? parts.join(".")
        : parts.join("");
  }
  if (!clean || clean === ".") return undefined;
  const n = Number(clean);
  return Number.isFinite(n) ? n : undefined;
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

/**
 * The currency of a watch. A page shows its last reading's once it has one,
 * else its hint; a price its own pair. Either falls back to the other, then
 * to the one its summary was shown in.
 */
export function watchCurrency(
  w: Pick<WatchView, "currency" | "summary"> & Partial<Pick<WatchView, "kind" | "readingCurrency">>,
): string {
  const reading = w.readingCurrency ?? "";
  if (w.kind === "page" && reading) return reading;
  if (w.currency) return w.currency;
  if (reading) return reading;
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

type WatchLike = KindRead & { url?: string; source?: string; symbol?: string; currency?: string; site?: string; title?: string };

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

/**
 * The rules a watch saved without any gets, the API's DefaultRules: any change
 * on a page, a new post on a feed, a 5% drop on a shop price and a 5% move
 * either way on a market price.
 */
export function defaultRules(w: KindRead): Rule[] {
  switch (readingKind(w)) {
    case "feed":
      return [{ kind: "new_item" }];
    case "price":
      return [{ kind: "move_pct", percent: 5, direction: w.kind === "page" ? "down" : "any" }];
  }
  return [{ kind: "any_change" }];
}

export const RULE_LABELS: Record<RuleKind, string> = {
  below: "Price is below",
  above: "Price is above",
  move_pct: "Moves by a percent",
  any_change: "Any change",
  words_appear: "Words appear",
  words_disappear: "Words disappear",
  new_item: "A new post",
  in_stock: "Back in stock",
};

/** The page read modes, as the "Reads" row offers them. */
export const READ_OPTIONS: { id: ReadMode; label: string }[] = [
  { id: "text", label: "Readable text" },
  { id: "selector", label: "One part of the page" },
  { id: "product_price", label: "Shop price" },
  { id: "selector_price", label: "One price on the page" },
];

/** "How smart". Research is Later. */
export const HOW_SMART: { id: JudgeMode | "research"; label: string; later?: true }[] = [
  { id: "rules", label: "Rules only" },
  { id: "ai", label: "AI judges" },
  { id: "research", label: "Research", later: true },
];

/** The How smart chooser's own hint (web menu and phone sheet). */
export const SMART_HINT = "AI judges looks at each change your rules spot and decides if it's worth telling you. Research comes later.";

/** The "Not useful" reasons. */
export const FEEDBACK_REASONS: { id: Exclude<FeedbackReason, "">; label: string }[] = [
  { id: "too_small", label: "Change too small" },
  { id: "not_wanted", label: "Not what I want" },
  { id: "already_knew", label: "Already knew" },
];

/** The extra Not useful reason on an alert that came through a Pass to link (not one of FEEDBACK_REASONS). */
export const PASS_FEEDBACK = { id: "not_passed", label: "Shouldn't have been passed on" } as const;

/** The "Daily at" choices of a brief: 05:00 to 22:00, hourly. */
export const BRIEF_TIMES: string[] = Array.from({ length: 18 }, (_, i) => `${String(i + 5).padStart(2, "0")}:00`);

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
  selector_price: "One price on the page",
  selector: "One part of the page",
  text: "Page text",
};

/** What a watch reads, in a few words: "Feed", "Price", "Product price", "One part of the page"; the API's watchKindLine. */
export function watchKindLine(w: KindRead): string {
  if (w.kind === "feed") return "Feed";
  if (w.kind === "price") return "Price";
  return READ_TITLES[w.read ?? ""] ?? "Page text";
}

/**
 * A watch's name: "amazon.in · Sony WH-1000XM6 Wireless" from the page's
 * title, else "amazon.in · Product price"; "BTC-USD · Coinbase" for a coin
 * and "NVDA · Finnhub" for a stock; "go.dev · Feed" for a feed. The API's
 * watchTitle (view.go) follows the same rule; only a draft with no address
 * yet, which the API never sees, is "New page".
 */
export function watchTitle(w: WatchLike): string {
  if (w.kind === "price") {
    // A stock source quotes one currency, so only a coin names its pair.
    const stock = !w.source || w.source === "stock" || w.source === "finnhub";
    const pair = !w.symbol ? "Price" : w.currency && !stock ? `${w.symbol}-${w.currency}` : w.symbol;
    return `${pair} · ${sourceLabel(w.source ?? "")}`;
  }
  const site = siteOf(w) || "New page";
  if (w.kind === "page" && w.title) return `${site} · ${w.title}`;
  return `${site} · ${watchKindLine(w)}`;
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
  const anyStock = rule.onlyInStock === false ? ", in stock or not" : "";
  switch (rule.kind) {
    case "in_stock":
      return "Back in stock";
    case "below":
      return `Price is below ${money(rule.threshold)}${anyStock}`;
    case "above":
      return `Price is above ${money(rule.threshold)}${anyStock}`;
    case "move_pct": {
      const p = rule.percent == null ? "…" : pctNumber(rule.percent);
      if (rule.direction === "up") return `Rises ${p}%${anyStock}`;
      if (rule.direction === "down") return `Drops ${p}%${anyStock}`;
      return `Moves ${p}% either way${anyStock}`;
    }
    case "words_appear":
      return `${quoted(rule.words) || "Words"} appears`;
    case "words_disappear":
      return `${quoted(rule.words) || "Words"} disappears`;
    case "new_item":
      return rule.words?.length ? `A new post with ${quoted(rule.words)}` : "A new post";
  }
  return `Any change${anyStock}`;
}

/**
 * A rule as the clause after "tell you": "when the price is below ₹90,000",
 * "when it moves 5% either way", "about each new post". Reads on from "It
 * would read <site> every 6 hours and tell you …".
 */
export function tellLine(rule: Rule, watch: Pick<WatchView, "currency" | "summary"> | Pick<WatchInput, "currency">): string {
  const line = ruleLine(rule, watch);
  const lower = line.charAt(0).toLowerCase() + line.slice(1);
  switch (rule.kind) {
    case "below":
    case "above":
      return `when the ${lower}`;
    case "move_pct":
      return `when it ${lower}`;
    case "words_appear":
    case "words_disappear":
      return `when ${line}`;
    case "new_item":
      return rule.words?.length ? `about each new post with ${quoted(rule.words)}` : "about each new post";
    case "in_stock":
      return "when it is back in stock";
  }
  return "when it changes";
}

/**
 * Where a new alert's link button goes. A feed alert carries the feed's own
 * address, so it opens the newest post when that post has a web address
 * (feed text is third-party, so only http(s) is taken), else the feed. Other
 * alerts open the page they read. null when there is nothing safe to open.
 */
export function alertLink(
  bot: Pick<BotView, "watches" | "health">,
  alert: Pick<AlertBrief, "url">,
): { url: string; label: "Open post" | "Open feed" | "Open page"; post: boolean } | null {
  const w = bot.watches.find((x) => x.url && x.url === alert.url) ?? primaryWatch(bot);
  if (w?.kind === "feed") {
    const item = w.latestItem?.url ?? "";
    if (isWebAddress(item)) return { url: item, label: "Open post", post: true };
    return isWebAddress(alert.url) ? { url: alert.url, label: "Open feed", post: false } : null;
  }
  return isWebAddress(alert.url) ? { url: alert.url, label: "Open page", post: false } : null;
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

export type NeedsReason = "new_alert" | "suggestion" | "broken" | "waiting_ok" | "stopped" | "needs_key";
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
  if (bot.suggestion) return "suggestion";
  return null;
}

/** "needs", "watching" or "paused". */
export function boardGroup(bot: BotView, now: Date): BoardGroup {
  if (needsReason(bot, now)) return "needs";
  return bot.status === "paused" ? "paused" : "watching";
}

const NEEDS_RANK: Record<NeedsReason, number> = { new_alert: 0, suggestion: 1, broken: 2, needs_key: 3, waiting_ok: 4, stopped: 5 };

/** The "Needs you" bots in order: new alerts, suggested changes, broken, keys, waiting, stopped, then newest change. */
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

export type FixAction =
  | "pick_part"
  | "edit_url"
  | "add_key"
  | "change_source"
  | "check_now"
  | "turn_on"
  | "resume"
  | "apply_suggestion"
  | "dismiss_suggestion";
export type FixButton = { action: FixAction | "edit"; label: string };

const FIX_LABELS: Record<FixAction, string> = {
  pick_part: "Pick the part again",
  edit_url: "Edit",
  add_key: "Add key",
  change_source: "Change source",
  check_now: "Check now",
  turn_on: "Turn on",
  resume: "Resume",
  apply_suggestion: "Apply",
  dismiss_suggestion: "Not now",
};

const isStopped = (bot: BotView) => bot.status === "paused" && bot.pauseReason === "strikes";

/** What fixes a bot that needs one. */
export function fixAction(bot: BotView): FixAction {
  if (bot.status === "paused" && bot.pauseReason === "mcp") return "turn_on";
  // A brief reads nothing, so nothing on it breaks: it is resumed or run.
  if (isBrief(bot)) return bot.status === "paused" ? "resume" : "check_now";
  const broken = bot.health.code === "needs_key" || (bot.strikes > 0 && STRIKES.has(bot.health.code));
  if (bot.suggestion && bot.status === "active" && !broken) return "apply_suggestion";
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
  if (action === "apply_suggestion" && bot.suggestion) {
    return {
      primary: { action, label: bot.suggestion.button },
      secondary: { action: "dismiss_suggestion", label: FIX_LABELS.dismiss_suggestion },
    };
  }
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
  if (fixAction(bot) === "apply_suggestion" && bot.suggestion) {
    return { eyebrow: "Suggests a change", title: bot.suggestion.line, meta: "After 3 Not useful alerts in a row" };
  }
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

// ── Briefs on the board ──

/** Bots by id, for names: a list or a map both fit. */
export type BotNames = { id: string; name: string }[] | Record<string, { name: string }>;

/** When a brief sends unless the person picks another hour. */
export const DEFAULT_BRIEF_TIME = "08:00";

const isBrief = (bot: { kind?: BotKind }) => bot.kind === "brief";
const sourcesOf = (bot: { sources?: string[] }) => bot.sources ?? [];

function nameOf(bots: BotNames | undefined, id: string): string | undefined {
  if (!bots) return undefined;
  if (Array.isArray(bots)) return bots.find((b) => b.id === id)?.name;
  return bots[id]?.name;
}

/** "A", "A and B", "A, B and C", "A, B and 2 more". */
function namesLine(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * A brief card's caption: "From GPU deals, Sony and 2 more". "From 4 bots"
 * when any source's name is unknown (deleted, or not loaded yet), so the
 * caption never counts fewer bots than "Sums up 4 bots" beside it.
 */
function briefFrom(bot: BotView, bots?: BotNames): string {
  const ids = sourcesOf(bot);
  if (ids.length === 0) return "No bots to sum up yet";
  const names = ids.map((id) => nameOf(bots, id)).filter((n): n is string => !!n);
  return names.length === ids.length ? `From ${namesLine(names)}` : `From ${plural(ids.length, "bot")}`;
}

/**
 * A brief card's big value: "7 new" from its newest brief's count
 * (figures.items), "Brief sent" when the server sends no count, else "Nothing
 * yet". The title is never read for it: an AI-written title holds no count.
 */
function briefValue(bot: BotView): CardValue {
  const a = bot.latestAlert;
  if (!a) return { kind: "text", text: "Nothing yet", tone: "default" };
  if (typeof a.items === "number") return { kind: "number", text: String(a.items), unit: "new", tone: "default" };
  return { kind: "text", text: "Brief sent", tone: "default" };
}

/** What a bot's mark draws: the sunrise for a brief, the watches' logos, or the plain bot when it watches nothing. */
export function botMarkKind(bot: Pick<BotView, "watches"> & Partial<Pick<BotView, "kind">>): "sunrise" | "watch" | "none" {
  if (isBrief(bot)) return "sunrise";
  return bot.watches.length ? "watch" : "none";
}

// ── Catch-up ──

/** The end of "Paused for 9 hours …", by reason. The API's awayWhile (bots.go) holds the same words. */
export const AWAY_WHILE: Record<AwayReason, string> = {
  closed: "while Timely was closed",
  asleep: "while this computer was asleep",
  all_paused: "while all bots were paused",
};

/** A card's caption while its catch-up check is still to come: "Catching up · Timely was closed for 9 hours". */
export const AWAY_CAPTION: Record<AwayReason, (span: string) => string> = {
  closed: (s) => `Timely was closed for ${s}`,
  asleep: (s) => `this computer was asleep for ${s}`,
  all_paused: (s) => `all bots were paused for ${s}`,
};

/**
 * "Catching up · Timely was closed for 9 hours" while an active bot's catch-up
 * check is still to come; null for a brief (it keeps its sources), a bot with
 * no gap or a reason this client does not know, and under Pause all (the
 * footer says every bot is paused). The board card's caption, the phone's
 * "Needs you" card and the rail all say it the same way.
 */
export function catchingUpLine(bot: Pick<BotView, "status" | "away"> & { kind?: BotKind }, opts: { allPaused?: boolean } = {}): string | null {
  if (isBrief(bot) || bot.status !== "active" || opts.allPaused || !bot.away || bot.away.seconds <= 0) return null;
  const caption = AWAY_CAPTION[bot.away.reason];
  return caption ? `Catching up · ${caption(awayFor(bot.away.seconds))}` : null;
}

/** The rail and the phone sheet, once the catch-up check has run. */
export const CAUGHT_UP = "Caught up";

/**
 * "45 minutes", "9 hours", "3 days": a gap, as the API's awayFor (alerts.go)
 * words it. Minutes under 90 minutes, hours under 48 hours, else days, each
 * rounded half up.
 */
export function awayFor(seconds: number): string {
  if (seconds < 90 * 60) return plural(Math.round(seconds / 60), "minute");
  if (seconds < 48 * 3600) return plural(Math.round(seconds / 3600), "hour");
  return plural(Math.round(seconds / 86400), "day");
}

/** "Paused for 9 hours while Timely was closed"; "" for no gap or a reason this client does not know, as the API's awayLine. */
export function awayLine(away: Pick<AwayView, "seconds" | "reason">): string {
  const end = AWAY_WHILE[away.reason];
  return end && away.seconds > 0 ? `Paused for ${awayFor(away.seconds)} ${end}` : "";
}

/** Outcomes of a check that read nothing: the bot keeps its gap, so they are not a catch-up. */
const NO_READ: ReadonlySet<CheckOutcome> = new Set<CheckOutcome>(["offline", "rate_limited", "site_busy", "superseded"]);

const DAY_MS = 24 * 3600_000;

/**
 * The rail's "Caught up" line: the newest check that ran after a gap and read
 * the page, when it started at most 24 hours ago, from `detail.checks` (the
 * newest 20 the API sends). Checks that read nothing (offline, a wait,
 * superseded) are not a catch-up. Null while the bot still has a gap pending
 * (its card says "Catching up"), so the two never show together.
 */
export function recentAway(detail: Pick<BotDetail, "away" | "checks">, now: Date): { line: string; at: string } | null {
  if (detail.away) return null;
  let best: (Pick<AwayView, "seconds" | "reason"> & { at: string }) | null = null;
  for (const c of detail.checks ?? []) {
    if (!c.away || NO_READ.has(c.outcome)) continue;
    const at = ms(c.startedAt);
    if (at != null && (!best || at > (ms(best.at) as number))) best = { ...c.away, at: c.startedAt };
  }
  const at = ms(best?.at);
  if (!best || at == null || now.getTime() - at > DAY_MS) return null;
  const line = awayLine(best);
  return line ? { line, at: best.at } : null;
}

/**
 * A bot id as the API makes them ("bot_…"): a doc's price block fetches
 * nothing that is not one, so no free-typed name and no "keys". The pattern
 * alone cannot tell an id from a bot named "bot_deals" (`GET /bots/:id` also
 * matches names), so a block checks that the bot it gets back has this id.
 */
export const isBotId = (v: unknown): v is string => typeof v === "string" && /^bot_[A-Za-z0-9_-]+$/.test(v);

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
 * strike of the run), "Catching up · Timely was closed for 9 hours" (an
 * active bot whose catch-up check is still to come), "Last post seen, Nov 1"
 * (a feed), else null.
 */
export function captionLine(bot: BotView, now: Date, tz?: string, bots?: BotNames, opts: { allPaused?: boolean } = {}): string | null {
  if (isBrief(bot)) return briefFrom(bot, bots);
  const reason = needsReason(bot, now);
  if (reason === "stopped") {
    const since = firstStrikeAt(bot);
    return since ? `Since ${dateTime(since, tz)}` : "Not checked yet";
  }
  if (reason === "broken") return bot.lastOkAt ? `Last good read, ${agoLabel(bot.lastOkAt, now, tz)}` : "No good read yet";
  const catching = catchingUpLine(bot, opts);
  if (catching) return catching;
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
  if (isBrief(bot)) return briefValue(bot);
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
  if (isBrief(bot)) return `Sums up ${plural(sourcesOf(bot).length, "bot")}`;
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

/**
 * The card's sub line: "amazon.in · Sony WH-1000XM6 Wireless · every 6 h",
 * "2 feeds · every 30 min". `short` (the phone's one narrow line) names only
 * the site or symbol, so the interval always shows: "amazon.in · every 6 h".
 */
export function cardSub(
  bot: Pick<BotView, "watches" | "intervalMinutes"> & Partial<Pick<BotView, "kind" | "briefTime" | "sources">>,
  opts: { short?: boolean } = {},
): string {
  if (isBrief(bot)) {
    const head = `Brief · daily at ${bot.briefTime || DEFAULT_BRIEF_TIME}`;
    return opts.short ? head : `${head} · ${plural(sourcesOf(bot).length, "bot")}`;
  }
  const every = everyLabel(bot.intervalMinutes || defaultMinutes(bot.watches));
  const ws = bot.watches;
  if (ws.length === 0) return "No watch yet";
  if (ws.length === 1 && opts.short) {
    const w = ws[0];
    const where = w.kind === "price" ? watchTitle(w).split(" · ")[0] : siteOf(w) || "New page";
    return `${where} · ${every}`;
  }
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
  if (isBrief(bot)) return cardSub(bot);
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
 * When the next brief goes out, at its set time: the server adds up to two
 * minutes to spread the runs, which no screen shows ("08:00", not "08:01").
 * The day still comes from the run itself.
 */
export function briefClock(bot: Pick<BotView, "briefTime">, iso: string, now: Date, tz?: string): string {
  const label = clockLabel(iso, now, tz);
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(bot.briefTime ?? "") ? bot.briefTime : "";
  return time ? label.replace(/\d\d:\d\d$/, time) : label;
}

/**
 * The right side of a card's footer: "Next 00:12", "Made 40 min ago",
 * "Nov 5, 22:40" (when it paused itself), "No alerts yet", "No change in 6
 * days", "2 of 3 alerts today", "Next brief 08:00". Null on a bot the person
 * paused, whose card shows Resume there, and while Pause all is on, when
 * the health line on the left says "All bots paused" and nothing is next.
 */
export function footerRight(bot: BotView, now: Date, tz?: string, opts: { allPaused?: boolean } = {}): string | null {
  const reason = needsReason(bot, now);
  if (reason === "waiting_ok") return `Made ${agoLabel(bot.createdAt, now, tz)}`;
  if (reason === "stopped") return bot.lastCheckAt ? dateTime(bot.lastCheckAt, tz) : null;
  if (bot.status === "paused") return null;
  if (opts.allPaused) return null;
  if (isBrief(bot)) return bot.nextCheckAt ? `Next brief ${briefClock(bot, bot.nextCheckAt, now, tz)}` : null;
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

/** A bot's health while Pause all is on. */
export const ALL_PAUSED = "All bots paused";

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

/**
 * The health line under a card: a tone dot, a bold word and a time. While
 * Pause all is on (`allPaused`), a bot that would run says "All bots paused"
 * on a grey dot, so nothing reads as working.
 */
export function healthLine(
  bot: BotView,
  now: Date,
  tz?: string,
  opts: { allPaused?: boolean } = {},
): { tone: HealthTone; word: string; time: string | null } {
  const reason = needsReason(bot, now);
  const ago = bot.lastCheckAt ? agoLabel(bot.lastCheckAt, now, tz) : null;
  if (bot.health.code === "preview") return { tone: "primary", word: bot.health.line || "Read once in chat", time: null };
  if (reason === "waiting_ok") return { tone: "warn", word: "Waiting for your OK", time: null };
  if (reason === "stopped") return { tone: "bad", word: `Paused after ${bot.strikes || BOT_LIMITS.maxStrikes} strikes`, time: null };
  if (bot.status === "paused") return { tone: "off", word: "Paused by you", time: shortDate(bot.updatedAt, tz) };
  if (opts.allPaused) return { tone: "off", word: ALL_PAUSED, time: null };
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
export function miniHealth(bot: BotView, now: Date, tz?: string, opts: { allPaused?: boolean } = {}): string {
  const h = healthLine(bot, now, tz, opts);
  if (needsReason(bot, now) === "new_alert") return "Was it worth it?";
  if (needsReason(bot, now) === "broken") return `${h.word} · ${bot.strikes} of ${BOT_LIMITS.maxStrikes}`;
  return h.time ? `${h.word} · ${h.time}` : h.word;
}

/** The header line: "312 checks today · 2 alerts · next check in 4 min" (phone: "9 bots · 2 alerts today · …"). */
export function summaryLine(list: BotsList, now: Date, variant: "desktop" | "phone" = "desktop"): string {
  const { checksToday, alertsToday, nextCheckAt, sharedToday } = list.summary;
  const alerts = alertsToday === 0 ? "no alerts" : plural(alertsToday, "alert");
  const parts =
    variant === "phone"
      ? [plural(list.bots.length, "bot"), `${alerts} today`]
      : [plural(checksToday, "check") + " today", alerts];
  if (sharedToday > 0) parts.push(`${sharedToday} shared`);
  if (nextCheckAt) parts.push(`next check ${inLabel(nextCheckAt, now)}`);
  return parts.join(" · ");
}

// ── AI judging ──

/** The How smart choices: Research is Later, and AI judges needs an AI provider. */
export function smartOptions(summary: Pick<BotsSummary, "ai">): { id: JudgeMode | "research"; label: string; disabled: boolean; tag?: string }[] {
  return HOW_SMART.map((h) => {
    if (h.later) return { id: h.id, label: h.label, disabled: true, tag: "Later" };
    if (h.id === "ai" && !summary.ai?.ready) return { id: h.id, label: h.label, disabled: true, tag: "Needs AI" };
    return { id: h.id, label: h.label, disabled: false };
  });
}

/** The How smart group's hint for this bot (no model ids). */
export function aiHint(bot: { judgeMode?: string; aiChecksToday?: number }, summary: Pick<BotsSummary, "ai">): string {
  if (bot.judgeMode !== "ai") return "Rules cost nothing and never call an AI.";
  if (!summary.ai?.ready) return "No AI provider yet, so this bot alerts on rules alone. Add one in Settings › Agent.";
  const on = summary.ai.label ? `, on ${summary.ai.label}` : "";
  return `AI checks ${bot.aiChecksToday ?? 0} of ${BOT_LIMITS.aiPerBot} today${on}. AI looks at each change your rules spot and decides if it's worth telling you.`;
}

/** The Lessons group's hint: a watch bot's judge reads them; a brief's AI writer does. */
export function lessonsHint(bot: { kind?: BotKind }): string {
  if (isBrief(bot)) return "When Write it with AI is on, these shape how the brief is written. Remove one to forget it.";
  return "The AI judge reads these each time it decides. Rules-only bots keep them for when you turn AI on. Remove one to forget it.";
}

export type AlertAi = {
  /** "Not checked by AI" on an alert the judge did not reach. */
  pill: "Not checked by AI" | null;
  /** The full line under an alert. */
  line: string | null;
  /** The one-line card form: "Not checked by AI · asks again later". */
  short: string | null;
  tone: "default" | "muted" | "warning";
};

/** The short reasons of an unchecked alert, by the API's words (plan.go, rejudge.go). */
const UNCHECKED_SHORT: [RegExp, string][] = [
  [/asks again later/i, "asks again later"],
  [/used up/i, "AI checks used up today"],
  [/^Choose which AI provider/i, "no AI provider chosen"],
  [/^No AI provider/i, "no AI provider"],
  [/^Changed while/i, "changed while checking"],
  [/^AI was unavailable$/i, "AI was unavailable"],
  [/all bots are paused/i, "all bots paused"],
  [/judging was turned off/i, "AI judging turned off"],
];

/**
 * What the AI judge did with an alert, as its pill and lines; all null on a
 * rules-only alert. A brief the AI could not write was sent from the template
 * and is never asked about again, so it never says "asks again later".
 */
export function alertAi(alert: Pick<AlertBrief, "aiState" | "aiWhy" | "held"> & Partial<Pick<AlertBrief, "kind">>): AlertAi {
  const why = (alert.aiWhy ?? "").trim();
  switch (alert.aiState) {
    case "judged": {
      if (alert.held === "judged") {
        const line = why ? `Held back by AI: ${why}` : "Held back by AI";
        return { pill: null, line, short: line, tone: "muted" };
      }
      const line = why ? `AI: ${why}` : null;
      return { pill: null, line, short: line, tone: "default" };
    }
    case "rejudged": {
      const line = why ? `AI checked it later: ${why}` : "AI checked it later";
      return { pill: null, line, short: line, tone: "muted" };
    }
    case "unchecked": {
      const brief = alert.kind === "brief";
      const retry = /asks again later/i.test(why);
      const reason = brief && (retry || !why) ? "written from the template" : UNCHECKED_SHORT.find(([re]) => re.test(why))?.[1];
      return {
        pill: "Not checked by AI",
        line: brief && retry ? "AI was unavailable, so this brief was written from the template" : why || null,
        short: reason ? `Not checked by AI · ${reason}` : "Not checked by AI",
        tone: "warning",
      };
    }
  }
  return { pill: null, line: null, short: null, tone: "default" };
}

/** "Also seen by Price check" / "Also seen by Price check and 1 more"; null when no other bot saw it. */
export function alsoSeenLine(alert: Pick<AlertBrief, "alsoSeenBy">): string | null {
  const seen = alert.alsoSeenBy ?? [];
  if (seen.length === 0) return null;
  return seen.length === 1 ? `Also seen by ${seen[0].name}` : `Also seen by ${seen[0].name} and ${seen.length - 1} more`;
}

/** "Already told you through Bitcoin under $70,000" on a held shared alert; else null. */
export function sharedLine(alert: Pick<AlertBrief, "sharedWith">): string | null {
  return alert.sharedWith ? `Already told you through ${alert.sharedWith.name}` : null;
}

// ── Links and briefs ──

/** A Pass to filter in words: "mentions 2TB NVMe", "mentions 2TB or 4TB", "Everything it finds". */
export function filterLine(filter: string[] | null | undefined): string {
  const words = (filter ?? []).map((w) => w.trim()).filter(Boolean);
  return words.length ? `mentions ${words.join(" or ")}` : "Everything it finds";
}

const linkName = (bots: BotNames | undefined, id: string) => nameOf(bots, id) ?? "A deleted bot";

/** "How this came to you": the rows, and the link "Turn off this pass" turns off (null when there is none to turn off). */
/**
 * The links "How this came to you" looks steps up in: the account's (the
 * board's summary) with the open bot's own over them. A bot's own list has
 * only the links from or to it, so the first step of a longer chain is
 * found only on the board.
 */
export function chainLinks(board: LinkView[] | null | undefined, own: LinkView[] | null | undefined): LinkView[] {
  const byId = new Map<string, LinkView>();
  for (const l of board ?? []) byId.set(l.id, l);
  for (const l of own ?? []) byId.set(l.id, l);
  return [...byId.values()];
}

export function howItCame(
  alert: Pick<AlertBrief, "via" | "aiState">,
  bot: Pick<BotView, "name">,
  botsById: BotNames | undefined,
  links: LinkView[] | null | undefined,
): { rows: [string, string][]; unpass: { linkId: string } | null } {
  const via = alert.via ?? [];
  const byId = new Map((links ?? []).map((l) => [l.id, l]));
  const rows: [string, string][] = [];
  for (const step of via) {
    rows.push(["Found by", nameOf(botsById, step.botId) ?? step.name]);
    const link = step.linkId ? byId.get(step.linkId) : undefined;
    rows.push(["Passed on", link ? filterLine(link.filter) : "By a link that is gone"]);
  }
  rows.push(["Checked by", bot.name]);
  const judged = alert.aiState === "judged" || alert.aiState === "rejudged" ? "AI" : alert.aiState === "unchecked" ? "Not checked by AI" : "Rules only";
  rows.push(["Judged by", judged]);
  const last = via[via.length - 1];
  const link = last?.linkId ? byId.get(last.linkId) : undefined;
  return { rows, unpass: link?.enabled ? { linkId: link.id } : null };
}

export type Chain = {
  /** The bots along the chain, first finder first. */
  ids: string[];
  /** "Deals feed → Price check". */
  label: string;
  /** Items its links passed on today. */
  passedToday: number;
  firstBotId: string;
};

const passLinks = (links: LinkView[] | null | undefined, enabled?: boolean) =>
  (links ?? []).filter((l) => l.kind === "pass" && (enabled === undefined || l.enabled === enabled));

/**
 * Every chain of enabled Pass to links: each longest path from a bot that
 * passes on and gets nothing passed to it, at most 3 links, by label. Brief
 * links are not chains, and a switched-off link shows only as a Today row.
 */
export function chainsOf(links: LinkView[] | null | undefined, bots: BotNames): Chain[] {
  const live = passLinks(links, true).filter((l) => nameOf(bots, l.fromBotId) !== undefined && nameOf(bots, l.toBotId) !== undefined);
  const out = new Map<string, LinkView[]>();
  for (const l of live) out.set(l.fromBotId, [...(out.get(l.fromBotId) ?? []), l]);
  const fed = new Set(live.map((l) => l.toBotId));
  const roots = [...new Set(live.map((l) => l.fromBotId))].filter((id) => !fed.has(id));
  const chains: Chain[] = [];
  const walk = (path: LinkView[], seen: Set<string>) => {
    const at = path[path.length - 1].toBotId;
    const next = path.length < BOT_LIMITS.chainSteps ? (out.get(at) ?? []).filter((l) => !seen.has(l.toBotId)) : [];
    if (next.length === 0) {
      const ids = [path[0].fromBotId, ...path.map((l) => l.toBotId)];
      chains.push({
        ids,
        label: ids.map((id) => nameOf(bots, id) ?? id).join(" → "),
        passedToday: path.reduce((n, l) => n + l.passedToday, 0),
        firstBotId: ids[0],
      });
      return;
    }
    for (const l of next) walk([...path, l], new Set([...seen, l.toBotId]));
  };
  for (const root of roots) for (const l of out.get(root) ?? []) walk([l], new Set([root, l.toBotId]));
  return chains.sort((a, b) => a.label.localeCompare(b.label));
}

export type TodayRow =
  | { id: "pause"; label: string; kind: "switch"; on: boolean }
  | { id: string; label: string; kind: "value"; value: string }
  | { id: string; label: string; kind: "link"; value: "Off"; action: "Turn on" };

/** The board's Today group: Pause all, AI checks, Passed on, and each switched-off link. */
export function todayRows(summary: BotsSummary, bots: (Pick<BotView, "id" | "name"> & Partial<Pick<BotView, "judgeMode">>)[]): TodayRow[] {
  const rows: TodayRow[] = [{ id: "pause", label: "Pause all bots", kind: "switch", on: !!summary.allPaused }];
  if (bots.some((b) => b.judgeMode === "ai") || summary.aiChecksToday > 0) {
    rows.push({ id: "ai", label: "AI checks", kind: "value", value: `${summary.aiChecksToday} of ${summary.aiCap}` });
  }
  const pass = passLinks(summary.links);
  if (pass.length) rows.push({ id: "passed", label: "Passed on", kind: "value", value: `${summary.passedToday} today` });
  for (const l of pass) {
    if (l.enabled) continue;
    rows.push({ id: l.id, label: `${linkName(bots, l.fromBotId)} → ${linkName(bots, l.toBotId)}`, kind: "link", value: "Off", action: "Turn on" });
  }
  return rows;
}

/** The column spans of the board's Today and Chains cards; without chains Today takes the whole row. */
export function topSpans(cols: number, hasChains: boolean): [number, number] {
  if (!hasChains) return [cols, 0];
  if (cols <= 2) return [1, 1];
  return [Math.floor(cols / 2), cols - Math.floor(cols / 2)];
}

/** How many columns Today's rows flow into inside its card: more only when it fills a wide row alone. */
export function todayColumns(cols: number, hasChains: boolean): number {
  if (hasChains) return 1;
  if (cols >= 6) return 3;
  if (cols >= 4) return 2;
  return 1;
}

/** The Sums up group's add row, the same on desktop and phone. */
export const BRIEF_ADD_ROW = "Add a bot";

/**
 * A source row in a brief's Sums up group, the same on desktop and phone:
 * the meta under the bot's name says what its Only in the brief switch
 * does now ("Only in the brief" when on, "Also tells you itself" when off),
 * and `switchLabel` names the switch for screen readers.
 */
export function briefSourceRow(bot: { name: string; briefOnly?: boolean } | undefined, saved: boolean): { meta: string; switchLabel: string } {
  const switchLabel = `Only in the brief: ${bot?.name ?? "a deleted bot"}`;
  if (!bot || !saved) return { meta: "Added when the brief saves", switchLabel };
  return { meta: bot.briefOnly ? "Only in the brief" : "Also tells you itself", switchLabel };
}

/** A bot's "Works with" group: whom it passes to, who passes to it, the briefs it is in, and Only in the brief. */
export function worksWith(
  bot: Pick<BotView, "id"> & Partial<Pick<BotView, "briefOnly">>,
  links: LinkView[] | null | undefined,
  bots: BotNames,
): {
  passesTo: { link: LinkView; name: string; filterLine: string; passedLine: string }[];
  getsFrom: { link: LinkView; name: string }[];
  inBriefs: { link: LinkView; name: string }[];
  briefOnly: { on: boolean; enabled: boolean };
} {
  const all = links ?? [];
  const passesTo = all
    .filter((l) => l.kind === "pass" && l.fromBotId === bot.id)
    .map((link) => ({
      link,
      name: linkName(bots, link.toBotId),
      filterLine: filterLine(link.filter),
      // "6 of 20" never breaks across lines.
      passedLine: `Passed today ${link.passedToday}\u00a0of\u00a0${BOT_LIMITS.linkPerDay}`,
    }));
  const getsFrom = all.filter((l) => l.kind === "pass" && l.toBotId === bot.id).map((link) => ({ link, name: linkName(bots, link.fromBotId) }));
  const inBriefs = all.filter((l) => l.kind === "brief" && l.fromBotId === bot.id).map((link) => ({ link, name: linkName(bots, link.toBotId) }));
  return { passesTo, getsFrom, inBriefs, briefOnly: { on: !!bot.briefOnly, enabled: inBriefs.some((b) => b.link.enabled) } };
}

// ── Check labels ──

const OUTCOME_LABELS: Record<CheckOutcome, string> = {
  baseline: "First reading",
  unchanged: "No change",
  not_modified: "No change",
  changed: "Changed",
  fired: "Told you",
  offline: "Offline",
  rate_limited: "The site asked to wait",
  site_busy: "Site busy",
  robots: "The site asks not to be read",
  strike: "Failed",
  superseded: "Skipped",
  judged_quiet: "AI held it back",
  passed: "Passed on",
  held_stock: "Out of stock, held back",
};

/** A check's outcome in words: "Told you", "AI held it back", "Passed on". */
export function checkOutcomeLabel(outcome: CheckOutcome | (string & {})): string {
  return OUTCOME_LABELS[outcome as CheckOutcome] ?? outcome;
}

const TRIGGER_LABELS: Record<CheckTrigger, string> = {
  schedule: "On schedule",
  wake: "After a wake",
  run_now: "Check now",
  ask: "Asked in chat",
  pass: "Passed on",
};

/** What started a check: "On schedule", "Check now", "Passed on". */
export function checkTriggerLabel(trigger: CheckTrigger | (string & {})): string {
  return TRIGGER_LABELS[trigger as CheckTrigger] ?? trigger;
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

/**
 * The board's column count for its content width. A standard card needs
 * about 300 px for its health line, so 4 columns start at 1240 px; 6 only
 * on very wide screens, where 4 cards would stretch past 550 px.
 */
export function boardColumns(width: number): number {
  if (width < 560) return 1;
  if (width < 1240) return 2;
  if (width < 2200) return 4;
  return 6;
}

/** How many columns a wide (Needs you) card spans. */
export function wideSpan(cols: number): number {
  if (cols >= 6) return 3;
  return Math.min(2, cols);
}

export type GridItem = "card" | "wide" | "add";

/**
 * Each item's column span, so that no row of a section ends in a hole: a row
 * an item does not fit in, and the last row, share their spare columns among
 * their items, one at a time to the narrowest, so no single card stretches
 * across the rest of the row; the add tile takes the rest of its row (a full row
 * when its row is otherwise full).
 */
export function fillSpans(items: GridItem[], cols: number): number[] {
  const spans: number[] = [];
  let row: number[] = [];
  let pos = 0;
  const close = () => {
    for (let spare = cols - pos; spare > 0 && row.length; spare--) {
      // The narrowest item first, the first of those on a tie.
      const k = row.reduce((a, b) => (spans[b] < spans[a] ? b : a));
      spans[k]++;
    }
    row = [];
    pos = 0;
  };
  items.forEach((item, i) => {
    if (item === "add") {
      spans[i] = pos > 0 ? cols - pos : cols;
      row = [];
      pos = 0;
      return;
    }
    const span = Math.min(item === "wide" ? wideSpan(cols) : 1, cols);
    if (pos + span > cols) close();
    spans[i] = span;
    row.push(i);
    pos += span;
    if (pos === cols) {
      row = [];
      pos = 0;
    }
  });
  if (pos > 0) close();
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

// ── Price history ──

/** One price watch of a bot, as the rail, the phone sheet and a doc's price block draw it. */
export type PriceHistoryModel = {
  watchId: string;
  /** The symbol, or the site (watchTitle when neither): the watch picker's label. */
  label: string;
  /** The bot has two or more price-reading watches. */
  multiple: boolean;
  currency: string;
  value: number | null;
  /** Daily closes as [unixSeconds, value], oldest first, then the newest reading when it is newer. */
  points: [number, number][];
  /** The line the watch's first below/above rule draws. */
  threshold: number | null;
  low: number | null;
  /** "Oct 29". */
  lowDay: string | null;
  changePct: number | null;
  /** "Oct 9". */
  since: string | null;
  /** The change is the way the rule wants (down for below, up for above). */
  good: boolean;
  /** The line after "Now · ": "₹2,499 above your line". */
  under: string | null;
  /** The bot is paused, or Pause all is on (`allPaused`). */
  paused: boolean;
};

/**
 * One price watch of a bot: the picked one, else its first price-reading
 * watch. Null when the bot reads no price.
 */
export function priceHistory(detail: BotDetail, watchId?: string, opts: { allPaused?: boolean } = {}): PriceHistoryModel | null {
  const watches = detail.watches.filter(isPriceReading);
  if (!watches.length) return null;
  const w = watches.find((x) => x.id === watchId) ?? watches[0];
  const points = priceSeries(detail.prices, w.id);
  // The newest reading after the last daily close is "now".
  if (w.value != null && w.lastReadingAt) {
    const at = Math.floor(Date.parse(w.lastReadingAt) / 1000);
    if (!points.length || at > points[points.length - 1][0]) points.push([at, w.value]);
  }
  const stats = priceStats(detail.prices, w.id);
  const rule = w.rules.find((r) => r.kind === "below" || r.kind === "above");
  const good = stats?.changePct != null && rule ? (rule.kind === "below" ? stats.changePct < 0 : stats.changePct > 0) : false;
  return {
    watchId: w.id,
    label: (w.kind === "price" ? w.symbol : w.site) || watchTitle(w),
    multiple: watches.length > 1,
    currency: watchCurrency(w),
    value: w.value,
    points,
    threshold: lineOf(w),
    low: stats?.low ?? null,
    lowDay: stats?.lowDay ?? null,
    changePct: stats?.changePct ?? null,
    since: stats?.since ?? null,
    good,
    under: valueLine({ ...detail, watches: [w] }),
    paused: detail.status === "paused" || !!opts.allPaused,
  };
}

/** The words of a doc's price block. */
export const PRICE_BLOCK = {
  deleted: "Bot deleted",
  deletedHint: "Its price history went with it.",
  noPrice: "This bot doesn’t watch a price",
  failed: "Couldn’t load this bot’s prices",
  open: "Open bot",
  empty: "The line fills in after a few days of checks",
  pick: "Add a price chart",
  pickEmpty: "No bot watches a price yet.",
} as const;

/**
 * The price-bot picker's note on a row, in the board's status words: "Paused"
 * for a bot the person paused, "Waiting for your OK" for one an outside app
 * made (its value already says "Starts paused"), nothing for an active bot.
 */
export function priceBlockPickMeta(bot: Pick<BotView, "status" | "pauseReason">): string | undefined {
  if (bot.status !== "paused") return undefined;
  return bot.pauseReason === "mcp" ? "Waiting for your OK" : "Paused";
}

/** A Live block that draws a bot's price history: a Panel named after the bot holding PriceHistory. */
export function priceBlockProgram(bot: { id: string; name: string }, watchId?: string): string {
  const watch = watchId ? `, ${JSON.stringify(watchId)}` : "";
  return `root = Panel(${JSON.stringify(bot.name)}, [chart])\nchart = PriceHistory(${JSON.stringify(bot.id)}${watch})`;
}

/** "₹30k", "₹27.5k", "$68.4k", "$182": an axis label, short. */
export function axisMoney(v: number, currency: string): string {
  const unit = formatMoney(1, currency);
  const before = unit.startsWith("1") ? "" : unit.slice(0, unit.indexOf("1"));
  const after = unit.startsWith("1") ? unit.slice(1) : "";
  const a = Math.abs(v);
  let n: string;
  if (a >= 1_000_000) n = `${Number((a / 1_000_000).toFixed(1))}M`;
  else if (a >= 1000) n = `${Number((a / 1000).toFixed(1))}k`;
  else n = `${Number(a.toFixed(a < 10 ? 2 : 0))}`;
  return `${v < 0 ? "-" : ""}${before}${n}${after}`;
}

/** Round gridline values inside [lo, hi]: two to four of them. */
export function niceTicks(lo: number, hi: number): number[] {
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  const power = 10 ** Math.floor(Math.log10(span / 2));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * power).find((s) => span / s <= 3) ?? 10 * power;
  const ticks: number[] = [];
  // A huge price with a tiny span: past 2^53 a step can be under the value's
  // float spacing, so `t += step` stops moving. Stop there, and never draw more than 8.
  for (let t = Math.ceil(lo / step) * step; t <= hi && ticks.length < 8; t += step) {
    ticks.push(t);
    if (t + step === t) break;
  }
  return ticks;
}

/** A price chart's value range: the points and the line, padded by 8% (2% of a flat value, else 1), and its gridlines. */
export function priceDomain(points: [number, number][], threshold: number | null): { lo: number; hi: number; ticks: number[] } {
  const values = points.map(([, v]) => v);
  if (threshold != null) values.push(threshold);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.02 || 1;
  const lo = min - pad;
  const hi = max + pad;
  return { lo, hi, ticks: niceTicks(lo, hi) };
}

/** Where a price chart's parts go in a box: what an SVG needs when React does not draw it. */
export type PriceChartGeometry = {
  /** SVG path data. */
  line: string;
  area: string;
  thresholdY: number | null;
  low: { x: number; y: number; value: number };
  last: { x: number; y: number; value: number };
  grid: { y: number; value: number }[];
  /** The first day, the middle day (three points or more) and "Today". */
  xLabels: { x: number; label: string; anchor: PriceDayLabel["anchor"] }[];
};

export type PriceDayLabel = { t: number; label: string; anchor: "start" | "middle" | "end" };

/**
 * The days under a price chart: the first, the middle and "Today". Daily
 * closes sit at UTC midnight, so their days are UTC days, as priceStats words
 * `since`. Under three points the middle would be the first again, so it is
 * left out.
 */
export function priceDayLabels(points: [number, number][]): PriceDayLabel[] {
  if (!points.length) return [];
  const day = (t: number) => shortDate(new Date(t * 1000).toISOString(), "UTC");
  const last = points.length - 1;
  const t0 = points[0][0];
  const labels: PriceDayLabel[] = [{ t: t0, label: day(t0), anchor: "start" }];
  if (points.length >= 3) {
    const mid = points[Math.floor(last / 2)][0];
    labels.push({ t: mid, label: day(mid), anchor: "middle" });
  }
  labels.push({ t: points[last][0], label: "Today", anchor: "end" });
  return labels;
}

/**
 * A price chart laid out in a box of `width` × `height`, with `left` for the
 * axis labels and `bottom` for the days: the same line, area, gridlines,
 * low and newest points as the Bots page's chart. Null under two points.
 */
export function priceChartGeometry(
  points: [number, number][],
  threshold: number | null,
  box: { width: number; height: number; left: number; right: number; top: number; bottom: number },
): PriceChartGeometry | null {
  if (points.length < 2) return null;
  const { lo, hi, ticks } = priceDomain(points, threshold);
  const plotW = Math.max(0, box.width - box.left - box.right);
  const plotH = Math.max(0, box.height - box.bottom - box.top);
  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  const x = (t: number) => box.left + (t1 > t0 ? ((t - t0) / (t1 - t0)) * plotW : plotW / 2);
  const y = (v: number) => box.top + (1 - (v - lo) / (hi - lo || 1)) * plotH;
  const line = points.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const base = box.top + plotH;
  const area = `${line} L${x(t1).toFixed(1)} ${base} L${x(t0).toFixed(1)} ${base} Z`;
  let low = 0;
  points.forEach(([, v], i) => {
    if (v < points[low][1]) low = i;
  });
  const last = points.length - 1;
  return {
    line,
    area,
    thresholdY: threshold != null ? y(threshold) : null,
    low: { x: x(points[low][0]), y: y(points[low][1]), value: points[low][1] },
    last: { x: x(t1), y: y(points[last][1]), value: points[last][1] },
    grid: ticks.map((value) => ({ y: y(value), value })),
    xLabels: priceDayLabels(points).map(({ t, label, anchor }) => ({ x: x(t), label, anchor })),
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

/** A starter's draft; its description is the starter's own words, so the New bot editor opens with them. */
const draftOfStarter = (name: string, description: string, interval: number, watch: WatchInput): BotInput => ({
  name,
  description,
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
    draft: draftOfStarter("", "Tell me when this product drops under a price.", 360, { kind: "page", url: "", read: "product_price", rules: [{ kind: "below" }] }),
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
    draft: draftOfStarter("", "Tell me when this part of a page changes.", 30, { kind: "page", url: "", read: "selector", selector: "", rules: [{ kind: "any_change" }] }),
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
    draft: draftOfStarter("NVDA moves 5% in a day", "Tell me if NVDA moves more than 5% in a day.", 0, {
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
    draft: draftOfStarter("", "Tell me about new posts in this feed.", 0, { kind: "feed", url: "", rules: [{ kind: "new_item" }] }),
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
    chatText: "Every morning at 08:00, sum up what my other bots found",
    draft: {
      name: "Morning brief",
      description: "Each morning, sum up what my other bots found.",
      intervalMinutes: 1440,
      kind: "brief",
      briefTime: "08:00",
      briefAi: false,
      sources: [],
      watches: [],
    },
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
  if (r.onlyInStock === false) out.onlyInStock = false;
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
  if (draft.kind === "brief") {
    const n = (draft.sources ?? []).length;
    if (n === 0) out.push("Pick at least one bot to sum up");
    else if (n > BOT_LIMITS.maxBriefSources) out.push(`Pick 1 to ${BOT_LIMITS.maxBriefSources} bots for the brief to sum up`);
    return out;
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

/** Pass to links ready to send: filter words trimmed, empties dropped. */
const cleanLinks = (links: LinkInput[]): LinkInput[] =>
  links.map((l) => {
    const out: LinkInput = { botId: l.botId, filter: (l.filter ?? []).map((w) => w.trim()).filter(Boolean) };
    if (l.id) out.id = l.id;
    if (l.enabled !== undefined) out.enabled = l.enabled;
    return out;
  });

/** A draft ready for `POST /bots`. A brief sends no watches. */
export function toInput(draft: BotInput): BotInput {
  const brief = draft.kind === "brief";
  const out: BotInput = {
    name: draft.name.replace(/\s+/g, " ").trim(),
    description: draft.description.trim(),
    intervalMinutes: draft.intervalMinutes || 0,
    watches: brief ? [] : draft.watches.map(cleanWatchInput),
  };
  if (draft.kind) out.kind = draft.kind;
  if (draft.judgeMode) out.judgeMode = draft.judgeMode;
  for (const k of ["urgent", "desktop", "phone"] as const) if (draft[k] !== undefined) out[k] = draft[k];
  if (draft.knowledge !== undefined) out.knowledge = draft.knowledge ? { kind: draft.knowledge.kind, id: draft.knowledge.id } : null;
  if (draft.passesTo) out.passesTo = cleanLinks(draft.passesTo);
  if (draft.sources) out.sources = [...draft.sources];
  for (const k of ["briefOnly", "briefAi"] as const) if (draft[k] !== undefined) out[k] = draft[k];
  if (draft.briefTime) out.briefTime = draft.briefTime;
  return out;
}

/** A bot's saved Pass to links as inputs, oldest first. */
function savedPasses(botId: string, links: LinkView[]): LinkInput[] {
  return links
    .filter((l) => l.kind === "pass" && l.fromBotId === botId)
    .map((l) => ({ id: l.id, botId: l.toBotId, filter: [...l.filter], enabled: l.enabled }));
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

/**
 * A saved bot as an editable draft. With its links (`BotDetail.links`) the
 * draft also holds its Pass to links; without them it leaves them as they are.
 */
export function draftOf(view: BotView, links?: LinkView[] | null): BotInput {
  const draft: BotInput = {
    name: view.name,
    description: view.description,
    intervalMinutes: view.intervalMinutes,
    judgeMode: view.judgeMode,
    urgent: view.urgent,
    desktop: view.desktop,
    phone: view.phone,
    watches: view.watches.map(watchInputOf),
    kind: view.kind ?? "watch",
    knowledge: view.knowledge ? { kind: view.knowledge.kind, id: view.knowledge.id } : null,
    briefOnly: !!view.briefOnly,
  };
  if (links) draft.passesTo = savedPasses(view.id, links);
  if (isBrief(view)) {
    draft.sources = [...sourcesOf(view)];
    draft.briefAi = !!view.briefAi;
    draft.briefTime = view.briefTime || DEFAULT_BRIEF_TIME;
  }
  return draft;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The edit that turns a saved bot into the draft: only what changed ({} when
 * nothing did). The kind never changes. `passesTo` is compared with the
 * bot's saved links (`BotDetail.links`) and sent only when they differ.
 */
export function toPatch(view: BotView, draft: BotInput, links?: LinkView[] | null): BotPatch {
  const next = toInput(draft);
  const patch: BotPatch = {};
  const brief = isBrief(view);
  if (next.name !== view.name) patch.name = next.name;
  if (next.description !== view.description) patch.description = next.description;
  if (!brief && next.intervalMinutes && next.intervalMinutes !== view.intervalMinutes) patch.intervalMinutes = next.intervalMinutes;
  if (next.judgeMode && next.judgeMode !== (view.judgeMode || "rules")) patch.judgeMode = next.judgeMode;
  for (const k of ["urgent", "desktop", "phone"] as const) {
    if (next[k] !== undefined && next[k] !== view[k]) patch[k] = next[k];
  }
  if (!brief) {
    const saved = view.watches.map((w) => cleanWatchInput(watchInputOf(w)));
    if (!same(saved, next.watches)) patch.watches = next.watches;
  }
  if (next.knowledge !== undefined) {
    const was = view.knowledge ? { kind: view.knowledge.kind, id: view.knowledge.id } : null;
    if (!same(was, next.knowledge)) patch.knowledge = next.knowledge;
  }
  if (next.passesTo && !same(cleanLinks(savedPasses(view.id, links ?? [])), next.passesTo)) patch.passesTo = next.passesTo;
  if (next.sources && !same(sourcesOf(view), next.sources)) patch.sources = next.sources;
  if (next.briefOnly !== undefined && next.briefOnly !== !!view.briefOnly) patch.briefOnly = next.briefOnly;
  if (next.briefAi !== undefined && next.briefAi !== !!view.briefAi) patch.briefAi = next.briefAi;
  if (next.briefTime && next.briefTime !== (view.briefTime || "")) patch.briefTime = next.briefTime;
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
  const brief = args.kind === "brief";
  const read = preview?.watches ?? [];
  const ok = read.some((p) => p.ok);
  const watches: WatchView[] = (brief ? [] : (args.watches ?? [])).map((w, i) => {
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
      readingCurrency: p?.ok ? p.currency : "",
      rules: (w.rules ?? []).map(fieldsOf),
      health: p && !p.ok && p.health ? p.health : { code: "new", line: "" },
      lastReadingAt: p?.ok ? p.at : null,
      summary: p?.ok ? p.summary : "",
      availability: p?.ok ? (p.availability ?? "") : "",
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
    judgeMode: args.judgeMode === "ai" ? "ai" : "rules",
    intervalMinutes: brief ? 1440 : args.intervalMinutes || defaultMinutes(watches),
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
    kind: brief ? "brief" : "watch",
    briefOnly: !!args.briefOnly,
    briefAi: brief && !!args.briefAi,
    briefTime: brief ? args.briefTime || DEFAULT_BRIEF_TIME : "",
    sources: brief ? [...(args.sources ?? [])] : [],
    knowledge: null,
    aiChecksToday: 0,
    suggestion: null,
    away: null,
  };
}

/** The rows beside a proposal's card: First check, Then, At most (and AI checks); a brief's Sends. */
export function proposalFacts(args: BotInput): [string, string][] {
  if (args.kind === "brief") return [["Sends", `Daily at ${args.briefTime || DEFAULT_BRIEF_TIME}`]];
  const every = args.intervalMinutes || defaultMinutes(args.watches ?? []);
  const rows: [string, string][] = [
    ["First check", "On approve"],
    ["Then", `Every ${intervalLabel(every).replace(/^1 /, "")}`],
    ["At most", `${BOT_LIMITS.alertsPerDay} alerts a day`],
  ];
  if (args.judgeMode === "ai") rows.push(["AI checks", `Up to ${BOT_LIMITS.aiPerBot} a day`]);
  return rows;
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

/** How many bots one message may tag (the server's maxBotTags). */
export const MAX_BOT_TAGS = 3;

/**
 * The bots the @-picker offers for what was typed after "@": names that start
 * with it first, then names with a word that starts with it, then names that
 * hold it anywhere, each in the order given. Bots already tagged are left out,
 * and none are offered once the query is a bot's whole name and a space.
 */
export function botTagMatches<T extends { id: string; name: string }>(
  bots: T[] | null | undefined,
  query: string,
  tagged: string[] = [],
  limit = 8,
): T[] {
  const q = query.trimStart().toLowerCase();
  // "@Name " is already a whole tag: the list closes rather than offering the
  // longer names that start with it ("Bitcoin weekly" after "Bitcoin").
  const done = q.trimEnd();
  if (done !== q && (bots ?? []).some((bot) => bot.name.trim().toLowerCase() === done)) return [];
  const ranked: { bot: T; rank: number }[] = [];
  for (const bot of bots ?? []) {
    if (tagged.includes(bot.id)) continue;
    const name = bot.name.toLowerCase();
    const at = q ? name.indexOf(q) : 0;
    if (at < 0) continue;
    const rank = at === 0 ? 0 : name.split(/\s+/).some((word) => word.startsWith(q)) ? 1 : 2;
    ranked.push({ bot, rank });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((r) => r.bot);
}

/**
 * Picking a bot in the @-picker: the "@query" from `start` to the caret
 * becomes "@Name " (no second space when one follows), and the caret moves
 * after it.
 */
export function insertBotTag(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const end = Math.max(start, Math.min(caret, text.length));
  const after = text.slice(end);
  const tag = `@${name}`;
  const spaced = /^\s/.test(after) ? tag : `${tag} `;
  return { text: text.slice(0, start) + spaced + after, caret: start + tag.length + 1 };
}

const TAG_CLOSE = ",.:;?!";

/** Where `name` ends when the text holds it at `at` (any case) followed by the end, whitespace or a closing mark; -1 when not. */
function tagNameEnd(text: string, at: number, name: string): number {
  let i = at;
  for (const want of name) {
    if (i >= text.length) return -1;
    const got = String.fromCodePoint(text.codePointAt(i)!);
    if (got !== want && got.toLowerCase() !== want.toLowerCase() && got.toUpperCase() !== want.toUpperCase()) return -1;
    i += got.length;
  }
  if (i === text.length) return i;
  const next = String.fromCodePoint(text.codePointAt(i)!);
  return /\s/u.test(next) || TAG_CLOSE.includes(next) ? i : -1;
}

/**
 * Every "@Name" tag in the text, as the server's tagBots reads one: "@" at the
 * start or after whitespace, then one of `names` in any case (the longest that
 * fits wins), then the end, whitespace or one of , . : ; ? !. In order, with
 * each tag's span from its "@" to the end of the name.
 */
export function botTagSpans(text: string, names: string[]): { name: string; start: number; end: number }[] {
  const sorted = names
    .filter((n) => n.trim() !== "")
    .map((n, i) => ({ n, i, len: Array.from(n).length }))
    .sort((a, b) => b.len - a.len || a.i - b.i)
    .map((x) => x.n);
  const spans: { name: string; start: number; end: number }[] = [];
  let afterSpace = true;
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    if (ch !== "@" || !afterSpace) {
      afterSpace = /\s/u.test(ch);
      i += ch.length;
      continue;
    }
    afterSpace = false;
    let end = -1;
    let hit = "";
    for (const name of sorted) {
      end = tagNameEnd(text, i + 1, name);
      if (end >= 0) {
        hit = name;
        break;
      }
    }
    if (end < 0) {
      i += 1;
      continue;
    }
    spans.push({ name: hit, start: i, end });
    i = end;
  }
  return spans;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The bots the text tags, each once, in order (the server's tagBots without
 * its limit). `skip` leaves out the tag whose "@" is there, such as the one
 * still being typed.
 */
export function textBotTags<T extends { id: string; name: string }>(
  text: string,
  bots: T[],
  skip = -1,
): T[] {
  const out: T[] = [];
  for (const span of botTagSpans(text, bots.map((b) => b.name))) {
    if (span.start === skip) continue;
    const bot = bots.find((b) => sameName(b.name, span.name));
    if (bot && !out.some((b) => b.id === bot.id)) out.push(bot);
  }
  return out;
}

/**
 * Whether the text still tags `name` as the server reads it. `names` are the
 * other bots' names, so "@Bitcoin weekly" tags "Bitcoin weekly", not "Bitcoin".
 */
export function hasBotTag(text: string, name: string, names: string[] = []): boolean {
  return botTagSpans(text, [name, ...names]).some((span) => sameName(span.name, name));
}

/** Removing a picked bot's chip takes its first "@Name" tag (and one space after it) out of the text. */
export function removeBotTag(text: string, name: string, names: string[] = []): string {
  const span = botTagSpans(text, [name, ...names]).find((s) => sameName(s.name, name));
  if (!span) return text;
  const end = text[span.end] === " " ? span.end + 1 : span.end;
  return text.slice(0, span.start) + text.slice(end);
}

const WAIT_CODES = new Set(["offline", "rate_limited", "waiting", "robots"]);

/** The dot beside a tagged bot's answer: off when paused, bad when broken, primary while its check runs. */
export function answerTone(answer: Pick<BotAnswer, "bot" | "fresh">): HealthTone {
  if (answer.fresh === "paused" || answer.bot.status === "paused") return "off";
  if (STRIKES.has(answer.bot.health.code)) return "bad";
  if (answer.fresh === "waiting") return "primary";
  if (WAIT_CODES.has(answer.bot.health.code)) return "warn";
  return "ok";
}

/** What an answer's watch gives the logo tile: its site, or a price's symbol from its title ("BTC-USD · Coinbase"). */
export function answerMarkWatch(w: Pick<AnswerWatch, "kind" | "site" | "title">): {
  kind: WatchKind;
  site: string;
  symbol: string;
} {
  return { kind: w.kind, site: w.site, symbol: w.kind === "price" ? w.title.split(" · ")[0] : "" };
}

/** A watch row's second line in an answer: the excerpt, else the newest item's title. */
export function answerWatchMeta(w: Pick<AnswerWatch, "excerpt" | "items">): string {
  return w.excerpt || w.items?.[0]?.title || "";
}
