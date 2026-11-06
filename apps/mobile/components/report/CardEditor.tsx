import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import {
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
  displaysFor,
  fitQuery,
  groupsFor,
  priorityName,
  rangesFor,
  type CardDisplay,
  type CardFilters,
  type CardQuery,
  type CardRangePreset,
  type CardResult,
  type CardSource,
  type DashboardCard,
} from "@timely/contract/dashboard";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import DateTimeSheet from "../ui/DateTimeSheet";
import SegmentedControl from "../ui/SegmentedControl";
import { Stepper } from "../ui/RecurrenceEditor";
import { Field, PrimaryButton, Select } from "../ui/primitives";
import { ColorDot, GroupHint, GroupLabel, ListGroup, ListRow, SwitchRow } from "../settings/SettingsList";
import { pickSummary } from "../tasks/TaskMetaRows";
import { seriesColor, useDashboardData, useNow } from "../../lib/dashboard";
import { formatShortDate } from "../../lib/format";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import CustomCardView, { DISPLAY_ICON } from "./customCardView";

type Draft = { id: string; title: string; query: CardQuery };

const PRIORITIES = ["Urgent", "High", "Medium", "Low", "None"];
/** Groups a bar or donut keeps in their own order (dates, priorities), so "largest first" doesn't apply. */
const ORDERED_GROUPS = ["day", "week", "month", "weekday", "priority", "due", "state"];

/**
 * Changes a card you made from tasks, events or other data, on the phone:
 * the same query the desktop card workshop writes, as grouped rows (Data,
 * Measure, Time range, Filters, Display) under a live preview. Cards made
 * from one sheet or doc reopen FileCardBuilder instead. Sizes stay on the
 * bigger screens, so a saved edit keeps the card's size.
 */
