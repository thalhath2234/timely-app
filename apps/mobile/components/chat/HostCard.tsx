import { useEffect, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import {
  Ban,
  Check,
  Clock,
  CodeXml,
  FilePenLine,
  FingerprintPattern,
  Globe,
  Hourglass,
  Lock,
  Plug,
  ServerCog,
  SquareTerminal,
  TimerOff,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react-native";
import {
  HOST_UNDO,
  hostSecondsLeft,
  type ClosedHost,
  type HostApprovalRule,
  type HostCardKind,
  type HostCardState,
  type HostChoice,
  type HostRequest,
} from "@timely/contract/agentChat";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import {
  choiceAccess,
  closedHostView,
  hostCardView,
} from "../../lib/chat/host";
import { Button } from "../ui/primitives";
import { timeOfDay } from "./chatMeta";

/**
 * The host card on the phone (phase 5, Q-5.1), the same states and words as
 * the web card: the assistant wants to run a command, change a file, use the
 * browser or an MCP tool on the computer, and its run waits. The call shows
 * as plain text in a block, never as a link: it is the model's own call and
 * it may have read an outside page. Run once and Allow for this chat unlock
 * the phone first (`lib/deviceUnlock.ts`); Deny never asks. The three
 * buttons stack at full width so each is a 44 point target.
 */

const KIND_ICON: Record<HostCardKind, LucideIcon> = {
  terminal: SquareTerminal,
  file: FilePenLine,
  code: CodeXml,
  browser: Globe,
  mcp: Plug,
  mcp_server: ServerCog,
};

function useNow(request: HostRequest) {
  const [now, setNow] = useState(() => Date.now());
  const left = hostSecondsLeft(request, now);
  useEffect(() => {
    if (left === null || left <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), left <= 60 ? 1000 : 15000);
    return () => clearTimeout(id);
  }, [left, now]);
  return now;
}

/** The call itself, as selectable plain text. */
function Subject({
  label,
  text,
  cwd,
}: {
  label: string;
  text: string;
  cwd?: string;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.eyebrow}>{label}</Text>
      <View style={styles.codeBox}>
        <Text testID="host-subject" selectable style={styles.code}>
          {text}
        </Text>
      </View>
      {cwd ? (
        <Text style={styles.meta}>
          In{" "}
          <Text testID="host-cwd" selectable style={styles.mono}>
            {cwd}
          </Text>
        </Text>
      ) : null}
    </View>
  );
}

