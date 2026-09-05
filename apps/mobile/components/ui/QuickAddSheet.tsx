import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { CalendarClock, Check, FileText, ListTodo, Sheet as SheetIcon } from "lucide-react-native";
import BottomSheet from "./BottomSheet";
import DateTimeSheet from "./DateTimeSheet";
import { Chip, Field, PrimaryButton } from "./primitives";
import { useCreateDoc, useCreateEvent, useCreateSheet, useCreateTask, useWorkspacesQuery } from "../../lib/hooks";
import { sheetHref } from "../../lib/sheet";
import { addDays, formatShortDate, formatTime, startOfDay } from "../../lib/format";
import { colors } from "../../lib/theme";

type Kind = "task" | "event" | "doc" | "sheet";
const KINDS: { value: Kind; label: string; Icon: typeof ListTodo }[] = [
  { value: "task", label: "Task", Icon: ListTodo },
  { value: "event", label: "Event", Icon: CalendarClock },
  { value: "doc", label: "Doc", Icon: FileText },
  { value: "sheet", label: "Sheet", Icon: SheetIcon },
];
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

function nextSlot() {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d;
}

export default function QuickAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const workspaces = useWorkspacesQuery();
  const createTask = useCreateTask();
  const createEvent = useCreateEvent();
  const createDoc = useCreateDoc();
  const createSheet = useCreateSheet();

  const [kind, setKind] = useState<Kind>("task");
  const [title, setTitle] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number] | null>(null);
  const [eventStart, setEventStart] = useState(nextSlot);
  const [eventEnd, setEventEnd] = useState(() => new Date(nextSlot().getTime() + 3_600_000));
  const [allDay, setAllDay] = useState(false);
  const [picking, setPicking] = useState<"due" | "start" | "end" | null>(null);

  const list = workspaces.data ?? [];
  const activeWorkspaceId = workspaceId || list[0]?.id || "";
  const pending = createTask.isPending || createEvent.isPending || createDoc.isPending || createSheet.isPending;

  function reset() {
    setTitle("");
    setDeadline(null);
    setPriority(null);
    setKind("task");
    const start = nextSlot();
    setEventStart(start);
    setEventEnd(new Date(start.getTime() + 3_600_000));
    setAllDay(false);
  }

  async function submit() {
    const name = title.trim();
    if (!name || pending) return;
    if (kind === "task") {
      await createTask.mutateAsync({
        name,
        workspaceId: activeWorkspaceId,
        deadline: deadline?.toISOString(),
        priorityLevel: priority ?? undefined,
      });
      finish("/(app)/(tabs)/tasks");
      return;
    }
    if (kind === "event") {
      const start = allDay ? startOfDay(eventStart) : eventStart;
      const end = allDay ? addDays(startOfDay(eventStart), 1) : eventEnd;
      await createEvent.mutateAsync({
        title: name,
        start: start.toISOString(),
        end: end.toISOString(),
        allDay,
        workspaceId: activeWorkspaceId,
      });
      finish("/(app)/(tabs)/calendar");
      return;
    }
    if (kind === "doc") {
      const doc = await createDoc.mutateAsync({ title: name, workspaceId: activeWorkspaceId });
      reset();
      onClose();
      router.push(`/(app)/docs/${doc.id}`);
      return;
    }
    const sheet = await createSheet.mutateAsync({ title: name, workspaceId: activeWorkspaceId });
    reset();
    onClose();
    router.push(sheetHref(sheet.id));
  }

  function finish(href: string) {
    reset();
    onClose();
    router.push(href as never);
  }

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title="New">
        <View style={styles.kinds}>
          {KINDS.map((k) => {
            const on = k.value === kind;
            return (
              <Pressable key={k.value} onPress={() => setKind(k.value)} style={[styles.kind, on && styles.kindOn]}>
                <k.Icon size={20} color={on ? colors.accentForeground : colors.mutedForeground} />
                <Text style={[styles.kindText, on && { color: colors.accentForeground }]}>{k.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Field
          value={title}
          onChangeText={setTitle}
          autoCapitalize="sentences"
          placeholder={kind === "task" ? "What needs doing?" : kind === "event" ? "Event title" : `Untitled ${kind}`}
        />
        {list.length > 1 ? (
          <View style={styles.row}>
            {list.map((w) => (
              <Chip key={w.id} label={w.name} active={w.id === activeWorkspaceId} onPress={() => setWorkspaceId(w.id)} />
            ))}
          </View>
        ) : null}
        {kind === "event" ? (
          <View style={{ gap: 8 }}>
            <Pressable onPress={() => setPicking("start")} style={styles.meta}>
              <Text style={styles.metaLabel}>Starts</Text>
              <Text style={styles.metaValue}>
                {allDay ? formatShortDate(eventStart.toISOString()) : `${formatShortDate(eventStart.toISOString())} ${formatTime(eventStart.toISOString())}`}
              </Text>
            </Pressable>
            <Pressable onPress={() => setPicking("end")} style={styles.meta}>
              <Text style={styles.metaLabel}>Ends</Text>
              <Text style={styles.metaValue}>
                {allDay ? formatShortDate(eventEnd.toISOString()) : `${formatShortDate(eventEnd.toISOString())} ${formatTime(eventEnd.toISOString())}`}
              </Text>
            </Pressable>
            <Chip label={allDay ? "All day on" : "All day off"} active={allDay} onPress={() => setAllDay((v) => !v)} />
          </View>
        ) : null}
        {kind === "task" ? (
          <View style={{ gap: 8 }}>
            <Pressable onPress={() => setPicking("due")} style={styles.meta}>
              <Text style={styles.metaLabel}>Due</Text>
              <Text style={styles.metaValue}>{deadline ? formatShortDate(deadline.toISOString()) : "No date"}</Text>
            </Pressable>
            <View style={styles.row}>
              {PRIORITIES.map((p) => (
                <Chip key={p} label={p} active={priority === p} onPress={() => setPriority(priority === p ? null : p)} />
              ))}
            </View>
          </View>
        ) : null}
        <View style={{ height: 8 }} />
        <PrimaryButton
          label={pending ? "Saving…" : `Add ${kind}`}
          disabled={!title.trim() || pending || (kind !== "event" && !activeWorkspaceId && kind === "task")}
          onPress={() => void submit()}
        />
        <View style={styles.hintRow}>
          <Check size={14} color={colors.mutedForeground} />
          <Text style={styles.hint}>Creates it in your workspace immediately</Text>
        </View>
      </BottomSheet>
      <DateTimeSheet
        open={picking !== null}
        value={picking === "due" ? deadline : picking === "end" ? eventEnd : eventStart}
        mode={allDay && picking !== "due" ? "date" : "datetime"}
        onClose={() => setPicking(null)}
        onChange={(next) => {
          if (picking === "due") setDeadline(next);
          if (picking === "start" && next) {
            const duration = Math.max(eventEnd.getTime() - eventStart.getTime(), 15 * 60_000);
            setEventStart(next);
            setEventEnd(new Date(next.getTime() + duration));
          }
          if (picking === "end" && next) setEventEnd(next);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  kinds: { flexDirection: "row", gap: 8, marginBottom: 12 },
  kind: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 12,
  },
  kindOn: { borderColor: colors.primary, backgroundColor: colors.accent },
  kindText: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  meta: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.input,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metaLabel: { color: colors.mutedForeground, fontSize: 13 },
  metaValue: { color: colors.foreground, fontSize: 14 },
  hintRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 10 },
  hint: { color: colors.mutedForeground, fontSize: 12 },
});
