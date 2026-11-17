"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Pause,
  Play,
  Plug,
} from "lucide-react";
import {
  agoLabel,
  briefClock,
  clockLabel,
  draftErrors,
  draftOf,
  floorMinutes,
  healthLine,
  needsReason,
  originLine,
  toInput,
  cleanWatchInput,
  type BotDetail,
  type BotInput,
  type BotPatch,
  type BotView,
  type WatchInput,
} from "@timely/contract/bots";
import { refusalMessage } from "@timely/contract/autosaveQueue";
import Button from "@/app/_components/_ui/button";
import SaveStatusBadge from "@/app/_components/_ui/saveStatus";
import { SkeletonCards } from "@/app/_components/_ui/skeleton";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import {
  useBot,
  useBotIcons,
  useBots,
  usePauseBot,
  useResumeBot,
  useSourceKeys,
  useUpdateBot,
} from "@/app/utils/hooks/bots";
import { useAutosave } from "@/app/utils/hooks/useAutosave";
import { assistantHref } from "@timely/contract/assistant";
import { AgentBotPanel } from "./agentBotPanel";
import { isAgentBot } from "./agentBot";
import { NewBotThread } from "./agentStarters";
import { SwitchToAgentCard } from "./switchToAgentCard";
import { BotEditor, type EditHow, type EditorErrors } from "./botEditor";
import { BotMark, botSites } from "./botMark";
import {
  Chip,
  CloseButton,
  NameField,
  PanelBody,
  PanelFrame,
  PanelNotice,
  TONE_CHIP,
  descClass,
  escapeCloses,
} from "./panelParts";
import { BotRail } from "./botRail";
import { RunNowButton } from "./runNowButton";
import { SnoozeMenu } from "./snoozeMenu";

const say = (message: string) => useToastStore.getState().show(message);

type PanelErrors = EditorErrors & { head?: ReactNode };

/** Which group a sentence from draftErrors (or the API) belongs under. */
function errorGroup(message: string): keyof PanelErrors {
  if (/name|description/i.test(message)) return "head";
  // Pass to links: "A bot can pass to up to 4 bots", "…in a circle", "A chain can be…", "Up to 5 filter words".
  if (/pass|circle|chain|filter words/i.test(message)) return "links";
  if (/brief|sum up/i.test(message)) return "brief";
  if (/checked every|at least once a week/i.test(message)) return "schedule";
  if (
    /price to watch for|percent it should move|words to look for|does not fit|rules/i.test(
      message,
    )
  )
    return "rules";
  return "watches";
}

function groupErrors(messages: string[]): PanelErrors {
  const out: PanelErrors = {};
  for (const m of messages) {
    const g = errorGroup(m);
    out[g] ??= m;
  }
  return out;
}

/** A watch without its rules: what it reads and where, to tell a watch edit from a rules edit. */
const watchShape = (w: WatchInput) =>
  JSON.stringify({ ...cleanWatchInput(w), rules: undefined });

/** The group a refused edit is shown under, by the fields it changed. */
function patchGroup(patch: BotPatch, saved: WatchInput[]): keyof PanelErrors {
  if (patch.watches) {
    const moved =
      patch.watches.length !== saved.length ||
      patch.watches.some((w, i) => watchShape(w) !== watchShape(saved[i]));
    return moved ? "watches" : "rules";
  }
  if ("passesTo" in patch || "briefOnly" in patch) return "links";
  if ("sources" in patch || "briefTime" in patch || "briefAi" in patch)
    return "brief";
  if ("intervalMinutes" in patch) return "schedule";
  if ("judgeMode" in patch || "knowledge" in patch) return "rules";
  if ("urgent" in patch || "desktop" in patch || "phone" in patch)
    return "alerts";
  return "head";
}

const PATCH_KEYS = [
  "name",
  "description",
  "intervalMinutes",
  "judgeMode",
  "knowledge",
  "urgent",
  "desktop",
  "phone",
  "watches",
  "passesTo",
  "sources",
  "briefOnly",
  "briefAi",
  "briefTime",
] as const;

/** What changed between what was last sent and the edited draft (both from toInput). */
function diffInput(base: BotInput, next: BotInput): BotPatch {
  const patch: BotPatch = {};
  for (const k of PATCH_KEYS) {
    if (JSON.stringify(base[k]) === JSON.stringify(next[k])) continue;
    if (k === "intervalMinutes" && !next.intervalMinutes) continue;
    (patch as Record<string, unknown>)[k] = next[k];
  }
  return patch;
}

