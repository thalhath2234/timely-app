"use client";

import { useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  BOT_LIMITS,
  watchTitle,
  type WatchInput,
  type WatchView,
} from "@timely/contract/bots";
import {
  PERMISSION_COPY,
  PERMISSION_MODES,
  type PermissionMode,
} from "@timely/contract/agentChat";
import Button from "@/app/_components/_ui/button";
import { TimeField } from "@/app/_components/_ui/datePicker";
import { Input, Textarea } from "@/app/_components/_ui/field";
import {
  GroupHint,
  GroupLabel,
  ListGroup,
  ListRow,
  ListSwitch,
} from "@/app/_components/_ui/groupedList";
import Select from "@/app/_components/_ui/select";
import ModelMenu from "@/app/_components/chat/modelMenu";
import { confirmFullAccess } from "@/app/_components/chat/permissionPicker";
import type { AgentBotView, AgentPatch, BotSchedule } from "@/app/_types/types";
import { useSourceKeys } from "@/app/utils/hooks/bots";
import { SCHEDULE_PRESETS, presetOf } from "./agentBot";
import { BotMark, type SiteIcons } from "./botMark";
import { WatchEditor, blankWatch } from "./watchEditor";
import { watchMeta } from "./watchesGroup";

/** How an edit saves: typed text waits a moment, a pick saves at once. */
export type AgentEditHow = "text" | "now";

type Errors = Partial<
  Record<"prompt" | "schedule" | "reads" | "tools", ReactNode>
>;

/**
 * A list of words kept as rows (skills, signed-in sites, extra hosts): each
 * row can be removed, and a last row adds one.
 */
function StringList({
  label,
  hint,
  items,
  placeholder,
  addLabel,
  empty,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  items: string[];
  placeholder: string;
  addLabel: string;
  empty: string;
  onChange: (next: string[]) => void;
}) {
  const [text, setText] = useState("");
  const add = () => {
    const word = text.trim();
    if (!word) return;
    if (!items.some((i) => i.toLowerCase() === word.toLowerCase()))
      onChange([...items, word]);
    setText("");
  };
  return (
    <section>
      <GroupLabel aside={items.length ? String(items.length) : undefined}>
        {label}
      </GroupLabel>
      <ListGroup>
        {[
          ...(items.length
            ? items.map((item) => (
                <ListRow key={item} label={item}>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label={`Remove ${item}`}
                    onClick={() => onChange(items.filter((i) => i !== item))}
                  >
                    <X />
                  </Button>
                </ListRow>
              ))
            : [
                <ListRow
                  key="none"
                  label={<span className="text-muted-foreground">{empty}</span>}
                />,
              ]),
          <div key="add" className="flex items-center gap-2 px-3.5 py-1.5">
            <Input
              size="sm"
              aria-label={addLabel}
              value={text}
              placeholder={placeholder}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
              className="min-w-0 flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!text.trim()}
              onClick={add}
            >
              Add
            </Button>
          </div>,
        ]}
      </ListGroup>
      {hint ? <GroupHint>{hint}</GroupHint> : null}
    </section>
  );
}

