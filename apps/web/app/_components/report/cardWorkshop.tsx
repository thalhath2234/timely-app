"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  CalendarDays,
  Check,
  FileText,
  FolderKanban,
  Gauge,
  Hash,
  Inbox,
  LineChart as LineIcon,
  List,
  ListTodo,
  Minus,
  PieChart,
  Plus,
  Bell,
  Sheet as SheetIcon,
  X,
} from "lucide-react";
import {
  CARD_TEMPLATES,
  DATE_FIELD_LABELS,
  DISPLAY_LABELS,
  DISPLAY_NEEDS_GROUP,
  GROUP_LABELS,
  MEASURE_LABELS,
  RANGE_LABELS,
  SORT_LABELS,
  SOURCE_CAPABILITIES,
  SOURCE_LABELS,
  computeCard,
  defaultQuery,
  describeQuery,
  fitQuery,
  minCardSize,
  priorityName,
  type CardDisplay,
  type CardFilters,
  type CardQuery,
  type CardRangePreset,
  type CardSource,
  type DashboardData,
} from "@timely/contract/dashboard";
import Select from "@/app/_components/_ui/select";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import { cn } from "@/app/utils/cn";
import CustomCardView from "./customCardView";
import { seriesColor } from "./charts";
import { ROW_HEIGHT, GRID_GAP } from "./dashboardGrid";

const SOURCE_ICON: Record<CardSource, typeof ListTodo> = {
  tasks: ListTodo,
  projects: FolderKanban,
  events: CalendarDays,
  docs: FileText,
  sheets: SheetIcon,
  reminders: Bell,
  inbox: Inbox,
};

export const DISPLAY_ICON: Record<CardDisplay, typeof Hash> = {
  number: Hash,
  list: List,
  bar: BarChart3,
  line: LineIcon,
  pie: PieChart,
  progress: Gauge,
};

const RANGE_ORDER: CardRangePreset[] = [
  "all",
  "today",
  "yesterday",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
  "last7",
  "last14",
  "last30",
  "last90",
  "next7",
  "next14",
  "next30",
  "custom",
];

export interface WorkshopResult {
  title: string;
  query: CardQuery;
  w: number;
  h: number;
}