/** The fields a problem from draftErrors holds back; the rest of the edit still saves. */
function heldKeys(problems: string[]): Set<keyof BotInput> {
  const held = new Set<keyof BotInput>();
  for (const m of problems) {
    const g = errorGroup(m);
    if (g === "head") held.add(/description/i.test(m) ? "description" : "name");
    else if (g === "links") held.add("passesTo");
    else if (g === "brief") held.add("sources");
    else if (g === "schedule") {
      // The floor comes from the watches, so neither side is sent.
      held.add("intervalMinutes");
      held.add("watches");
    } else held.add("watches");
  }
  return held;
}

/**
 * "Stock prices need your free Finnhub key", but only for a stock watch that
 * is new or now follows another symbol: a saved watch whose key went away
 * keeps its place (the bot shows needs_key), so its other edits still save.
 */
function keyErrors(
  next: BotInput,
  base: BotInput,
  hasKey: (source: string) => boolean,
): string[] {
  if (hasKey("finnhub")) return [];
  const out: string[] = [];
  next.watches.forEach((raw, i) => {
    if (raw.kind !== "price") return;
    const w = cleanWatchInput(raw);
    if (w.source !== "stock" && w.source !== "finnhub") return;
    const was = w.id ? base.watches.find((b) => b.id === w.id) : undefined;
    if (was && was.source === w.source && was.symbol === w.symbol) return;
    const name = next.watches.length > 1 ? `Watch ${i + 1}: ` : "";
    out.push(`${name}Stock prices need your free Finnhub key`);
  });
  return out;
}

/** A bot as an editable draft, with its Pass to links once its page has loaded them. */
const draftOfBot = (bot: BotView | BotDetail) =>
  draftOf(bot, "links" in bot ? bot.links : undefined);

/** Whether a keyed price source has a saved key; unknown (still loading) counts as yes. */
function useHasKey() {
  const keys = useSourceKeys().data;
  return (source: string) =>
    !keys || keys.some((k) => k.source === source && k.keySet);
}

/** "shop pages wait 6 h": why Check now waits, from the bot's floor. */
function waitWords(bot: BotView): string {
  const floor = floorMinutes(bot.watches);
  if (floor >= 360) return "shop pages wait 6 h";
  if (floor >= 15) return "pages wait 15 min";
  return "prices wait 5 min";
}

/** Asks before a touched new bot is dropped. */
export function confirmDiscardNew(discard: () => void) {
  requestConfirm({
    title: "Discard this new bot?",
    description: "What you set up here is not kept.",
    confirmLabel: "Discard",
    onConfirm: discard,
  });
}

/** Asks before edits that could not save yet (an open watch, a half-made rule) are dropped. */
export function confirmDiscardEdits(discard: () => void) {
  requestConfirm({
    title: "Discard changes that are not finished?",
    description:
      "A watch or rule you were still setting up is not saved. Everything else already is.",
    confirmLabel: "Discard",
    onConfirm: discard,
  });
}

/** What an open panel holds that would be lost: a new bot's draft, or an open bot's unfinished edits. */
export type Unfinished = "new" | "edit" | null;

/** Runs go, asking first when the panel holds something unfinished. */
export function leaveUnfinished(unfinished: Unfinished, go: () => void) {
  if (unfinished === "new") confirmDiscardNew(go);
  else if (unfinished === "edit") confirmDiscardEdits(go);
  else go();
}

/** Tells the page what the panel holds, and forgets it when the panel goes. */
function useReportUnfinished(
  unfinished: Unfinished,
  report?: (unfinished: Unfinished) => void,
) {
  const reportRef = useRef(report);
  useEffect(() => {
    reportRef.current = report;
  });
  useEffect(() => {
    reportRef.current?.(unfinished);
  }, [unfinished]);
  useEffect(() => () => reportRef.current?.(null), []);
}

// ── An open bot ──