export default function CardEditor({
  card,
  onClose,
  onSave,
}: {
  /** The card being changed; null keeps the sheet closed. */
  card: DashboardCard | null;
  onClose: () => void;
  onSave: (change: { title?: string; query: CardQuery }) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  // The draft belongs to the card it was started for; another card starts from its own setup.
  const live: Draft | null = card?.query ? (draft?.id === card.id ? draft : { id: card.id, title: card.title ?? "", query: fitQuery(card.query) }) : null;
  const close = () => {
    setDraft(null);
    onClose();
  };
  return (
    <BottomSheet
      open={live !== null}
      onClose={close}
      title="Edit card"
      footer={
        live ? (
          <PrimaryButton
            label="Save changes"
            testID="card-editor-save"
            onPress={() => {
              onSave({ title: live.title.trim() || undefined, query: live.query });
              setDraft(null);
            }}
          />
        ) : undefined
      }
    >
      {live ? <Editor draft={live} onChange={setDraft} /> : null}
    </BottomSheet>
  );
}

function Editor({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const { query, title } = draft;
  // The preview reads what the draft needs, even a source no other card on the board uses.
  const previewCards = useMemo<DashboardCard[]>(() => [{ id: draft.id, type: "custom", w: 4, h: 3, query }], [draft.id, query]);
  const { data, timeZone } = useDashboardData(previewCards);
  const now = useNow(60_000);
  const result = useMemo(() => computeCard(query, data, { now, timeZone }), [query, data, now, timeZone]);

  const setQuery = (change: Partial<CardQuery>) => onChange({ ...draft, query: fitQuery({ ...query, ...change }) });
  const setFilters = (change: Partial<CardFilters>) => {
    const filters: CardFilters = { ...query.filters, ...change };
    for (const key of Object.keys(filters) as (keyof CardFilters)[]) {
      const value = filters[key];
      if (value === undefined || value === false || value === "" || (Array.isArray(value) && value.length === 0)) delete filters[key];
    }
    setQuery({ filters });
  };
  const pickSource = (source: CardSource) =>
    onChange({ ...draft, query: fitQuery({ ...defaultQuery(source), display: query.display, groupBy: query.groupBy, range: query.range, color: query.color }) });

  const caps = SOURCE_CAPABILITIES[query.source];
  const workspaces = data.workspaces ?? [];
  const projects = (data.projects ?? []).filter((project) => !project.completedAt);
  const statuses = workspaces.flatMap((workspace) =>
    (workspace.status ?? []).map((status) => ({ id: status.id, label: workspaces.length > 1 ? `${status.name} · ${workspace.name}` : status.name, color: status.color })),
  );
  const labels = workspaces.flatMap((workspace) => (workspace.lables ?? []).map((label) => ({ id: label.id, label: label.name, color: label.color })));
  const autoTitle = describeQuery(query);
  const Icon = DISPLAY_ICON[query.display];
  const hasFilter = (key: keyof CardFilters) => caps.filters.includes(key);
  const showState = hasFilter("state") && !(query.display === "progress" && query.progress === "completion");
  const orderGroups = (query.display === "bar" || query.display === "pie") && !ORDERED_GROUPS.includes(query.groupBy);

  return (
    <View style={styles.body}>
      <View style={styles.titleCard}>
        <Field
          bare
          large
          value={title}
          onChangeText={(next) => onChange({ ...draft, title: next.slice(0, 120) })}
          placeholder={autoTitle}
          autoCapitalize="sentences"
          accessibilityLabel="Name"
        />
      </View>

      <View style={styles.section}>
        <View style={styles.preview} accessibilityLabel={`Preview of ${title.trim() || autoTitle}`}>
          <View style={styles.previewHead}>
            <Icon size={15} color={colors.mutedForeground} />
            <Text style={styles.previewTitle} numberOfLines={1}>
              {title.trim() || autoTitle}
            </Text>
          </View>
          <CustomCardView query={query} result={result} onOpen={() => undefined} />
        </View>
        <GroupHint>{matchSummary(result)}</GroupHint>
      </View>

      <View style={styles.section}>
        <GroupLabel>Data</GroupLabel>
        <ListGroup>
          <Select
            trigger="row"
            label="From"
            value={query.source}
            onChange={(source) => pickSource(source as CardSource)}
            options={(Object.keys(SOURCE_LABELS) as CardSource[]).map((source) => ({ value: source, label: SOURCE_LABELS[source] }))}
          />
          <Select
            trigger="row"
            label="Show as"
            value={query.display}
            onChange={(display) => setQuery({ display: display as CardDisplay })}
            options={displaysFor(query.source).map((display) => ({ value: display, label: DISPLAY_LABELS[display] }))}
          />
          {caps.measures.length > 1 ? (
            <Select
              trigger="row"
              label="Value"
              value={query.measure}
              onChange={(measure) => setQuery({ measure: measure as CardQuery["measure"] })}
              options={caps.measures.map((measure) => ({ value: measure, label: MEASURE_LABELS[measure] }))}
            />
          ) : null}
          {query.measure !== "count" ? (
            <ListRow
              title="Combine"
              trailing={
                <SegmentedControl
                  size="sm"
                  accessibilityLabel="Combine"
                  value={query.aggregate ?? "sum"}
                  onChange={(aggregate) => setQuery({ aggregate })}
                  options={[
                    { value: "sum", label: "Total" },
                    { value: "avg", label: "Average" },
                  ]}
                />
              }
            />
          ) : null}
          {DISPLAY_NEEDS_GROUP[query.display] ? (
            <Select
              trigger="row"
              label="Group by"
              value={query.groupBy}
              onChange={(groupBy) => setQuery({ groupBy: groupBy as CardQuery["groupBy"] })}
              options={groupsFor(query).map((group) => ({ value: group, label: GROUP_LABELS[group] }))}
            />
          ) : null}
        </ListGroup>
      </View>

      <View style={styles.section}>
        <GroupLabel>Time range</GroupLabel>
        <ListGroup>
          {caps.dateFields.length > 1 ? (
            <Select
              trigger="row"
              label="Date to use"
              value={query.dateField}
              onChange={(dateField) => setQuery({ dateField: dateField as CardQuery["dateField"] })}
              options={caps.dateFields.map((field) => ({ value: field, label: DATE_FIELD_LABELS[field] }))}
            />
          ) : null}
          <Select
            trigger="row"
            label="Range"
            value={query.range.preset}
            onChange={(preset) => setQuery({ range: { ...query.range, preset: preset as CardRangePreset } })}
            options={rangesFor(query.dateField).map((preset) => ({ value: preset, label: RANGE_LABELS[preset] }))}
          />
          {query.range.preset === "custom" ? (
            <DateRow title="From" value={query.range.from} onChange={(from) => setQuery({ range: { ...query.range, from } })} />
          ) : null}
          {query.range.preset === "custom" ? (
            <DateRow title="To" value={query.range.to} onChange={(to) => setQuery({ range: { ...query.range, to } })} />
          ) : null}
        </ListGroup>
      </View>

      <View style={styles.section}>
        <GroupLabel>Filters</GroupLabel>
        <ListGroup>
          {showState ? (
            <ListRow
              title={query.source === "projects" ? "Projects" : "Items"}
              trailing={
                <SegmentedControl
                  size="sm"
                  accessibilityLabel="Items"
                  value={query.filters.state ?? "all"}
                  onChange={(state) => setFilters({ state })}
                  options={[
                    { value: "open", label: "Open" },
                    { value: "done", label: "Done" },
                    { value: "all", label: "All" },
                  ]}
                />
              }
            />
          ) : null}
          {hasFilter("workspaceIds") && workspaces.length > 1 ? (
            <PickRow
              title="Workspaces"
              all="All workspaces"
              options={workspaces.map((workspace) => ({ id: workspace.id, label: workspace.name, color: workspace.color }))}
              selected={query.filters.workspaceIds ?? []}
              onChange={(workspaceIds) => setFilters({ workspaceIds })}
            />
          ) : null}
          {hasFilter("projectIds") && projects.length > 0 ? (
            <PickRow
              title="Projects"
              all="All projects"
              searchable={projects.length > 10}
              options={projects.map((project) => ({ id: project.id, label: project.title || "Untitled project", color: project.color ?? undefined }))}
              selected={query.filters.projectIds ?? []}
              onChange={(projectIds) => setFilters({ projectIds })}
            />
          ) : null}
          {hasFilter("priorities") ? (
            <PickRow
              title="Priority"
              all="Any priority"
              options={PRIORITIES.map((priority) => ({ id: priority, label: priority }))}
              selected={(query.filters.priorities ?? []).map(priorityName)}
              onChange={(priorities) => setFilters({ priorities })}
            />
          ) : null}
          {hasFilter("statusIds") && statuses.length > 0 ? (
            <PickRow title="Status" all="Any status" options={statuses} selected={query.filters.statusIds ?? []} onChange={(statusIds) => setFilters({ statusIds })} />
          ) : null}
          {hasFilter("labelIds") && labels.length > 0 ? (
            <PickRow
              title="Labels"
              all="Any label"
              searchable={labels.length > 10}
              options={labels}
              selected={query.filters.labelIds ?? []}
              onChange={(labelIds) => setFilters({ labelIds })}
            />
          ) : null}
          {hasFilter("overdue") ? <SwitchRow title="Only overdue" value={Boolean(query.filters.overdue)} onChange={(overdue) => setFilters({ overdue })} /> : null}
          {hasFilter("hasDeadline") ? (
            <SwitchRow title="Has a deadline" value={Boolean(query.filters.hasDeadline)} onChange={(hasDeadline) => setFilters({ hasDeadline })} />
          ) : null}
          {hasFilter("scheduled") ? (
            <SwitchRow title="On the calendar" value={Boolean(query.filters.scheduled)} onChange={(scheduled) => setFilters({ scheduled })} />
          ) : null}
          {hasFilter("recurring") ? (
            <SwitchRow title="Repeating only" value={Boolean(query.filters.recurring)} onChange={(recurring) => setFilters({ recurring })} />
          ) : null}
          {hasFilter("text") ? (
            <ListRow
              title="Name contains"
              trailing={
                <View style={styles.inline}>
                  <Field
                    bare
                    align="right"
                    value={query.filters.text ?? ""}
                    onChangeText={(text) => setFilters({ text })}
                    placeholder="Any name"
                    autoCapitalize="none"
                    accessibilityLabel="Name contains"
                  />
                </View>
              }
            />
          ) : null}
        </ListGroup>
      </View>

      <View style={styles.section}>
        <GroupLabel>Display</GroupLabel>
        <ListGroup>
          {query.display === "list" ? (
            <Select
              trigger="row"
              label="Sort by"
              value={query.sort?.field ?? caps.sorts[0]}
              onChange={(field) => setQuery({ sort: { field: field as NonNullable<CardQuery["sort"]>["field"], dir: query.sort?.dir ?? "asc" } })}
              options={caps.sorts.map((field) => ({ value: field, label: SORT_LABELS[field] }))}
            />
          ) : null}
          {query.display === "list" ? (
            <ListRow
              title="Order"
              trailing={
                <SegmentedControl
                  size="sm"
                  accessibilityLabel="Order"
                  value={query.sort?.dir ?? "asc"}
                  onChange={(dir) => setQuery({ sort: { field: query.sort?.field ?? caps.sorts[0], dir } })}
                  options={[
                    { value: "asc", label: "Ascending" },
                    { value: "desc", label: "Descending" },
                  ]}
                />
              }
            />
          ) : null}
          {query.display === "list" ? (
            <ListRow title="Rows" trailing={<Stepper value={query.limit ?? 8} min={1} max={50} label="" onChange={(limit) => setQuery({ limit })} />} />
          ) : null}
          {orderGroups ? (
            <ListRow
              title="Order"
              trailing={
                <SegmentedControl
                  size="sm"
                  accessibilityLabel="Order groups"
                  value={query.sort?.field === "value" && query.sort.dir === "asc" ? "asc" : "desc"}
                  onChange={(dir) => setQuery({ sort: { field: "value", dir } })}
                  options={[
                    { value: "desc", label: "Largest first" },
                    { value: "asc", label: "Smallest first" },
                  ]}
                />
              }
            />
          ) : null}
          {orderGroups ? (
            <ListRow
              title="Most groups"
              trailing={<Stepper value={query.limit ?? 8} min={2} max={query.display === "pie" ? 7 : 12} label="" onChange={(limit) => setQuery({ limit })} />}
            />
          ) : null}
          {query.display === "number" && query.range.preset !== "all" ? (
            <SwitchRow title="Compare" meta="With the period before" value={Boolean(query.compare)} onChange={(compare) => setQuery({ compare })} />
          ) : null}
          {query.display === "number" && query.range.preset === "all" ? <ListRow title="Compare" meta="Pick a time range first" disabled /> : null}
          {query.display === "progress" && caps.completable ? (
            <Select
              trigger="row"
              label="Progress of"
              value={query.progress ?? "completion"}
              onChange={(progress) => setQuery({ progress: progress as "completion" | "goal" })}
              options={[
                { value: "completion", label: "Done out of all" },
                { value: "goal", label: "Toward a goal" },
              ]}
            />
          ) : null}
          {query.display === "progress" && query.progress === "goal" ? (
            <ListRow
              title="Goal"
              meta={query.measure === "count" ? `Number of ${SOURCE_LABELS[query.source].toLowerCase()}` : MEASURE_LABELS[query.measure]}
              trailing={
                <View style={styles.inlineShort}>
                  <Field
                    bare
                    align="right"
                    value={String(query.goal ?? 10)}
                    keyboardType="number-pad"
                    onChangeText={(text) => {
                      const goal = Number(text.replace(/[^0-9]/g, ""));
                      if (Number.isFinite(goal) && goal > 0) setQuery({ goal: Math.min(100000, goal) });
                    }}
                    accessibilityLabel="Goal"
                  />
                </View>
              }
            />
          ) : null}
          {query.display !== "list" && query.display !== "pie" ? (
            <ListRow title="Colour" trailing={<Swatches value={query.color ?? 0} onChange={(color) => setQuery({ color })} />} />
          ) : null}
        </ListGroup>
      </View>
    </View>
  );
}

function matchSummary(result: CardResult) {
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

type PickOption = { id: string; label: string; color?: string };

/** A multi-pick filter: one summary row that opens a page of the choices, "All …" first. */
function PickRow({
  title,
  all,
  options,
  selected,
  onChange,
  searchable,
}: {
  title: string;
  /** The first choice, picked when nothing narrows the card down. */
  all: string;
  options: PickOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const picked = options.filter((option) => selected.includes(option.id));
  const needle = search.trim().toLowerCase();
  const shown = needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id]);
  const dots = picked.filter((option) => option.color).slice(0, 3);
  return (
    <View>
      <ListRow
        title={title}
        trailing={
          picked.length ? (
            <View style={styles.summary}>
              {dots.length ? (
                <View style={styles.dots}>
                  {dots.map((option) => (
                    <ColorDot key={option.id} color={option.color} size={8} />
                  ))}
                </View>
              ) : null}
              <Text numberOfLines={1} style={styles.summaryText}>
                {pickSummary(picked.map((option) => option.label))}
              </Text>
            </View>
          ) : (
            all
          )
        }
        onPress={() => setOpen(true)}
      />
      <BottomSheet
        open={open}
        onClose={() => {
          setOpen(false);
          setSearch("");
        }}
        title={title}
        subtitle={picked.length ? `${picked.length} picked` : undefined}
      >
        <View style={styles.page}>
          {searchable ? <Field value={search} onChangeText={setSearch} placeholder="Search…" autoCapitalize="none" accessibilityLabel={`Search ${title.toLowerCase()}`} /> : null}
          <View>
            {needle ? null : (
              <SheetOption selected={selected.length === 0} onSelect={() => onChange([])}>
                {all}
              </SheetOption>
            )}
            {shown.map((option) => (
              <SheetOption
                key={option.id}
                selected={selected.includes(option.id)}
                leading={option.color ? <ColorDot color={option.color} /> : undefined}
                onSelect={() => toggle(option.id)}
              >
                {option.label}
              </SheetOption>
            ))}
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}

/** A From or To row of a custom range: the date on the right, Timely's date picker on tap. */
function DateRow({ title, value, onChange }: { title: string; value?: string; onChange: (value: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <ListRow title={title} trailing={value ? formatShortDate(`${value}T12:00:00`) : "Pick a date"} onPress={() => setOpen(true)} />
      <DateTimeSheet
        open={open}
        mode="date"
        title={title}
        value={value ? new Date(`${value}T12:00:00`) : null}
        clearable
        onClose={() => setOpen(false)}
        onChange={(next) => onChange(next ? next.toLocaleDateString("en-CA") : undefined)}
      />
    </View>
  );
}

/** The eight chart colours, picked in place. */
function Swatches({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel="Colour">
      {Array.from({ length: 8 }, (_, index) => (
        <Pressable
          key={index}
          accessibilityRole="radio"
          accessibilityLabel={`Colour ${index + 1}`}
          accessibilityState={{ selected: value === index }}
          hitSlop={3}
          onPress={() => onChange(index)}
          style={[styles.swatch, { backgroundColor: seriesColor(index) }, value === index && styles.swatchOn]}
        >
          {value === index ? <Check size={13} color="#ffffff" strokeWidth={3} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { gap: 14, paddingBottom: 8 },
  section: { gap: 6 },
  page: { gap: 10 },
  titleCard: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 14, paddingVertical: 12 },
  preview: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14, gap: 12 },
  previewHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  previewTitle: { flex: 1, color: colors.foreground, fontSize: 14, fontWeight: "600" },
  inline: { width: 170 },
  inlineShort: { width: 90 },
  summary: { flexShrink: 1, maxWidth: 190, flexDirection: "row", alignItems: "center", gap: 6 },
  dots: { flexDirection: "row", gap: 3 },
  summaryText: { flexShrink: 1, color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  swatches: { flexDirection: "row", gap: 6 },
  swatch: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  swatchOn: { borderWidth: 2, borderColor: colors.foreground },
}));
