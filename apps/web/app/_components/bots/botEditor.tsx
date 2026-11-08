"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  defaultMinutes,
  floorMinutes,
  type BotDetail,
  type BotInput,
  type BotView,
  type LinkInput,
  type Rule,
  type WatchInput,
  type WatchKind,
  type WatchView,
} from "@timely/contract/bots";
import { useBots } from "@/app/utils/hooks/bots";
import { AlertsGroup } from "./alertsGroup";
import { BriefEditor } from "./briefEditor";
import type { SiteIcons } from "./botMark";
import { DeleteBotRow } from "./deleteRow";
import { LessonsGroup } from "./lessonsGroup";
import { LinkEditor } from "./linkEditor";
import { RulesGroup } from "./rulesGroup";
import { ScheduleGroup } from "./scheduleGroup";
import { WatchEditor, blankWatch } from "./watchEditor";
import { WatchesGroup } from "./watchesGroup";
import { WorksWithGroup, passInputs } from "./worksWithGroup";

/** How an edit saves: typed text waits a moment, a pick saves at once. */
export type EditHow = "text" | "now";

/** Which group a refused or not-yet-valid edit belongs under. */
export type EditorErrors = Partial<
  Record<
    "watches" | "schedule" | "rules" | "alerts" | "links" | "brief",
    ReactNode
  >
>;

/** A watch list with an interval that still fits it (raised to the new floor when a watch needs it). */
function withWatches(draft: BotInput, watches: WatchInput[]): BotInput {
  const every = draft.intervalMinutes;
  const intervalMinutes =
    every && every < floorMinutes(watches) ? defaultMinutes(watches) : every;
  return { ...draft, watches, intervalMinutes };
}

/**
 * The editor column: Watches, Schedule, Tells me when, Alerts, and on a
 * saved bot Works with, Lessons and Delete. A brief has Sums up and Sends in
 * place of the first three, and no Works with. A watch or a Pass to link
 * opens in place of the groups. The draft lives with the panel; edits come
 * back through `onChange`.
 */
