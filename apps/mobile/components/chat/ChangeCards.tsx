import { createElement, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  ListChecks,
  Pencil,
  Plus,
  RotateCcw,
  Sun,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react-native";
import {
  reviewGroups,
  reviewProgress,
  reviewStats,
  type DocBlock,
  type ReviewField,
  type ReviewGroup,
  type ReviewNames,
  type ReviewProgress,
  type ReviewSheetTab,
  type ReviewTaskRow,
} from "@timely/contract/changeReview";
import type { ChatStep } from "../../lib/chat/types";
import {
  useDocsQuery,
  useProjectsQuery,
  useSheetsQuery,
  useTasksQuery,
  useWorkspacesQuery,
} from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import { LogoSpinner } from "../ui/TimelyLogo";
import { stepIcon, stepTarget } from "./chatMeta";
import { Action } from "./shared";

/** Names for the ids a plan mentions, from the lists the app already has. */
function useReviewNames(): ReviewNames {
  const workspaces = useWorkspacesQuery().data;
  const projects = useProjectsQuery().data;
  const sheets = useSheetsQuery().data;
  const docs = useDocsQuery().data;
  const tasks = useTasksQuery().data;
  return useMemo(() => {
    const index = <T,>(
      items: T[] | undefined,
      id: (item: T) => string,
      name: (item: T) => string | undefined,
    ) => {
      const map = new Map<string, string>();
      for (const item of items ?? []) {
        const value = name(item);
        if (value) map.set(id(item), value);
      }
      return (key: string) => map.get(key);
    };
    const all = workspaces ?? [];
    return {
      workspace: index(
        all,
        (w) => w.id,
        (w) => w.name,
      ),
      project: index(
        projects,
        (p) => p.id,
        (p) => p.title,
      ),
      task: index(
        tasks,
        (t) => t.id,
        (t) => t.name,
      ),
      doc: index(
        docs,
        (d) => d.id,
        (d) => d.title,
      ),
      sheet: (id: string) => {
        const sheet = sheets?.find((s) => s.id === id);
        return sheet
          ? {
              title: sheet.title,
              icon: sheet.icon ?? undefined,
              tabs: sheet.tabs,
              columns: sheet.columns,
            }
          : undefined;
      },
      label: index(
        all.flatMap((w) => w.lables ?? []),
        (l) => l.id,
        (l) => l.name,
      ),
      status: index(
        all.flatMap((w) => w.status ?? []),
        (s) => s.id,
        (s) => s.name,
      ),
      customField: index(
        all.flatMap((w) => w.customFields ?? []),
        (f) => f.id,
        (f) => f.name,
      ),
    };
  }, [workspaces, projects, sheets, docs, tasks]);
}

/** Apply or set aside one change while the proposal waits for review. */
export type ReviewActions = {
  apply: (steps: number[]) => void;
  discard: (steps: number[], keep: boolean) => void;
  disabled?: boolean;
};

const KIND_ICONS: Record<string, LucideIcon> = {
  sheet: Table2,
  doc: FileText,
  tasks: ListChecks,
  events: CalendarDays,
};

function stateColor(state: ReviewProgress["state"]) {
  if (state === "done") return colors.success;
  if (state === "failed") return colors.destructive;
  if (state === "active" || state === "partial") return colors.primary;
  return colors.mutedForeground;
}

function StatusPill({ progress }: { progress: ReviewProgress }) {
  const color = stateColor(progress.state);
  const label =
    progress.state === "partial" ||
    (progress.state === "active" && progress.total > 1)
      ? `${progress.done} of ${progress.total}`
      : {
          pending: "Pending",
          active: "Applying",
          done: "Done",
          failed: "Failed",
          discarded: "Discarded",
          partial: "",
        }[progress.state];
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor:
            progress.state === "pending" || progress.state === "discarded"
              ? colors.muted
              : `${color}1F`,
        },
      ]}
    >
      {progress.state === "active" ? (
        <LogoSpinner size={10} color={color} />
      ) : null}
      {progress.state === "done" ? (
        <Check size={11} color={color} strokeWidth={3} />
      ) : null}
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

// ------------------------------------------------------------ sheet rows

const ROWS_SHOWN = 4;

