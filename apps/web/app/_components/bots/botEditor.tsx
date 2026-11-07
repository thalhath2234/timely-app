"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  defaultMinutes,
  floorMinutes,
  type BotDetail,
  type BotInput,
  type BotView,
  type Rule,
  type WatchInput,
  type WatchKind,
  type WatchView,
} from "@timely/contract/bots";
import { useBots } from "@/app/utils/hooks/bots";
import { AlertsGroup } from "./alertsGroup";
import type { SiteIcons } from "./botMark";
import { DeleteBotRow } from "./deleteRow";
import { LessonsGroup } from "./lessonsGroup";
import { RulesGroup } from "./rulesGroup";
import { ScheduleGroup } from "./scheduleGroup";
import { WatchEditor, blankWatch } from "./watchEditor";
import { WatchesGroup } from "./watchesGroup";

/** How an edit saves: typed text waits a moment, a pick saves at once. */
export type EditHow = "text" | "now";

/** Which group a refused or not-yet-valid edit belongs under. */
export type EditorErrors = Partial<
  Record<"watches" | "schedule" | "rules" | "alerts", ReactNode>
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
 * saved bot Lessons and Delete. A watch opens in place of the groups. The
 * draft lives with the panel; edits come back through `onChange`.
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
  /** Hears whether an open watch has changes not saved into the draft yet. */
  onWatchDirty?: (dirty: boolean) => void;
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
  // Undefined while the board loads: not the same as "no AI provider".
  const summary = useBots().data?.summary;
  const watches = draft.watches;

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
    setEditing({ index: watches.length, watch: blankWatch(kind) });
  const setRules = (index: number, rules: Rule[], how: EditHow) =>
    onChange(
      {
        ...draft,
        watches: watches.map((w, i) => (i === index ? { ...w, rules } : w)),
      },
      how,
    );
  const detail = view && "lessons" in view ? view : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <WatchesGroup
        watches={watches}
        views={views}
        icons={icons}
        now={now}
        onEdit={(index) => setEditing({ index, watch: watches[index] })}
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
      <AlertsGroup
        value={{
          desktop: draft.desktop ?? true,
          phone: draft.phone ?? true,
          urgent: draft.urgent ?? false,
        }}
        onChange={(alerts) => onChange({ ...draft, ...alerts }, "now")}
        alertsToday={mode === "edit" ? view?.alertsToday : undefined}
        error={errors?.alerts}
      />
      {mode === "edit" && view ? (
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
      ) : null}
    </div>
  );
}