export function BotEditor({
  draft,
  onChange,
  view,
  mode,
  now,
  icons,
  hasKey,
  errors,
  onDeleted,
  onWatchDirty,
  onOpenBot,
}: {
  draft: BotInput;
  onChange: (next: BotInput, how: EditHow) => void;
  view?: BotView | BotDetail;
  mode: "edit" | "new";
  now: Date;
  icons?: SiteIcons;
  hasKey: (source: string) => boolean;
  errors?: EditorErrors;
  onDeleted?: () => void;
  /** Hears whether an open watch or link has changes not saved into the draft yet. */
  onWatchDirty?: (dirty: boolean) => void;
  /** Opens another bot (a brief this one is in). */
  onOpenBot?: (id: string) => void;
}) {
  const [editing, setEditing] = useState<{
    index: number;
    watch: WatchInput;
  } | null>(null);
  const views = useMemo(
    () =>
      new Map<string, WatchView>((view?.watches ?? []).map((w) => [w.id, w])),
    [view],
  );
  const [linking, setLinking] = useState<{
    index: number;
    link: LinkInput;
  } | null>(null);
  // Back from a link's page, Works with comes into view again.
  const [backFromLink, setBackFromLink] = useState(false);
  // Undefined while the board loads: not the same as "no AI provider".
  const board = useBots().data;
  const summary = board?.summary;
  const bots = board?.bots ?? [];
  const watches = draft.watches;
  const detail = view && "lessons" in view ? view : undefined;
  const brief = draft.kind === "brief";
  // The draft holds the links once the bot's page has loaded them; until
  // then the saved ones stand in, so an edit never drops a link.
  const passes =
    draft.passesTo ?? (view ? passInputs(view.id, detail?.links) : []);
  const linked = new Set(passes.map((l) => l.botId));
  const targetsFor = (current?: string) =>
    bots
      .filter(
        (b) =>
          (b.kind ?? "watch") === "watch" &&
          b.id !== view?.id &&
          (b.id === current || !linked.has(b.id)),
      )
      .map((b) => ({ id: b.id, name: b.name }));

  // A link's switch saves on its own route, so a list sent from here leaves
  // each link's on/off out and the server keeps what it has.
  const sendPasses = (list: LinkInput[]): LinkInput[] =>
    list.map((l) =>
      l.id
        ? { id: l.id, botId: l.botId, filter: l.filter }
        : { botId: l.botId, filter: l.filter },
    );
  // Opening a watch: back from it, the column stays at Watches.
  const editWatch = (next: { index: number; watch: WatchInput }) => {
    setBackFromLink(false);
    setEditing(next);
  };

  if (linking && view) {
    const isNew = linking.index >= passes.length;
    const close = () => {
      onWatchDirty?.(false);
      setLinking(null);
      setBackFromLink(true);
    };
    return (
      <LinkEditor
        key={linking.index}
        link={linking.link}
        isNew={isNew}
        targets={targetsFor(linking.link.botId)}
        targetName={bots.find((b) => b.id === linking.link.botId)?.name}
        onDirty={onWatchDirty}
        onBack={close}
        onSave={(link) => {
          const passesTo = sendPasses(
            isNew
              ? [...passes, link]
              : passes.map((x, i) => (i === linking.index ? link : x)),
          );
          onChange({ ...draft, passesTo }, "now");
          close();
        }}
        onRemove={() => {
          onChange(
            {
              ...draft,
              passesTo: sendPasses(
                passes.filter((_, i) => i !== linking.index),
              ),
            },
            "now",
          );
          close();
        }}
      />
    );
  }

  if (editing) {
    const isNew = editing.index >= watches.length;
    const saved = editing.watch.id ? views.get(editing.watch.id) : undefined;
    return (
      <WatchEditor
        key={editing.index}
        watch={editing.watch}
        view={saved}
        isNew={isNew}
        isLast={mode === "edit" && watches.length <= 1}
        unsaved={mode === "new"}
        hasKey={hasKey}
        onDirty={onWatchDirty}
        onBack={() => setEditing(null)}
        onSave={(w) => {
          const next = isNew
            ? [...watches, w]
            : watches.map((x, i) => (i === editing.index ? w : x));
          onChange(withWatches(draft, next), "now");
          setEditing(null);
        }}
        onRemove={() => {
          onChange(
            withWatches(
              draft,
              watches.filter((_, i) => i !== editing.index),
            ),
            "now",
          );
          setEditing(null);
        }}
      />
    );
  }

  const add = (kind: WatchKind = "page") =>
    editWatch({ index: watches.length, watch: blankWatch(kind) });
  const setRules = (index: number, rules: Rule[], how: EditHow) =>
    onChange(
      {
        ...draft,
        watches: watches.map((w, i) => (i === index ? { ...w, rules } : w)),
      },
      how,
    );
  const alerts = (
    <AlertsGroup
      value={{
        desktop: draft.desktop ?? true,
        phone: draft.phone ?? true,
        urgent: draft.urgent ?? false,
      }}
      onChange={(next) => onChange({ ...draft, ...next }, "now")}
      // A brief's sends are not capped, and alertsToday counts alerts only.
      alertsToday={mode === "edit" && !brief ? view?.alertsToday : undefined}
      error={errors?.alerts}
    />
  );
  const saved =
    mode === "edit" && view ? (
      <>
        {detail ? (
          <LessonsGroup
            bot={view}
            botId={view.id}
            lessons={detail.lessons ?? []}
          />
        ) : null}
        <DeleteBotRow
          botId={view.id}
          name={view.name}
          onDeleted={() => onDeleted?.()}
        />
      </>
    ) : null;

  if (brief) {
    return (
      <div className="flex min-w-0 flex-col gap-5">
        <BriefEditor
          draft={draft}
          onChange={onChange}
          bots={bots}
          saved={mode === "edit" ? view?.sources : undefined}
          summary={summary}
          error={
            errors?.brief ??
            errors?.watches ??
            errors?.schedule ??
            errors?.rules
          }
        />
        {alerts}
        {saved}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <WatchesGroup
        watches={watches}
        views={views}
        icons={icons}
        now={now}
        onEdit={(index) => editWatch({ index, watch: watches[index] })}
        onAdd={add}
        error={errors?.watches}
      />
      <ScheduleGroup
        watches={watches}
        intervalMinutes={draft.intervalMinutes}
        onChange={(intervalMinutes) =>
          onChange({ ...draft, intervalMinutes }, "now")
        }
        error={errors?.schedule}
      />
      <RulesGroup
        watches={watches}
        views={views}
        judgeMode={draft.judgeMode}
        onJudgeMode={(judgeMode) =>
          onChange(
            {
              ...draft,
              judgeMode,
              // A new rules-only bot is not created with hidden knowledge.
              ...(judgeMode === "rules" && mode === "new"
                ? { knowledge: null }
                : {}),
            },
            "now",
          )
        }
        summary={summary}
        aiChecksToday={mode === "edit" ? view?.aiChecksToday : undefined}
        knowledge={draft.knowledge}
        knowledgeView={mode === "edit" ? view?.knowledge : undefined}
        onKnowledge={(knowledge) => onChange({ ...draft, knowledge }, "now")}
        onRules={setRules}
        error={errors?.rules}
      />
      {alerts}
      {mode === "edit" && view && detail ? (
        <WorksWithGroup
          botId={view.id}
          passesTo={passes}
          links={detail.links}
          bots={bots}
          briefOnly={!!draft.briefOnly}
          onBriefOnly={(briefOnly) => onChange({ ...draft, briefOnly }, "now")}
          onEdit={(index) => setLinking({ index, link: passes[index] })}
          onAdd={() =>
            setLinking({
              index: passes.length,
              link: { botId: "", filter: [] },
            })
          }
          canAdd={targetsFor().length > 0}
          onOpenBot={onOpenBot}
          reveal={backFromLink}
          error={errors?.links ?? errors?.brief}
        />
      ) : null}
      {saved}
    </div>
  );
}