function EditPanel({
  bot,
  detail,
  order,
  now,
  focusOn,
  onClose,
  onSelect,
  onUnfinished,
}: {
  bot: BotView | BotDetail;
  detail?: BotDetail;
  order: string[];
  now: Date;
  /** What takes focus when the panel opens: the Previous or Next button pressed to get here, or the panel. */
  focusOn: "prev" | "next" | "panel";
  onClose: () => void;
  onSelect: (id: string, via?: "prev" | "next") => void;
  onUnfinished?: (unfinished: Unfinished) => void;
}) {
  const update = useUpdateBot();
  const pause = usePauseBot();
  const resume = useResumeBot();
  const hasKey = useHasKey();
  const allPaused = !!useBots().data?.summary.allPaused;
  const icons = useBotIcons(
    useMemo(() => botSites(bot.watches), [bot.watches]),
  ).data;
  const [draft, setDraft] = useState<BotInput>(() => draftOfBot(bot));
  const [base, setBase] = useState<BotInput>(() => toInput(draftOfBot(bot)));
  const [errors, setErrors] = useState<PanelErrors>({});
  const [refused, setRefused] = useState<PanelErrors>({});
  const [watchDirty, setWatchDirty] = useState(false);
  const frameRef = useRef<HTMLElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const botRef = useRef(bot);
  useEffect(() => {
    botRef.current = bot;
  });

  const autosave = useAutosave<BotPatch>(
    (patch) => update.mutateAsync({ id: bot.id, patch }),
    600,
    {
      onRejected: (error, patch) => {
        // The server refused it: show why under its group and put the saved values back.
        const saved = draftOfBot(botRef.current);
        const keys = Object.keys(patch) as (keyof BotInput)[];
        const back = Object.fromEntries(
          keys.map((k) => [k, saved[k]]),
        ) as Partial<BotInput>;
        const savedInput = toInput(saved);
        const backInput = Object.fromEntries(
          keys.map((k) => [k, savedInput[k]]),
        ) as Partial<BotInput>;
        setDraft((d) => ({ ...d, ...back }));
        setBase((b) => ({ ...b, ...backInput }));
        // Link and brief refusals ("…in a circle") show under their own
        // group whatever else the edit held.
        const said = errorGroup(error instanceof Error ? error.message : "");
        setRefused({
          [said === "links" || said === "brief"
            ? said
            : patchGroup(patch, savedInput.watches)]: refusalMessage(error),
        });
      },
    },
  );

  // A check or another device changed the bot: follow it unless an edit is on
  // its way, or failed on the way and waits for Retry.
  const [synced, setSynced] = useState(bot);
  if (bot !== synced) {
    setSynced(bot);
    const busy =
      autosave.status === "saving" ||
      autosave.status === "unsaved" ||
      autosave.status === "error" ||
      JSON.stringify(toInput(draft)) !== JSON.stringify(base);
    if (!busy) {
      // Follow the server, but keep the typed name and description when
      // they save as the same words: a trailing space or line break is
      // still being typed, not a change to undo.
      const fresh = draftOfBot(bot);
      const mine = toInput(draft);
      const theirs = toInput(fresh);
      setDraft({
        ...fresh,
        name: mine.name === theirs.name ? draft.name : fresh.name,
        description:
          mine.description === theirs.description
            ? draft.description
            : fresh.description,
      });
      setBase(theirs);
    }
  }

  // Edits that could not save yet: an open watch with changes, or fields a
  // half-made rule holds back. Closing or moving on asks first.
  const unfinished: Unfinished =
    watchDirty || JSON.stringify(toInput(draft)) !== JSON.stringify(base)
      ? "edit"
      : null;
  useReportUnfinished(unfinished, onUnfinished);
  const leave = (go: () => void) => leaveUnfinished(unfinished, go);

  // Focus moves into the panel when it opens, so Escape and Tab work at
  // once; after Previous or Next it stays on that button (or the other one
  // when the end is reached).
  useEffect(() => {
    const target =
      focusOn === "panel"
        ? frameRef.current
        : [focusOn === "prev" ? prevRef : nextRef, prevRef, nextRef]
            .map((r) => r.current)
            .find((b) => b && !b.disabled);
    (target ?? frameRef.current)?.focus({ preventScroll: true });
    // Only when this bot's panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (next: BotInput, how: EditHow) => {
    setDraft(next);
    setRefused({});
    // The key check is for watches that change; a problem holds back only
    // the fields it is about, so a half-made rule does not stop a rename.
    const problems = [...draftErrors(next), ...keyErrors(next, base, hasKey)];
    setErrors(groupErrors(problems));
    const input = toInput(next);
    const patch = diffInput(base, input);
    for (const k of heldKeys(problems)) delete patch[k as keyof BotPatch];
    const keys = Object.keys(patch) as (keyof BotInput)[];
    if (keys.length === 0) return;
    setBase({
      ...base,
      ...Object.fromEntries(keys.map((k) => [k, input[k]])),
    });
    if (how === "text") autosave.schedule(patch);
    else void autosave.saveNow(patch);
  };

  const shown: PanelErrors = { ...errors, ...refused };
  const index = order.indexOf(bot.id);
  const prev = index > 0 ? order[index - 1] : null;
  const next = index >= 0 && index < order.length - 1 ? order[index + 1] : null;
  const reason = needsReason(bot, now);
  const health = healthLine(bot, now, undefined, { allPaused });
  const origin = originLine(bot);
  const cooling = bot.runNowAt && Date.parse(bot.runNowAt) > now.getTime();
  const status = Object.keys(errors).length ? "unsaved" : autosave.status;

  const act = (kind: "pause" | "resume" | "turn_on") => {
    const m = kind === "pause" ? pause : resume;
    m.mutate(bot.id, {
      onSuccess: () =>
        say(
          kind === "pause"
            ? `${bot.name} is paused`
            : kind === "turn_on"
              ? `${bot.name} is on`
              : `${bot.name} is watching again`,
        ),
      onError: (error) => say(error.message),
    });
  };

  return (
    <PanelFrame
      label={bot.name}
      frameRef={frameRef}
      onKeyDown={escapeCloses(() => leave(onClose))}
    >
      <header className="@container/head relative z-20 shrink-0 border-b border-border bg-card pb-4 pl-6 pr-5 pt-4">
        {/* A narrow panel (a phone) keeps the name beside the mark and Close,
            and moves the actions to their own wrapping row below. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 @[640px]/head:flex">
          <BotMark
            watches={bot.watches}
            kind={bot.kind}
            size={40}
            icons={icons}
          />
          <NameField
            value={draft.name}
            onChange={(name) => commit({ ...draft, name }, "text")}
          />
          <div className="col-span-3 row-start-2 flex flex-wrap items-center gap-2 @[640px]/head:shrink-0 @[640px]/head:flex-nowrap">
            <RunNowButton bot={bot} now={now} />
            {bot.status === "active" || bot.snoozedUntil ? (
              <SnoozeMenu bot={bot} now={now} />
            ) : null}
            {bot.status === "active" ? (
              <Button
                variant="outline"
                size="sm"
                leading={<Pause />}
                loading={pause.isPending}
                onClick={() => act("pause")}
              >
                Pause
              </Button>
            ) : reason === "waiting_ok" ? (
              <Button
                size="sm"
                leading={<Play />}
                loading={resume.isPending}
                onClick={() => act("turn_on")}
              >
                Turn on
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                leading={<Play />}
                loading={resume.isPending}
                onClick={() => act("resume")}
              >
                Resume
              </Button>
            )}
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            <Button
              variant="ghost"
              size="sm"
              icon
              ref={prevRef}
              aria-label="Previous bot"
              disabled={!prev}
              onClick={() => prev && leave(() => onSelect(prev, "prev"))}
            >
              <ChevronUp />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon
              ref={nextRef}
              aria-label="Next bot"
              disabled={!next}
              onClick={() => next && leave(() => onSelect(next, "next"))}
            >
              <ChevronDown />
            </Button>
          </div>
          <span className="col-start-3 row-start-1 @[640px]/head:-ml-1">
            <CloseButton onClose={() => leave(onClose)} />
          </span>
        </div>
        {shown.head ? (
          <p className="mt-1 text-xs text-destructive">{shown.head}</p>
        ) : null}
        <div className="mt-3">
          <textarea
            aria-label="Description"
            value={draft.description}
            rows={1}
            placeholder="What should it keep an eye on, in your own words?"
            onChange={(event) =>
              commit({ ...draft, description: event.target.value }, "text")
            }
            className={descClass}
          />
          <p className="mt-0.5 text-xs text-muted-foreground">
            Your words. Edit them here; the bot keeps them with its rules.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Chip className={TONE_CHIP[health.tone]}>{health.word}</Chip>
          {bot.lastCheckAt ? (
            <Chip>Checked {agoLabel(bot.lastCheckAt, now)}</Chip>
          ) : null}
          {allPaused ? null : bot.kind === "brief" ? (
            bot.status === "active" && bot.nextCheckAt ? (
              <Chip>Next brief {briefClock(bot, bot.nextCheckAt, now)}</Chip>
            ) : null
          ) : bot.status === "active" && !bot.lastCheckAt ? (
            // A new bot's first check is queued at once: its next scheduled
            // time would say otherwise.
            <Chip>First check running</Chip>
          ) : bot.status === "active" && bot.nextCheckAt ? (
            <Chip>
              Next {clockLabel(bot.nextCheckAt, now)}
              {cooling ? ` · ${waitWords(bot)}` : ""}
            </Chip>
          ) : null}
          {origin ? (
            <Chip>
              {bot.origin === "chat" ? <MessageCircle /> : <Plug />}
              {origin}
            </Chip>
          ) : null}
          <span className="ml-auto">
            <SaveStatusBadge
              status={status}
              onRetry={() => void autosave.retry()}
            />
          </span>
        </div>
      </header>
      <PanelBody
        editor={
          <>
            <SwitchToAgentCard bot={bot} />
            <BotEditor
              draft={draft}
              onChange={commit}
              view={detail ?? bot}
              mode="edit"
              now={now}
              icons={icons}
              hasKey={hasKey}
              errors={shown}
              onDeleted={onClose}
              onWatchDirty={setWatchDirty}
              onOpenBot={(id) => leave(() => onSelect(id))}
            />
          </>
        }
        rail={
          detail ? (
            <BotRail
              detail={detail}
              now={now}
              lookOver={reason === "waiting_ok"}
            />
          ) : (
            <SkeletonCards />
          )
        }
      />
    </PanelFrame>
  );
}

/**
 * The right-side panel of the Assistant for a Bot: an agent Bot (check
 * strip, Try it now, grouped-row editor and its Bot thread, with
 * ?bot=<id>&thread=<1 or the thread's id> opening the thread), a rules Bot (its editor and rail,
 * with a Switch to agent card), or New bot, which starts as its thread.
 */
export function BotPanel({
  mode,
  botId,
  starter,
  draft,
  listed,
  order,
  now,
  onClose,
  onSelect,
  onUnfinished,
}: {
  mode: "edit" | "new";
  botId?: string | null;
  /** A Starter's blueprint key (?new=1&starter=<key>). */
  starter?: string | null;
  /** An unfinished New bot draft thread to reopen. */
  draft?: string | null;
  /** The bot as the board has it, drawn while its detail loads. */
  listed?: BotView;
  order: string[];
  now: Date;
  onClose: () => void;
  onSelect: (id: string) => void;
  /** Hears what the panel holds that closing would lose (see leaveUnfinished). */
  onUnfinished?: (unfinished: Unfinished) => void;
}) {
  const query = useBot(mode === "edit" ? botId : null);
  const router = useRouter();
  const params = useSearchParams();
  // ?bot=<id>&thread=1 (or the thread's own id, from a notification) is
  // this Bot's own thread.
  const tab = params.get("thread") ? "thread" : "setup";
  // Which nav button opened the next bot, for EditPanel's focus.
  const [via, setVia] = useState<{ id: string; on: "prev" | "next" } | null>(
    null,
  );

  if (mode === "new") {
    return (
      <NewBotThread
        key={starter ?? "blank"}
        starter={starter}
        draft={draft}
        onClose={onClose}
        onCreated={onSelect}
        onUnfinished={onUnfinished}
      />
    );
  }

  const bot = query.data ?? listed;
  if (!bot) {
    return (
      <PanelNotice onClose={onClose}>
        {query.isLoading ? (
          <SkeletonCards />
        ) : (
          <p className="text-sm text-muted-foreground">
            This bot no longer exists.
          </p>
        )}
      </PanelNotice>
    );
  }
  if (isAgentBot(bot)) {
    return (
      <AgentBotPanel
        key={bot.id}
        bot={bot}
        detail={query.data}
        now={now}
        initialTab={tab}
        onClose={onClose}
        onOpenChat={(chat) => router.push(assistantHref({ chat }))}
        onUnfinished={onUnfinished}
      />
    );
  }
  return (
    <EditPanel
      key={bot.id}
      bot={bot}
      detail={query.data}
      order={order}
      now={now}
      focusOn={via?.id === bot.id ? via.on : "panel"}
      onClose={onClose}
      onSelect={(id, on) => {
        setVia(on ? { id, on } : null);
        onSelect(id);
      }}
      onUnfinished={onUnfinished}
    />
  );
}
