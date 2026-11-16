"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical, History, Pause, Play } from "lucide-react";
import {
  agoLabel,
  cleanWatchInput,
  clockLabel,
  draftOf,
  healthLine,
  type BotDetail,
  type BotPatch,
  type WatchInput,
} from "@timely/contract/bots";
import { refusalMessage } from "@timely/contract/autosaveQueue";
import Button from "@/app/_components/_ui/button";
import SaveStatusBadge from "@/app/_components/_ui/saveStatus";
import SegmentedControl from "@/app/_components/_ui/segmentedControl";
import { useToastStore } from "@/app/_store/toastStore";
import type {
  AgentBotView,
  AgentPatch,
  AgentTryResult,
} from "@/app/_types/types";
import { cn } from "@/app/utils/cn";
import {
  useBots,
  useBotIcons,
  usePauseBot,
  useResumeBot,
  useTryBot,
  useUpdateBot,
} from "@/app/utils/hooks/bots";
import { useAutosave } from "@/app/utils/hooks/useAutosave";
import { checkTally, tallyCells, type AgentCheck } from "./agentBot";
import { AgentEditor, type AgentEditHow } from "./agentEditor";
import { BotMark, botSites } from "./botMark";
import { BotThread } from "./botThread";
import { CheckStrip } from "./checkStrip";
import { DeleteBotRow } from "./deleteRow";
import {
  Chip,
  CloseButton,
  NameField,
  PanelFrame,
  TONE_CHIP,
  escapeCloses,
} from "./panelParts";
import { TryResult, WhatItDid } from "./whatItDid";

const say = (message: string) => useToastStore.getState().show(message);

export type AgentTab = "setup" | "thread";

type EditorErrors = Partial<
  Record<"prompt" | "schedule" | "reads" | "tools", string>
>;

/** Which group a refused edit is shown under, by the fields it held. */
function groupOf(patch: AgentPatch & BotPatch): keyof EditorErrors {
  if (patch.watches) return "reads";
  if (patch.schedule || patch.marketHours !== undefined) return "schedule";
  if (patch.prompt !== undefined) return "prompt";
  return "tools";
}

/**
 * The open agent Bot: the check strip, Try it now, "What it did", the
 * grouped-row editor and its Bot thread. Everything saves as you go.
 */