export default function CardWorkshop({
  initial,
  data,
  timeZone,
  onSave,
  onClose,
}: {
  /** Editing an existing card; absent starts a new one. */
  initial?: WorkshopResult;
  data: DashboardData;
  timeZone?: string;
  onSave: (result: WorkshopResult) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [query, setQueryRaw] = useState<CardQuery>(() => fitQuery(initial?.query ?? defaultQuery("tasks")));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [size, setSize] = useState({ w: initial?.w ?? 4, h: initial?.h ?? 3 });
  const now = useMemo(() => new Date(), []);

  const setQuery = (change: Partial<CardQuery>) => setQueryRaw((current) => fitQuery({ ...current, ...change }));
  const setFilters = (change: Partial<CardFilters>) =>
    setQueryRaw((current) => {
      const filters: CardFilters = { ...current.filters, ...change };
      for (const key of Object.keys(filters) as (keyof CardFilters)[]) {
        const value = filters[key];
        if (value === undefined || value === false || value === "" || (Array.isArray(value) && value.length === 0)) delete filters[key];
      }
      return fitQuery({ ...current, filters });
    });

  const caps = SOURCE_CAPABILITIES[query.source];
  const result = useMemo(() => computeCard(query, data, { now, timeZone }), [query, data, now, timeZone]);
  const min = minCardSize({ type: "custom", query });
  const w = Math.max(size.w, min.w);
  const h = Math.max(size.h, min.h);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickSource = (source: CardSource) => {
    const fresh = defaultQuery(source);
    setQueryRaw(fitQuery({ ...fresh, display: query.display, groupBy: query.groupBy, range: query.range, color: query.color }));
  };

  const pickDisplay = (display: CardDisplay) => {
    const sizes: Record<CardDisplay, { w: number; h: number }> = {
      number: { w: 3, h: 2 },
      progress: { w: 3, h: 2 },
      list: { w: 4, h: 4 },
      bar: { w: 4, h: 3 },
      line: { w: 6, h: 3 },
      pie: { w: 4, h: 4 },
    };
    if (!initial) setSize(sizes[display]);
    setQuery({ display });
  };

  const workspaces = data.workspaces ?? [];
  const projects = (data.projects ?? []).filter((project) => !project.completedAt);
  const statuses = workspaces.flatMap((workspace) =>
    (workspace.status ?? []).map((status) => ({ id: status.id, label: workspaces.length > 1 ? `${status.name} · ${workspace.name}` : status.name, color: status.color })),
  );
  const labels = workspaces.flatMap((workspace) => (workspace.lables ?? []).map((label) => ({ id: label.id, label: label.name, color: label.color })));
  const priorities = ["Urgent", "High", "Medium", "Low", "None"];

  const autoTitle = describeQuery(query);
  const save = () => onSave({ title: title.trim(), query, w, h });

  // Preview at the card's real height, and the width it would get on a 12-column board up to the panel width.
  const previewHeight = h * ROW_HEIGHT + (h - 1) * GRID_GAP;
  const previewWidth = `${Math.min(100, (w / 12) * 100 * 1.6)}%`;

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <OverlayScrim className="z-[60] bg-black/55" onPointerDown={(event) => event.target === event.currentTarget && onClose()} />
      <OverlayFrame className="z-[60] items-center justify-center p-4">
        <OverlayPanel
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="report-dashboard flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        >
          <header className="flex items-center gap-3 border-b border-border px-5 py-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-semibold text-foreground">
                {initial ? "Edit card" : "Card workshop"}
              </h2>
              <p className="text-xs text-muted-foreground">Pick the data, narrow it down, choose how it looks. The preview updates as you go.</p>
            </div>
            {!initial ? (
              <div className="w-56">
                <Select
                  size="sm"
                  value=""
                  placeholder="Start from a template…"
                  onChange={(id) => {
                    const template = CARD_TEMPLATES.find((entry) => entry.id === id);
                    if (!template) return;
                    setQueryRaw(template.query);
                    setTitle(template.title);
                    setSize({ w: template.w, h: template.h });
                  }}
                  options={CARD_TEMPLATES.map((template) => ({ value: template.id, label: template.title }))}
                  aria-label="Start from a template"
                />
              </div>
            ) : null}
            <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
              <X className="size-4" />
            </button>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:overflow-hidden">
            <div className="flex flex-col gap-5 px-5 py-4 lg:overflow-y-auto">
              <Section title="Data">
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                  {(Object.keys(SOURCE_LABELS) as CardSource[]).map((source) => {
                    const Icon = SOURCE_ICON[source];
                    return (
                      <Tile key={source} active={query.source === source} onClick={() => pickSource(source)} icon={<Icon className="size-4" />}>
                        {SOURCE_LABELS[source].replace("Calendar events", "Events")}
                      </Tile>
                    );
                  })}
                </div>
              </Section>

              <Section title="Show as">
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                  {(Object.keys(DISPLAY_LABELS) as CardDisplay[]).map((display) => {
                    const Icon = DISPLAY_ICON[display];
                    return (
                      <Tile key={display} active={query.display === display} onClick={() => pickDisplay(display)} icon={<Icon className="size-4" />}>
                        {DISPLAY_LABELS[display]}
                      </Tile>
                    );
                  })}
                </div>
              </Section>

              <Section title="Measure">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Value">
                    <Select
                      size="sm"
                      value={query.measure}
                      onChange={(value) => setQuery({ measure: value as CardQuery["measure"] })}
                      options={caps.measures.map((measure) => ({ value: measure, label: MEASURE_LABELS[measure] }))}
                    />
                  </Field>
                  {query.measure !== "count" ? (
                    <Field label="Combine">
                      <Segmented
                        value={query.aggregate ?? "sum"}
                        onChange={(value) => setQuery({ aggregate: value as "sum" | "avg" })}
                        options={[
                          { value: "sum", label: "Total" },
                          { value: "avg", label: "Average" },
                        ]}
                      />
                    </Field>
                  ) : null}
                  {DISPLAY_NEEDS_GROUP[query.display] ? (
                    <Field label="Group by">
                      <Select
                        size="sm"
                        value={query.groupBy}
                        onChange={(value) => setQuery({ groupBy: value as CardQuery["groupBy"] })}
                        options={caps.groups
                          .filter((group) => group !== "none")
                          .filter((group) => (query.display === "line" ? ["day", "week", "month"].includes(group) : true))
                          .filter((group) => (query.display === "pie" ? !["day", "week", "month", "weekday"].includes(group) : true))
                          .map((group) => ({ value: group, label: GROUP_LABELS[group] }))}
                      />
                    </Field>
                  ) : null}
                </div>
              </Section>

              <Section title="Time range">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Date to use">
                    <Select
                      size="sm"
                      value={query.dateField}
                      onChange={(value) => setQuery({ dateField: value as CardQuery["dateField"] })}
                      options={caps.dateFields.map((field) => ({ value: field, label: DATE_FIELD_LABELS[field] }))}
                    />
                  </Field>
                  <Field label="Range">
                    <Select
                      size="sm"
                      value={query.range.preset}
                      onChange={(value) => setQuery({ range: { ...query.range, preset: value as CardRangePreset } })}
                      options={RANGE_ORDER.map((preset) => ({ value: preset, label: RANGE_LABELS[preset] }))}
                    />
                  </Field>
                  {query.range.preset === "custom" ? (
                    <>
                      <Field label="From">
                        <input
                          type="date"
                          value={query.range.from ?? ""}
                          onChange={(event) => setQuery({ range: { ...query.range, from: event.target.value || undefined } })}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="To">
                        <input
                          type="date"
                          value={query.range.to ?? ""}
                          onChange={(event) => setQuery({ range: { ...query.range, to: event.target.value || undefined } })}
                          className={inputClass}
                        />
                      </Field>
                    </>
                  ) : null}
                </div>
              </Section>

              <Section title="Filters">
                <div className="flex flex-col gap-3">
                  {caps.filters.includes("state") ? (
                    <Field label={query.source === "projects" ? "Projects" : "Items"}>
                      <Segmented
                        value={query.filters.state ?? "all"}
                        onChange={(value) => setFilters({ state: value as CardFilters["state"] })}
                        options={[
                          { value: "open", label: "Open" },
                          { value: "done", label: "Done" },
                          { value: "all", label: "All" },
                        ]}
                      />
                    </Field>
                  ) : null}
                  {caps.filters.includes("workspaceIds") && workspaces.length > 1 ? (
                    <Field label="Workspaces">
                      <Chips
                        options={workspaces.map((workspace) => ({ id: workspace.id, label: workspace.name, color: workspace.color }))}
                        selected={query.filters.workspaceIds ?? []}
                        onChange={(workspaceIds) => setFilters({ workspaceIds })}
                      />
                    </Field>
                  ) : null}
                  {caps.filters.includes("projectIds") && projects.length > 0 ? (
                    <Field label="Projects">
                      <Chips
                        searchable
                        options={projects.map((project) => ({ id: project.id, label: project.title || "Untitled project", color: project.color ?? undefined }))}
                        selected={query.filters.projectIds ?? []}
                        onChange={(projectIds) => setFilters({ projectIds })}
                      />
                    </Field>
                  ) : null}
                  {caps.filters.includes("priorities") ? (
                    <Field label="Priority">
                      <Chips
                        options={priorities.map((priority) => ({ id: priority, label: priority }))}
                        selected={(query.filters.priorities ?? []).map(priorityName)}
                        onChange={(list) => setFilters({ priorities: list })}
                      />
                    </Field>
                  ) : null}
                  {caps.filters.includes("statusIds") && statuses.length > 0 ? (
                    <Field label="Status">
                      <Chips options={statuses} selected={query.filters.statusIds ?? []} onChange={(statusIds) => setFilters({ statusIds })} />
                    </Field>
                  ) : null}
                  {caps.filters.includes("labelIds") && labels.length > 0 ? (
                    <Field label="Labels">
                      <Chips searchable options={labels} selected={query.filters.labelIds ?? []} onChange={(labelIds) => setFilters({ labelIds })} />
                    </Field>
                  ) : null}
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {caps.filters.includes("overdue") ? (
                      <Toggle checked={Boolean(query.filters.overdue)} onChange={(overdue) => setFilters({ overdue })}>
                        Only overdue
                      </Toggle>
                    ) : null}
                    {caps.filters.includes("hasDeadline") ? (
                      <Toggle checked={Boolean(query.filters.hasDeadline)} onChange={(hasDeadline) => setFilters({ hasDeadline })}>
                        Has a deadline
                      </Toggle>
                    ) : null}
                    {caps.filters.includes("scheduled") ? (
                      <Toggle checked={Boolean(query.filters.scheduled)} onChange={(scheduled) => setFilters({ scheduled })}>
                        On the calendar
                      </Toggle>
                    ) : null}
                    {caps.filters.includes("recurring") ? (
                      <Toggle checked={Boolean(query.filters.recurring)} onChange={(recurring) => setFilters({ recurring })}>
                        Repeating only
                      </Toggle>
                    ) : null}
                  </div>
                  {caps.filters.includes("text") ? (
                    <Field label="Name contains">
                      <input
                        value={query.filters.text ?? ""}
                        onChange={(event) => setFilters({ text: event.target.value })}
                        placeholder="Any name"
                        className={inputClass}
                      />
                    </Field>
                  ) : null}
                </div>
              </Section>

              <Section title="Display options">
                <div className="grid grid-cols-2 gap-2">
                  {query.display === "list" ? (
                    <>
                      <Field label="Sort by">
                        <Select
                          size="sm"
                          value={query.sort?.field ?? caps.sorts[0]}
                          onChange={(field) => setQuery({ sort: { field: field as NonNullable<CardQuery["sort"]>["field"], dir: query.sort?.dir ?? "asc" } })}
                          options={caps.sorts.map((field) => ({ value: field, label: SORT_LABELS[field] }))}
                        />
                      </Field>
                      <Field label="Order">
                        <Segmented
                          value={query.sort?.dir ?? "asc"}
                          onChange={(dir) => setQuery({ sort: { field: query.sort?.field ?? caps.sorts[0], dir: dir as "asc" | "desc" } })}
                          options={[
                            { value: "asc", label: "Ascending" },
                            { value: "desc", label: "Descending" },
                          ]}
                        />
                      </Field>
                      <Field label="Rows">
                        <NumberInput value={query.limit ?? 8} min={1} max={50} onChange={(limit) => setQuery({ limit })} />
                      </Field>
                    </>
                  ) : null}
                  {(query.display === "bar" || query.display === "pie") && !["day", "week", "month", "weekday", "priority", "due", "state"].includes(query.groupBy) ? (
                    <>
                      <Field label="Order groups">
                        <Segmented
                          value={query.sort?.field === "value" && query.sort.dir === "asc" ? "asc" : "desc"}
                          onChange={(dir) => setQuery({ sort: { field: "value", dir: dir as "asc" | "desc" } })}
                          options={[
                            { value: "desc", label: "Largest first" },
                            { value: "asc", label: "Smallest first" },
                          ]}
                        />
                      </Field>
                      <Field label="Most groups">
                        <NumberInput value={query.limit ?? 8} min={2} max={query.display === "pie" ? 7 : 12} onChange={(limit) => setQuery({ limit })} />
                      </Field>
                    </>
                  ) : null}
                  {query.display === "number" ? (
                    <div className="col-span-2">
                      <Toggle
                        checked={Boolean(query.compare)}
                        disabled={query.range.preset === "all"}
                        onChange={(compare) => setQuery({ compare })}
                      >
                        Compare with the period before {query.range.preset === "all" ? "(pick a time range first)" : ""}
                      </Toggle>
                    </div>
                  ) : null}
                  {query.display === "progress" ? (
                    <>
                      <Field label="Progress of">
                        <Segmented
                          value={query.progress ?? "completion"}
                          onChange={(progress) => setQuery({ progress: progress as "completion" | "goal" })}
                          options={[
                            ...(caps.completable ? [{ value: "completion", label: "Done out of all" }] : []),
                            { value: "goal", label: "Toward a goal" },
                          ]}
                        />
                      </Field>
                      {query.progress === "goal" ? (
                        <Field label="Goal">
                          <NumberInput value={query.goal ?? 10} min={1} max={100000} onChange={(goal) => setQuery({ goal })} />
                        </Field>
                      ) : null}
                    </>
                  ) : null}
                  {query.display !== "list" && query.display !== "pie" ? (
                    <Field label="Colour">
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from({ length: 8 }, (_, index) => (
                          <button
                            key={index}
                            type="button"
                            onClick={() => setQuery({ color: index })}
                            className={cn(
                              "flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition",
                              query.color === index && "ring-2 ring-foreground/60",
                            )}
                            style={{ background: seriesColor(index) }}
                            aria-label={`Colour ${index + 1}`}
                            aria-pressed={query.color === index}
                          >
                            {query.color === index ? <Check className="size-3.5 text-white" /> : null}
                          </button>
                        ))}
                      </div>
                    </Field>
                  ) : null}
                </div>
              </Section>
            </div>

            <div className="flex flex-col gap-4 border-t border-border bg-muted/40 px-5 py-4 lg:overflow-y-auto lg:border-l lg:border-t-0">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
                <Field label="Name">
                  <input value={title} onChange={(event) => setTitle(event.target.value.slice(0, 120))} placeholder={autoTitle} className={inputClass} />
                </Field>
                <Field label="Size">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Stepper value={w} min={min.w} max={12} onChange={(next) => setSize((current) => ({ ...current, w: next }))} label="Width" />
                    ×
                    <Stepper value={h} min={min.h} max={10} onChange={(next) => setSize((current) => ({ ...current, h: next }))} label="Height" />
                  </div>
                </Field>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Preview</p>
                <div
                  className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
                  style={{ height: previewHeight, width: previewWidth, minWidth: 220, maxWidth: "100%" }}
                >
                  <div className="flex h-9 shrink-0 items-center gap-1.5 px-3">
                    {(() => {
                      const Icon = DISPLAY_ICON[query.display];
                      return <Icon className="size-3.5 text-muted-foreground" />;
                    })()}
                    <span className="truncate text-sm font-medium text-foreground">{title.trim() || autoTitle}</span>
                  </div>
                  <div className="min-h-0 flex-1 px-3 pb-3">
                    <CustomCardView query={query} result={result} compact />
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{matchSummary(result)}</p>
              </div>
            </div>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {initial ? <Check className="size-4" /> : <Plus className="size-4" />}
              {initial ? "Save changes" : "Add to dashboard"}
            </button>
          </footer>
        </OverlayPanel>
      </OverlayFrame>
    </>,
    document.body,
  );
}