function SheetTab({ tab, steps }: { tab: ReviewSheetTab; steps: ChatStep[] }) {
  const [all, setAll] = useState(false);
  const rows = all ? tab.rows : tab.rows.slice(0, ROWS_SHOWN);
  const amount = tab.amount >= 0 ? tab.columns[tab.amount] : undefined;
  return (
    <View style={styles.section}>
      <View style={styles.tabHead}>
        <Text style={styles.tabName}>{tab.name}</Text>
        <Text style={styles.muted13}>
          {tab.rows.length} {tab.rows.length === 1 ? "entry" : "entries"}
        </Text>
      </View>
      {tab.same.length ? (
        <Text style={[styles.muted13, styles.same]}>
          Each with{" "}
          {tab.same.map((field) => `${field.label} ${field.value}`).join(", ")}
        </Text>
      ) : null}
      {rows.map((row, r) => {
        // The entry's name, its date and the rest in one line, the amount on the right.
        const others = tab.columns
          .map((column, i) =>
            i !== tab.lead && i !== tab.amount && i !== tab.date && row.cells[i]
              ? column.numeric
                ? `${column.name} ${row.cells[i]}`
                : row.cells[i]
              : "",
          )
          .filter(Boolean);
        const line = [tab.date >= 0 ? row.cells[tab.date] : "", ...others]
          .filter(Boolean)
          .join(" · ");
        const discarded = steps[row.step]?.status === "discarded";
        return (
          <View key={r} style={styles.row}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={1}
                style={[styles.rowTitle, discarded && styles.struck]}
              >
                {tab.lead >= 0 ? row.cells[tab.lead] : row.cells[0]}
              </Text>
              {line ? (
                <Text numberOfLines={1} style={styles.muted13}>
                  {line}
                </Text>
              ) : null}
            </View>
            {amount && row.cells[tab.amount] ? (
              <Text style={styles.amount}>
                {amount.unit ? `${amount.unit} ` : ""}
                {row.cells[tab.amount]}
              </Text>
            ) : null}
          </View>
        );
      })}
      {tab.rows.length > ROWS_SHOWN ? (
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityState={{ expanded: all }}
          onPress={() => setAll(!all)}
          style={styles.more}
        >
          <Text style={styles.moreText}>
            {all ? "Show fewer" : `Show all ${tab.rows.length}`}
          </Text>
        </AnimatedPressable>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ docs

/** A doc's blocks as the doc will show them: tick boxes, not "[ ]". */
export function DocBlocks({
  blocks,
  small = false,
}: {
  blocks: DocBlock[];
  small?: boolean;
}) {
  const text = small ? styles.docSmall : styles.docText;
  return (
    <View style={{ gap: small ? 2 : 4 }}>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <Text
                key={i}
                style={[
                  styles.docHeading,
                  block.level <= 1 && { fontSize: 17 },
                  i > 0 && { marginTop: 6 },
                ]}
              >
                {block.text}
              </Text>
            );
          case "check":
            return (
              <View
                key={i}
                style={[styles.docLine, { paddingLeft: block.depth * 18 }]}
              >
                <View
                  accessibilityLabel={block.checked ? "Ticked" : "Not ticked"}
                  style={[
                    styles.box,
                    block.checked && {
                      backgroundColor: colors.primary,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  {block.checked ? (
                    <Check
                      size={12}
                      color={colors.primaryForeground}
                      strokeWidth={3}
                    />
                  ) : null}
                </View>
                <Text
                  style={[text, { flex: 1 }, block.checked && styles.struck]}
                >
                  {block.text}
                </Text>
              </View>
            );
          case "bullet":
            return (
              <View
                key={i}
                style={[styles.docLine, { paddingLeft: block.depth * 18 }]}
              >
                <Text style={[text, styles.bullet]}>{block.marker}</Text>
                <Text style={[text, { flex: 1 }]}>{block.text}</Text>
              </View>
            );
          case "quote":
            return (
              <Text key={i} style={[text, styles.quote]}>
                {block.text}
              </Text>
            );
          case "code":
            return (
              <Text key={i} style={styles.code}>
                {block.text}
              </Text>
            );
          case "divider":
            return <View key={i} style={styles.divider} />;
          case "image":
            return (
              <Text key={i} style={styles.muted13}>
                Image{block.alt ? `: ${block.alt}` : ""}
              </Text>
            );
          default:
            return (
              <Text key={i} style={text}>
                {block.text}
              </Text>
            );
        }
      })}
    </View>
  );
}

const DOC_SHOWN = 14;

function DocBody({ group }: { group: Extract<ReviewGroup, { kind: "doc" }> }) {
  const [all, setAll] = useState(false);
  const blocks = all ? group.blocks : group.blocks.slice(0, DOC_SHOWN);
  return (
    <>
      {group.fields.length ? <FieldRows fields={group.fields} /> : null}
      {blocks.length ? (
        <View style={[styles.section, { padding: 14 }]}>
          <DocBlocks blocks={blocks} />
        </View>
      ) : null}
      {group.blocks.length > DOC_SHOWN ? (
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityState={{ expanded: all }}
          onPress={() => setAll(!all)}
          style={styles.more}
        >
          <Text style={styles.moreText}>
            {all ? "Show less" : "Show the whole doc"}
          </Text>
        </AnimatedPressable>
      ) : null}
    </>
  );
}

// ----------------------------------------------------------------- tasks

const TASK_LEADS: Record<
  ReviewTaskRow["action"],
  { icon: LucideIcon; label: string }
> = {
  create: { icon: Plus, label: "New" },
  complete: { icon: Check, label: "Mark done" },
  reopen: { icon: RotateCcw, label: "Reopen" },
  focus: { icon: Sun, label: "Focus" },
  update: { icon: Pencil, label: "Changes" },
  other: { icon: Pencil, label: "Changes" },
};

function changeText(field: ReviewField) {
  return field.was
    ? `${field.label} ${field.was} → ${field.value}`
    : `${field.label} ${field.value}`;
}

function TaskRows({
  group,
  steps,
  onLink,
}: {
  group: Extract<ReviewGroup, { kind: "tasks" }>;
  steps: ChatStep[];
  onLink: (href: string) => void;
}) {
  return (
    <View style={styles.section}>
      {group.rows.map((row, r) => {
        const lead = TASK_LEADS[row.action];
        const step = steps[row.step];
        const target = step?.status === "done" ? stepTarget(step) : null;
        const line = row.changes.length
          ? row.changes
              .filter((field) => !field.blocks)
              .map(changeText)
              .join(" · ")
          : row.meta.join(" · ");
        const done = row.action === "complete";
        const leadStyle =
          row.action === "create"
            ? styles.leadNew
            : done
              ? { backgroundColor: colors.success, borderColor: colors.success }
              : styles.leadEdit;
        const content = (
          <>
            <View
              accessibilityLabel={lead.label}
              style={[styles.lead, leadStyle]}
            >
              {createElement(lead.icon, {
                size: 12,
                strokeWidth: 2.5,
                color:
                  row.action === "create"
                    ? colors.primary
                    : done
                      ? "#fff"
                      : colors.mutedForeground,
              })}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={2}
                style={[
                  styles.rowTitle,
                  step?.status === "discarded" && styles.struck,
                  target && { color: colors.primary },
                ]}
              >
                {row.title}
              </Text>
              {line ? <Text style={styles.muted13}>{line}</Text> : null}
              {row.blocks?.length ? (
                <DocBlocks blocks={row.blocks.slice(0, 5)} small />
              ) : null}
              {step?.status === "failed" && step.error ? (
                <Text style={styles.errorText}>{step.error}</Text>
              ) : null}
            </View>
          </>
        );
        return target ? (
          <AnimatedPressable
            key={r}
            accessibilityRole="link"
            onPress={() => onLink(target.href)}
            style={[styles.row, r > 0 && styles.rowLine]}
          >
            {content}
          </AnimatedPressable>
        ) : (
          <View key={r} style={[styles.row, r > 0 && styles.rowLine]}>
            {content}
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- events

function EventRows({
  group,
}: {
  group: Extract<ReviewGroup, { kind: "events" }>;
}) {
  return (
    <View style={styles.section}>
      {group.rows.map((row, r) => (
        <View key={r} style={[styles.row, r > 0 && styles.rowLine]}>
          <View style={styles.eventBar} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={styles.rowTitle}>
              {row.title}
            </Text>
            <Text style={styles.muted13}>
              {[
                row.when,
                ...(row.changes.length
                  ? row.changes.map(changeText)
                  : row.meta),
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- fields

function FieldRows({ fields }: { fields: ReviewField[] }) {
  return (
    <View style={styles.section}>
      {fields.map((field, i) => (
        <View
          key={field.label}
          style={[
            field.blocks ? styles.fieldBlock : styles.field,
            i > 0 && styles.rowLine,
          ]}
        >
          <Text style={styles.fieldLabel}>{field.label}</Text>
          {field.blocks ? (
            <DocBlocks blocks={field.blocks} small />
          ) : (
            <View style={styles.fieldValueWrap}>
              {field.color ? (
                <View style={[styles.dot, { backgroundColor: field.color }]} />
              ) : null}
              <Text style={styles.fieldValue}>
                {field.was ? (
                  <Text style={styles.struck}>{field.was}</Text>
                ) : null}
                {field.was ? " → " : ""}
                {field.value}
              </Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ card

function GroupCard({
  group,
  steps,
  activeIndex,
  muted,
  open,
  onToggle,
  onLink,
  review,
}: {
  group: ReviewGroup;
  steps: ChatStep[];
  activeIndex: number;
  muted: boolean;
  open: boolean;
  onToggle: () => void;
  onLink: (href: string) => void;
  review?: ReviewActions;
}) {
  const progress = reviewProgress(group, steps, activeIndex);
  const own = group.steps.map((i) => steps[i]).filter(Boolean);
  const waiting = group.steps.filter(
    (i) =>
      steps[i] && steps[i].status !== "done" && steps[i].status !== "discarded",
  );
  const setAside = group.steps.filter((i) => steps[i]?.status === "discarded");
  const removal = group.removal && progress.state !== "done";
  const opens =
    group.kind === "tasks" || group.kind === "events" || group.removal
      ? undefined
      : own.find((s) => s.status === "done");
  const target = opens ? stepTarget(opens) : null;
  const icon = "icon" in group && group.icon ? group.icon : undefined;
  let body: ReactNode = null;
  if (group.kind === "sheet")
    body = group.tabs.map((tab) => (
      <SheetTab key={tab.name} tab={tab} steps={steps} />
    ));
  else if (group.kind === "tasks")
    body = <TaskRows group={group} steps={steps} onLink={onLink} />;
  else if (group.kind === "doc") body = <DocBody group={group} />;
  else if (group.kind === "events") body = <EventRows group={group} />;
  else
    body = (
      <>
        {group.table ? <SheetTab tab={group.table} steps={steps} /> : null}
        {group.fields.length ? <FieldRows fields={group.fields} /> : null}
      </>
    );
  const error =
    group.kind !== "tasks" && progress.state === "failed"
      ? progress.error
      : undefined;
  return (
    <View
      accessibilityLabel={`${group.eyebrow}: ${group.title}`}
      style={[
        styles.card,
        (progress.state === "failed" || removal) && {
          borderColor: `${colors.destructive}66`,
        },
        muted && { opacity: 0.75 },
      ]}
    >
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={styles.head}
      >
        <View
          style={[
            styles.tile,
            removal && { backgroundColor: `${colors.destructive}1A` },
          ]}
        >
          {icon ? (
            <Text style={{ fontSize: 18 }}>{icon}</Text>
          ) : (
            createElement(
              group.kind === "change"
                ? stepIcon(group.tool)
                : KIND_ICONS[group.kind],
              {
                size: 18,
                color: removal ? colors.destructive : colors.mutedForeground,
              },
            )
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.eyebrow}>{group.eyebrow}</Text>
          <Text
            numberOfLines={2}
            style={[
              styles.title,
              progress.state === "discarded" && styles.struck,
            ]}
          >
            {group.title}
          </Text>
          {group.meta ? (
            <Text numberOfLines={1} style={styles.muted13}>
              {group.meta}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <StatusPill progress={progress} />
          {group.removal ? (
            <View style={styles.removes}>
              <Text style={styles.removesText}>Removes</Text>
            </View>
          ) : null}
        </View>
        {open ? (
          <ChevronDown size={16} color={colors.mutedForeground} />
        ) : (
          <ChevronRight size={16} color={colors.mutedForeground} />
        )}
      </AnimatedPressable>
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      {open ? (
        <>
          {body}
          {target || (review && (waiting.length || setAside.length)) ? (
            <View style={styles.foot}>
              {target ? (
                <AnimatedPressable
                  accessibilityRole="link"
                  onPress={() => onLink(target.href)}
                  style={styles.openLink}
                >
                  <Text style={styles.moreText}>Open {target.noun}</Text>
                  <ArrowUpRight size={14} color={colors.primary} />
                </AnimatedPressable>
              ) : null}
              {review && waiting.length ? (
                <View style={styles.actions}>
                  <View style={{ flex: 1 }}>
                    <Action
                      label="Discard"
                      icon={Trash2}
                      compact
                      tone="destructive"
                      disabled={review.disabled}
                      onPress={() => review.discard(waiting, false)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Action
                      label="Apply this"
                      icon={Check}
                      compact
                      disabled={review.disabled}
                      onPress={() => review.apply(waiting)}
                    />
                  </View>
                </View>
              ) : review && setAside.length ? (
                <View style={styles.actions}>
                  <Text style={[styles.muted13, { flex: 1 }]}>
                    Won’t be applied
                  </Text>
                  <Action
                    label="Bring back"
                    icon={RotateCcw}
                    compact
                    disabled={review.disabled}
                    onPress={() => review.discard(setAside, true)}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/** What the plan adds up to, above the cards: "30 Sheet entries · 5 New tasks". */
function SummaryStrip({ groups }: { groups: ReviewGroup[] }) {
  const stats = reviewStats(groups);
  if (stats.reduce((n, stat) => n + stat.value, 0) < 2) return null;
  return (
    <View accessibilityLabel="Summary" style={styles.stats}>
      {stats.map((stat) => (
        <View key={stat.label} style={styles.stat}>
          <Text style={styles.statValue}>{stat.value}</Text>
          <Text numberOfLines={1} style={styles.muted13}>
            {stat.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A plan as review cards: what it adds up to, then one card per change the
 * person will get (every entry for a sheet, the tasks, a doc), each drawn by
 * a fixed design for its kind. One card is open at a time: a failed one,
 * else the first. `activeIndex` marks the step being applied right now.
 */
export default function ChangeCards({
  steps,
  onLink,
  activeIndex = -1,
  muted = false,
  review,
}: {
  steps: ChatStep[];
  onLink: (href: string) => void;
  activeIndex?: number;
  muted?: boolean;
  /** While the proposal waits for review: each card's own Apply and Discard. */
  review?: ReviewActions;
}) {
  const names = useReviewNames();
  const groups = useMemo(() => reviewGroups(steps, names), [steps, names]);
  const failed = groups.find((group) =>
    group.steps.some((i) => steps[i]?.status === "failed"),
  )?.key;
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const open =
    picked === undefined ? (failed ?? groups[0]?.key ?? null) : picked;
  return (
    <View style={{ gap: 10 }}>
      <SummaryStrip groups={groups} />
      {groups.map((group) => (
        <GroupCard
          key={group.key}
          group={group}
          steps={steps}
          activeIndex={activeIndex}
          muted={muted}
          open={open === group.key}
          onToggle={() => setPicked(open === group.key ? null : group.key)}
          onLink={onLink}
          review={review}
        />
      ))}
    </View>
  );
}

const styles = createThemedStyleSheet(() => ({
  card: {
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 64,
  },
  tile: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: colors.mutedForeground,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
    color: colors.foreground,
  },
  struck: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pillText: { fontSize: 11, fontWeight: "500" },
  removes: {
    borderRadius: 999,
    backgroundColor: `${colors.destructive}1A`,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  removesText: { color: colors.destructive, fontSize: 11, fontWeight: "500" },
  section: { borderTopWidth: 1, borderTopColor: colors.border },
  tabHead: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 2,
  },
  tabName: { fontSize: 14, fontWeight: "600", color: colors.foreground },
  same: { paddingHorizontal: 14, paddingBottom: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.border },
  rowTitle: { fontSize: 15, lineHeight: 20, color: colors.foreground },
  muted13: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    color: colors.mutedForeground,
  },
  amount: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  more: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  moreText: { fontSize: 14, fontWeight: "600", color: colors.primary },
  lead: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    marginTop: 1,
  },
  leadNew: { borderColor: `${colors.primary}99`, borderStyle: "dashed" },
  leadEdit: { borderColor: colors.border },
  eventBar: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  docText: { fontSize: 15, lineHeight: 22, color: colors.foreground },
  docSmall: { fontSize: 13, lineHeight: 18, color: colors.mutedForeground },
  docHeading: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    color: colors.foreground,
  },
  docLine: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bullet: { width: 14, textAlign: "center", color: colors.mutedForeground },
  box: {
    width: 18,
    height: 18,
    marginTop: 2,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.input,
    alignItems: "center",
    justifyContent: "center",
  },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: 10,
    color: colors.mutedForeground,
  },
  code: {
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
    backgroundColor: colors.muted,
    borderRadius: 8,
    padding: 8,
    color: colors.foreground,
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  fieldBlock: { gap: 6, paddingHorizontal: 14, paddingVertical: 10 },
  fieldLabel: { fontSize: 14, fontWeight: "500", color: colors.foreground },
  fieldValueWrap: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  fieldValue: {
    flexShrink: 1,
    textAlign: "right",
    fontSize: 13,
    fontWeight: "500",
    color: colors.mutedForeground,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  errorBox: {
    marginHorizontal: 14,
    marginBottom: 12,
    borderRadius: 10,
    backgroundColor: `${colors.destructive}14`,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  errorText: { color: colors.destructive, fontSize: 13, lineHeight: 18 },
  foot: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 12,
  },
  openLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 32,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 10 },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.border,
    gap: 1,
    overflow: "hidden",
  },
  stat: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  statValue: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "600",
    letterSpacing: -0.4,
    color: colors.foreground,
    fontVariant: ["tabular-nums"],
  },
}));