/** Whether a keyed price source has a saved key; unknown (still loading) counts as yes. */
function useHasKey() {
  const keys = useSourceKeys().data;
  return (source: string) =>
    !keys || keys.some((k) => k.source === source && k.keySet);
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** The typed values the server does not have yet. */
function pruneLocal(local: AgentPatch, bot: AgentBotView): AgentPatch {
  const next: AgentPatch = { ...local };
  for (const key of Object.keys(local) as (keyof AgentPatch)[]) {
    if (key === "tools") continue;
    if (same(local[key], bot[key])) delete next[key];
  }
  if (local.tools) {
    const tools = { ...local.tools };
    for (const tk of Object.keys(tools) as (keyof typeof tools)[]) {
      if (same(tools[tk], bot.tools[tk])) delete tools[tk];
    }
    if (Object.keys(tools).length === 0) delete next.tools;
    else next.tools = tools;
  }
  return next;
}

/**
 * The agent Bot's editor, as grouped rows: What to do, Reads (with
 * only-when-changed), Schedule, Skills, Tools and browser sites, Memory,
 * Permission and Model. Each pick saves at once; the prompt saves as it is
 * typed. A Read opens in place of the groups.
 */
export function AgentEditor({
  bot,
  readInputs,
  now,
  icons,
  errors,
  resetSignal = 0,
  onPatch,
  onReads,
  onWatchDirty,
}: {
  bot: AgentBotView;
  /** The Bot's Reads as editable inputs. */
  readInputs: WatchInput[];
  now: Date;
  icons?: SiteIcons;
  errors?: Errors;
  /** Changes when a refused edit must be put back: typed values are dropped. */
  resetSignal?: number;
  onPatch: (patch: AgentPatch, how: AgentEditHow) => void;
  onReads: (next: WatchInput[]) => void;
  onWatchDirty?: (dirty: boolean) => void;
}) {
  const hasKey = useHasKey();
  const [local, setLocal] = useState<AgentPatch>({});
  const [editing, setEditing] = useState<{
    index: number;
    watch: WatchInput;
  } | null>(null);
  const views = useMemo(
    () => new Map<string, WatchView>(bot.watches.map((w) => [w.id, w])),
    [bot.watches],
  );

  // An edit shows at once. When the Bot changes, the values the server now
  // has are dropped from the overlay; a refused edit (resetSignal) drops all.
  const [synced, setSynced] = useState({ bot, reset: resetSignal });
  if (synced.bot !== bot || synced.reset !== resetSignal) {
    setSynced({ bot, reset: resetSignal });
    setLocal(synced.reset !== resetSignal ? {} : pruneLocal(local, bot));
  }

  const value = {
    prompt: local.prompt ?? bot.prompt,
    schedule: (local.schedule ?? bot.schedule) as BotSchedule,
    skills: local.skills ?? bot.skills,
    gate: local.gate ?? bot.gate,
    marketHours: local.marketHours ?? bot.marketHours,
    permission: (local.permission ?? bot.permission) as PermissionMode,
    modelProvider: local.modelProvider ?? bot.modelProvider,
    model: local.model ?? bot.model,
    browserSites: local.tools?.browserSites ?? bot.tools.browserSites,
    egress: local.tools?.egress ?? bot.tools.egress,
    useMemory: local.tools?.useMemory ?? bot.tools.useMemory,
  };

  const patch = (next: AgentPatch, how: AgentEditHow = "now") => {
    setLocal((cur) => ({
      ...cur,
      ...next,
      ...(next.tools ? { tools: { ...cur.tools, ...next.tools } } : {}),
    }));
    onPatch(next, how);
  };

  if (editing) {
    const isNew = editing.index >= readInputs.length;
    return (
      <WatchEditor
        key={editing.index}
        watch={editing.watch}
        view={editing.watch.id ? views.get(editing.watch.id) : undefined}
        isNew={isNew}
        isLast={false}
        hasKey={hasKey}
        onDirty={onWatchDirty}
        onBack={() => setEditing(null)}
        onSave={(w) => {
          onReads(
            isNew
              ? [...readInputs, w]
              : readInputs.map((x, i) => (i === editing.index ? w : x)),
          );
          setEditing(null);
        }}
        onRemove={() => {
          onReads(readInputs.filter((_, i) => i !== editing.index));
          setEditing(null);
        }}
      />
    );
  }

  const preset = presetOf(value.schedule);
  const presetOptions = [
    ...SCHEDULE_PRESETS.map((p) => ({ value: p.value, label: p.label })),
    ...(preset === "custom" ? [{ value: "custom", label: "Custom" }] : []),
  ];
  const daily = "dailyAt" in value.schedule ? value.schedule : null;
  const canAdd = readInputs.length < BOT_LIMITS.maxWatches;

  const setPermission = (mode: PermissionMode) => {
    if (mode === value.permission) return;
    if (mode === "full")
      confirmFullAccess("bots", () => patch({ permission: mode }));
    else patch({ permission: mode });
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section>
        <GroupLabel>What to do</GroupLabel>
        <div className="rounded-[12px] border border-border bg-card p-1.5">
          <Textarea
            aria-label="What to do"
            value={value.prompt}
            rows={4}
            placeholder="Tell it what to look for and when to speak up. It stays silent otherwise."
            onChange={(event) => patch({ prompt: event.target.value }, "text")}
            className="min-h-24 resize-y border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        </div>
        {errors?.prompt ? (
          <GroupHint className="text-destructive">{errors.prompt}</GroupHint>
        ) : null}
      </section>

      <section>
        <GroupLabel aside={`${readInputs.length} of ${BOT_LIMITS.maxWatches}`}>
          Reads
        </GroupLabel>
        <ListGroup>
          {[
            ...readInputs.map((w, index) => {
              const view = w.id ? views.get(w.id) : undefined;
              return (
                <ListRow
                  key={w.id ?? `new-${index}`}
                  label={view ? watchTitle(view) : watchTitle(w)}
                  meta={watchMeta(w, view, now)}
                  icon={
                    <BotMark
                      watches={[view ?? w]}
                      size={24}
                      icons={icons}
                      badge={false}
                    />
                  }
                  onClick={() => setEditing({ index, watch: w })}
                />
              );
            }),
            ...(canAdd
              ? (["page", "feed", "price"] as const).map((kind) => (
                  <ListRow
                    key={`add-${kind}`}
                    label={
                      kind === "page"
                        ? "Add a page"
                        : kind === "feed"
                          ? "Add a feed"
                          : "Add a price"
                    }
                    tone="add"
                    onClick={() =>
                      setEditing({
                        index: readInputs.length,
                        watch: blankWatch(kind),
                      })
                    }
                  />
                ))
              : []),
            ...(readInputs.length
              ? [
                  <ListRow
                    key="gate"
                    label="Only when something changed"
                    meta="It wakes only when a read's content, price or availability changed."
                    wrapMeta
                  >
                    <ListSwitch
                      label="Only when something changed"
                      checked={value.gate === "changed"}
                      onChange={(on) =>
                        patch({ gate: on ? "changed" : "always" })
                      }
                    />
                  </ListRow>,
                ]
              : []),
          ]}
        </ListGroup>
        {errors?.reads ? (
          <GroupHint className="text-destructive">{errors.reads}</GroupHint>
        ) : null}
        {readInputs.length === 0 ? (
          <GroupHint>
            With no reads it runs on its schedule, at most every 15 minutes.
          </GroupHint>
        ) : null}
      </section>

      <section>
        <GroupLabel>Schedule</GroupLabel>
        <ListGroup>
          <ListRow label="Runs">
            <Select
              variant="row"
              aria-label="Runs"
              value={preset}
              options={presetOptions}
              onChange={(v) => {
                const found = SCHEDULE_PRESETS.find((p) => p.value === v);
                if (found) patch({ schedule: found.schedule });
              }}
            />
          </ListRow>
          {daily ? (
            <ListRow label="At">
              <TimeField
                variant="row"
                aria-label="Runs at"
                value={daily.dailyAt}
                onChange={(dailyAt) =>
                  dailyAt &&
                  patch({ schedule: { dailyAt, weekdays: daily.weekdays } })
                }
              />
            </ListRow>
          ) : null}
          {"cron" in value.schedule ? (
            <ListRow label="Cron">
              <span className="truncate font-mono text-[13px] text-muted-foreground">
                {value.schedule.cron}
              </span>
            </ListRow>
          ) : null}
          <ListRow
            label="Only during market hours"
            meta="Skips weekends and hours the market is shut."
          >
            <ListSwitch
              label="Only during market hours"
              checked={value.marketHours}
              onChange={(marketHours) => patch({ marketHours })}
            />
          </ListRow>
        </ListGroup>
        {errors?.schedule ? (
          <GroupHint className="text-destructive">{errors.schedule}</GroupHint>
        ) : null}
        <GroupHint>Times are in {bot.timezone || "your time zone"}.</GroupHint>
      </section>

      <StringList
        label="Skills"
        items={value.skills}
        placeholder="A skill name"
        addLabel="Add a skill"
        empty="No skills"
        onChange={(skills) => patch({ skills })}
      />

      <StringList
        label="Signed-in browser sites"
        items={value.browserSites}
        placeholder="example.com"
        addLabel="Add a site"
        empty="No sites"
        hint="It reads these on your signed-in browser, on its own. Anything else it does there waits in Needs you. A new site waits for one tap."
        onChange={(browserSites) => patch({ tools: { browserSites } })}
      />

      <StringList
        label="Extra hosts"
        items={value.egress}
        placeholder="api.example.com"
        addLabel="Add a host"
        empty="Only its reads and sites"
        hint="Outbound web tools reach only its reads, its sites and these hosts."
        onChange={(egress) => patch({ tools: { egress } })}
      />

      <section>
        <GroupLabel>Access</GroupLabel>
        <ListGroup>
          <ListRow
            label="Memory and About you"
            meta="Off by default. Turning it on waits for one tap in the Bot thread."
            wrapMeta
          >
            <ListSwitch
              label="Memory and About you"
              checked={value.useMemory}
              onChange={(useMemory) => patch({ tools: { useMemory } })}
            />
          </ListRow>
          <ListRow
            label="Permission"
            meta={PERMISSION_COPY[value.permission].short}
            wrapMeta
          >
            <Select
              variant="row"
              aria-label="Permission"
              value={value.permission}
              options={PERMISSION_MODES.map((mode) => ({
                value: mode,
                label: PERMISSION_COPY[mode].name,
              }))}
              onChange={(v) => setPermission(v as PermissionMode)}
            />
          </ListRow>
          <ListRow label="Model">
            <ModelMenu
              value={{ provider: value.modelProvider, model: value.model }}
              onChange={(next) =>
                patch({ modelProvider: next.provider, model: next.model })
              }
            />
          </ListRow>
        </ListGroup>
        {errors?.tools ? (
          <GroupHint className="text-destructive">{errors.tools}</GroupHint>
        ) : null}
      </section>
    </div>
  );
}