export default function HostCard({
  request,
  rule,
  sending,
  error,
  note,
  onAnswer,
}: {
  request: HostRequest;
  rule?: HostApprovalRule;
  /** An answer (or the unlock before it) is on its way. */
  sending: HostChoice | null;
  error?: string;
  /** What the last unlock said when it sent nothing. */
  note?: string;
  /** Missing while offline: the card shows with its buttons off. */
  onAnswer?: (choice: HostChoice) => void;
}) {
  const now = useNow(request);
  const view = hostCardView(request, now);
  const Icon = KIND_ICON[view.kind];
  const busy = sending !== null;
  const access = choiceAccess(view.choices, "phone", rule);
  const blocked = access.find((a) => !a.enabled)?.why ?? "";
  const unlocks = access.some((a) => a.enabled && a.needsUnlock);
  const live = view.state === "live";
  const buttons: Record<
    HostChoice,
    { variant: "primary" | "outline" | "ghost"; icon?: ReactNode }
  > = {
    once: {
      variant: "primary",
      icon: <FingerprintPattern size={16} color={colors.primaryForeground} />,
    },
    chat: { variant: "outline" },
    deny: { variant: "ghost" },
  };
  return (
    <View
      testID="host-card"
      style={[styles.card, live ? styles.cardLive : null]}
    >
      <View style={styles.head}>
        <View style={[styles.tile, !live && { backgroundColor: colors.muted }]}>
          <Icon
            size={16}
            color={live ? colors.warningText : colors.mutedForeground}
          />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" style={styles.title}>
            {view.title}
          </Text>
          <Text style={styles.meta}>{view.lead}</Text>
        </View>
      </View>
      <View style={styles.pills}>
        <View
          testID="host-state"
          style={[styles.pill, live ? styles.pillLive : null]}
        >
          {!live ? (
            <Hourglass size={11} color={colors.mutedForeground} />
          ) : null}
          <Text
            style={[styles.pillText, live && { color: colors.warningText }]}
          >
            {view.stateWord}
          </Text>
        </View>
        {view.timeLeft || view.timeUp ? (
          <View
            testID="host-time-left"
            style={[styles.pill, view.soon ? styles.pillLive : null]}
          >
            <Clock
              size={11}
              color={view.soon ? colors.warningText : colors.mutedForeground}
            />
            <Text
              style={[
                styles.pillText,
                view.soon && { color: colors.warningText },
              ]}
            >
              {view.timeUp
                ? view.state === "parked"
                  ? "Time is up"
                  : "Pausing"
                : view.timeLeft}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.block}>
        <Subject label={view.subjectLabel} text={view.subject} cwd={view.cwd} />
        {view.envNames.length ? (
          <Text style={styles.meta}>
            Starts with these variables:{" "}
            <Text style={styles.mono}>{view.envNames.join(", ")}</Text>
          </Text>
        ) : null}
        {view.reason ? (
          <Text testID="host-reason" style={styles.meta}>
            {view.reason}
          </Text>
        ) : null}
        {view.critical ? (
          <View testID="host-critical" style={styles.critical}>
            <Lock
              size={12}
              color={colors.warningText}
              style={{ marginTop: 2 }}
            />
            <Text style={styles.criticalText}>{view.critical}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.actions}>
        {view.choices.map((choice) => {
          const a = access.find((x) => x.choice === choice)!;
          const b = buttons[choice];
          return (
            <Button
              key={choice}
              testID={`host-${choice}`}
              label={a.label}
              variant={b.variant}
              icon={a.needsUnlock && choice === "once" ? b.icon : undefined}
              stretch
              disabled={busy || !a.enabled || !onAnswer}
              loading={sending === choice}
              onPress={() => onAnswer?.(choice)}
            />
          );
        })}
      </View>
      <Text
        accessibilityLiveRegion="polite"
        style={[
          styles.meta,
          !(busy || note || blocked || view.grant || unlocks) && {
            display: "none",
          },
        ]}
      >
        {busy
          ? sending === "deny"
            ? "Telling the assistant no…"
            : "Waiting for your phone to unlock…"
          : note ||
            blocked ||
            [
              view.grant,
              unlocks
                ? "Run once and Allow for this chat ask for your fingerprint, face or screen lock."
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const closedIcons: Record<HostCardState, LucideIcon> = {
  live: SquareTerminal,
  parked: Hourglass,
  ran: Check,
  allowed: Check,
  denied: X,
  expired: TimerOff,
  stopped: Ban,
};

/** A host card whose wait ended, or a host call that ran on its own and left something to undo. */
export function ClosedHostCard({
  host,
  at,
  pending,
  undoError,
  onUndo,
}: {
  host: ClosedHost;
  at: string;
  pending?: boolean;
  undoError?: string;
  /** Missing while offline or while a run is going: the card shows without Undo. */
  onUndo?: (checkpoint: string) => void;
}) {
  const view = closedHostView(host);
  const Icon = closedIcons[view.state];
  const tone = view.ran
    ? colors.successText
    : view.state === "expired"
      ? colors.warningText
      : colors.mutedForeground;
  return (
    <View
      testID={`host-closed-${view.state}`}
      style={[styles.card, !view.ran && styles.cardMuted]}
    >
      <View style={styles.head}>
        <View style={[styles.closedIcon, { backgroundColor: `${tone}26` }]}>
          <Icon size={12} strokeWidth={2.5} color={tone} />
        </View>
        <Text accessibilityRole="header" style={[styles.title, { flex: 1 }]}>
          {view.auto ? view.line : view.stateWord}
        </Text>
        <Text style={styles.meta}>{timeOfDay(at)}</Text>
      </View>
      <View style={styles.summary}>
        {!view.auto && view.subject ? (
          <>
            <Text style={styles.meta}>{view.title}</Text>
            <View style={styles.codeBox}>
              <Text
                testID="host-subject"
                selectable
                style={[
                  styles.code,
                  !view.ran && { color: colors.mutedForeground },
                ]}
              >
                {view.subject}
              </Text>
            </View>
          </>
        ) : null}
        {view.deviceNote ? (
          <Text style={styles.meta}>{view.deviceNote}</Text>
        ) : null}
        {view.note ? <Text style={styles.meta}>{view.note}</Text> : null}
        {view.canUndo && onUndo ? (
          <View style={{ alignItems: "flex-start" }}>
            <Button
              testID="host-undo"
              label={HOST_UNDO}
              variant="outline"
              size="sm"
              icon={<Undo2 size={14} color={colors.foreground} />}
              disabled={pending}
              onPress={() => onUndo(host.checkpoint ?? "")}
            />
          </View>
        ) : view.undone ? (
          <View style={[styles.pill, { alignSelf: "flex-start" }]}>
            <Undo2 size={11} color={colors.mutedForeground} />
            <Text style={styles.pillText}>Undone</Text>
          </View>
        ) : null}
        {undoError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {undoError}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  cardLive: { borderColor: `${colors.warning}80` },
  cardMuted: { backgroundColor: colors.background },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  tile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: `${colors.warning}26`,
    alignItems: "center",
    justifyContent: "center",
  },
  closedIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
  },
  meta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  eyebrow: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    backgroundColor: colors.muted,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillLive: { backgroundColor: `${colors.warning}26` },
  pillText: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  block: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  codeBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  code: {
    color: colors.foreground,
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
  },
  mono: { color: colors.foreground, fontFamily: "monospace" },
  critical: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  criticalText: {
    flex: 1,
    color: colors.warningText,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  actions: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  error: { color: colors.destructive, fontSize: 12, lineHeight: 16 },
  summary: { paddingLeft: 30, gap: 6 },
}));