function matchSummary(result: ReturnType<typeof computeCard>) {
  switch (result.kind) {
    case "number":
    case "progress":
      return `${result.matched} ${result.matched === 1 ? "item matches" : "items match"} these settings.`;
    case "list":
      return `${result.total} ${result.total === 1 ? "item matches" : "items match"}; the card shows ${Math.min(result.total, result.rows.length)}.`;
    case "series":
      return `${result.points.length} ${result.points.length === 1 ? "group" : "groups"}.`;
  }
}

const inputClass =
  "w-full rounded-lg border border-border bg-input/30 px-2.5 py-1.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/40";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1" role="group" aria-label={label}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Tile({
  active,
  disabled,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg border px-1.5 py-2 text-[11px] transition-colors disabled:opacity-40",
        active ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {icon}
      <span className="w-full truncate text-center">{children}</span>
    </button>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex rounded-lg border border-border bg-input/20 p-0.5" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex-1 truncate rounded-md px-2 py-1 text-xs transition-colors",
            value === option.value ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, disabled, onChange, children }: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className={cn("flex items-center gap-2 text-sm text-foreground", disabled && "opacity-50")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="accent-[var(--primary)]" />
      {children}
    </label>
  );
}

function Chips({
  options,
  selected,
  onChange,
  searchable,
}: {
  options: { id: string; label: string; color?: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
}) {
  const [search, setSearch] = useState("");
  const showSearch = searchable && options.length > 10;
  const visible = showSearch && search ? options.filter((option) => option.label.toLowerCase().includes(search.toLowerCase())) : options;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id]);
  return (
    <div className="flex flex-col gap-1.5">
      {showSearch ? <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search…" className={inputClass} /> : null}
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
        {visible.map((option) => {
          const on = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(option.id)}
              className={cn(
                "flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                on ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {option.color ? <span className="size-2 shrink-0 rounded-full" style={{ background: option.color }} /> : null}
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
        {selected.length > 0 ? (
          <button type="button" onClick={() => onChange([])} className="px-1 text-xs text-muted-foreground underline-offset-2 hover:underline">
            Clear
          </button>
        ) : null}
      </div>
      {selected.length === 0 ? <span className="text-[11px] text-muted-foreground">None picked: all are included.</span> : null}
    </div>
  );
}

function NumberInput({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.round(next))));
      }}
      className={inputClass}
    />
  );
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (value: number) => void; label: string }) {
  return (
    <span className="flex items-center rounded-lg border border-border" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className="p-1 disabled:opacity-30" aria-label={`Smaller ${label.toLowerCase()}`}>
        <Minus className="size-3" />
      </button>
      <span className="w-5 text-center text-sm tabular-nums text-foreground">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} className="p-1 disabled:opacity-30" aria-label={`Larger ${label.toLowerCase()}`}>
        <Plus className="size-3" />
      </button>
    </span>
  );
}