export function AgentBotPanel({
  bot,
  detail,
  now,
  initialTab,
  onClose,
  onOpenChat,
  onUnfinished,
}: {
  bot: AgentBotView;
  detail?: BotDetail;
  now: Date;
  initialTab: AgentTab;
  onClose: () => void;
  onOpenChat: (conversationId: string) => void;
  onUnfinished?: (unfinished: "edit" | null) => void;
}) {
  const update = useUpdateBot();
  const pause = usePauseBot();
  const resume = useResumeBot();
  const tryIt = useTryBot();
  const allPaused = !!useBots().data?.summary.allPaused;
  const [tab, setTab] = useState<AgentTab>(initialTab);
  const [sheet, setSheet] = useState<"did" | null>(null);
  const [tried, setTried] = useState<AgentTryResult | null>(null);
  const [name, setName] = useState(bot.name);
  const [errors, setErrors] = useState<EditorErrors>({});
  const [reset, setReset] = useState(0);
  const [watchDirty, setWatchDirty] = useState(false);
  const frameRef = useRef<HTMLElement>(null);
  const icons = useBotIcons(
    useMemo(() => botSites(bot.watches), [bot.watches]),
  ).data;
  const reads: WatchInput[] = useMemo(
    () => draftOf(bot, undefined).watches,
    [bot],
  );

  const autosave = useAutosave<BotPatch & AgentPatch>(
    (patch) => update.mutateAsync({ id: bot.id, patch }),
    600,
    {
      onRejected: (error, patch) => {
        setErrors({ [groupOf(patch)]: refusalMessage(error) });
        setReset((n) => n + 1);
        if ("name" in patch) setName(bot.name);
      },
    },
  );

  // A rename shows as typed; the server's name returns when it differs and nothing is typing.
  const [syncedName, setSyncedName] = useState(bot.name);
  if (bot.name !== syncedName) {
    setSyncedName(bot.name);
    if (autosave.status !== "saving" && autosave.status !== "unsaved")
      setName(bot.name);
  }

  useEffect(() => {
    frameRef.current?.focus({ preventScroll: true });
  }, []);

  const unfinished = watchDirty ? "edit" : null;
  useEffect(() => {
    onUnfinished?.(unfinished);
  }, [unfinished, onUnfinished]);
  useEffect(() => () => onUnfinished?.(null), [onUnfinished]);

  const onPatch = (patch: AgentPatch, how: AgentEditHow) => {
    setErrors({});
    if (how === "text") autosave.schedule(patch);
    else void autosave.saveNow(patch);
  };
  const onReads = (next: WatchInput[]) => {
    setErrors({});
    void autosave.saveNow({ watches: next.map(cleanWatchInput) });
  };

  const checks = (detail?.checks ?? []) as AgentCheck[];
  const tally = checkTally(checks);
  const health = healthLine(bot, now, undefined, { allPaused });
  const cooling = bot.status === "active" && !!bot.nextCheckAt;

  const act = (kind: "pause" | "resume") => {
    const m = kind === "pause" ? pause : resume;
    m.mutate(bot.id, {
      onSuccess: () =>
        say(
          kind === "pause"
            ? `${bot.name} is paused`
            : `${bot.name} is running again`,
        ),
      onError: (error) => say(error.message),
    });
  };

  const runTry = () =>
    tryIt.mutate(bot.id, {
      onSuccess: setTried,
      onError: (error) => say(error.message),
    });

  const status = autosave.status;

  return (
    <PanelFrame
      label={bot.name}
      frameRef={frameRef}
      onKeyDown={escapeCloses(onClose)}
    >
      <header className="@container/head relative z-20 shrink-0 border-b border-border bg-card pb-4 pl-6 pr-5 pt-4">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 @[640px]/head:flex">
          <BotMark
            watches={bot.watches}
            kind={bot.kind}
            size={40}
            icons={icons}
          />
          <NameField
            value={name}
            onChange={(next) => {
              setName(next);
              if (next.trim()) autosave.schedule({ name: next });
            }}
          />
          <div className="col-span-3 row-start-2 flex flex-wrap items-center gap-2 @[640px]/head:shrink-0 @[640px]/head:flex-nowrap">
            <Button
              variant="outline"
              size="sm"
              leading={<FlaskConical />}
              loading={tryIt.isPending}
              onClick={runTry}
            >
              Try it now
            </Button>
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
          </div>
          <span className="col-start-3 row-start-1 @[640px]/head:-ml-1">
            <CloseButton onClose={onClose} />
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Chip className={TONE_CHIP[health.tone]}>{health.word}</Chip>
          {bot.lastCheckAt ? (
            <Chip>Checked {agoLabel(bot.lastCheckAt, now)}</Chip>
          ) : null}
          {!allPaused && cooling && bot.nextCheckAt ? (
            <Chip>Next {clockLabel(bot.nextCheckAt, now)}</Chip>
          ) : null}
          <span className="ml-auto">
            <SaveStatusBadge
              status={status}
              onRetry={() => void autosave.retry()}
            />
          </span>
        </div>
        <div
          className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2"
          data-testid="agent-check-strip"
        >
          <CheckStrip marks={bot.strip} size="big" />
          <dl className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {tallyCells(tally).map((cell) => (
              <div key={cell.key} className="flex items-baseline gap-1">
                <dd
                  className={cn(
                    "font-semibold tabular-nums",
                    cell.key === "failed" && tally.failed > 0
                      ? "text-destructive"
                      : "text-foreground",
                  )}
                >
                  {cell.value}
                </dd>
                <dt className="text-muted-foreground">{cell.label}</dt>
              </div>
            ))}
          </dl>
          <Button
            variant="ghost"
            size="sm"
            leading={<History />}
            onClick={() => setSheet("did")}
          >
            What it did
          </Button>
        </div>
        <SegmentedControl<AgentTab>
          className="mt-3"
          aria-label="Bot page"
          value={tab}
          onChange={setTab}
          options={[
            { value: "setup", label: "Setup" },
            { value: "thread", label: "Thread" },
          ]}
        />
      </header>
      {tab === "thread" ? (
        <div className="min-h-0 flex-1">
          <BotThread id={bot.id} onOpenChat={onOpenChat} />
        </div>
      ) : (
        <div className="@container min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 px-6 pb-6 pt-5">
            <AgentEditor
              bot={bot}
              readInputs={reads}
              now={now}
              icons={icons}
              errors={errors}
              resetSignal={reset}
              onPatch={onPatch}
              onReads={onReads}
              onWatchDirty={setWatchDirty}
            />
            <DeleteBotRow botId={bot.id} name={bot.name} onDeleted={onClose} />
          </div>
        </div>
      )}
      {sheet === "did" ? (
        <WhatItDid
          checks={checks}
          alerts={detail?.alerts ?? []}
          now={now}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {tried ? (
        <TryResult result={tried} onClose={() => setTried(null)} />
      ) : null}
    </PanelFrame>
  );
}
