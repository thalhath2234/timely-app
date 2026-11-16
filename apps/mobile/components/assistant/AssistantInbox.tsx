import { useState } from "react";
import { Text, View } from "react-native";
import { Bot, ChevronDown, ChevronRight, MessageCircle } from "lucide-react-native";
import { ListGroup, ListRow } from "../settings/SettingsList";
import { CountPill } from "../bots/Pill";
import { BotMark } from "../bots/BotMark";
import { relativeTime, statusMeta } from "../chat/chatMeta";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { botRowLine, threadNeedsLine, type Inbox, type InboxItem } from "./inbox";
import type { ChatQuestion, HostRequest } from "@timely/contract/agentChat";

const tile = (node: React.ReactNode) => <View style={styles.tile}>{node}</View>;

function Row({
  item,
  now,
  onOpenChat,
  onOpenBot,
  onOpenDraft,
  draftsOpen,
  onToggleDrafts,
}: {
  item: InboxItem;
  now: number;
  onOpenChat: (id: string) => void;
  onOpenBot: (id: string) => void;
  onOpenDraft: (id: string) => void;
  draftsOpen: boolean;
  onToggleDrafts: () => void;
}) {
  const when = item.at ? relativeTime(new Date(item.at).toISOString(), now) : "";
  const dot = item.unread ? <View accessibilityLabel="Unread" style={styles.dot} /> : null;
  const trailing = (
    <View style={styles.trailing}>
      {when ? <Text style={styles.when}>{when}</Text> : null}
      {dot}
    </View>
  );
  if (item.type === "chat") {
    const meta = item.needs
      ? statusMeta(item.chat.status, item.chat.question as ChatQuestion | null | undefined, item.chat.hostRequest as HostRequest | null | undefined).label
      : undefined;
    return (
      <ListRow
        title={item.title || "New chat"}
        meta={meta}
        leading={tile(<MessageCircle size={18} color={colors.mutedForeground} />)}
        trailing={trailing}
        chevron={false}
        accessibilityLabel={`Open chat ${item.title}`}
        onPress={() => onOpenChat(item.id)}
      />
    );
  }
  if (item.type === "bot") {
    const waiting = item.thread ? threadNeedsLine(item.thread) : "";
    return (
      <ListRow
        title={item.title}
        meta={waiting && item.needs === "thread" ? waiting : botRowLine(item)}
        leading={<BotMark watches={item.bot.watches} kind={item.bot.kind} size={36} />}
        trailing={trailing}
        chevron={false}
        accessibilityLabel={`Open Bot ${item.title}`}
        onPress={() => onOpenBot(item.id)}
      />
    );
  }
  if (item.type === "drafts") {
    // The older drafts fold into this one row; it opens to list them in place.
    const Chevron = draftsOpen ? ChevronDown : ChevronRight;
    return (
      <ListRow
        title={item.title}
        meta="New Bots you didn’t finish"
        leading={tile(<Bot size={18} color={colors.mutedForeground} />)}
        trailing={<Chevron size={16} color={colors.mutedForeground} />}
        chevron={false}
        accessibilityLabel={`${item.title}, ${draftsOpen ? "hide" : "show"}`}
        onPress={onToggleDrafts}
      />
    );
  }
  return (
    <ListRow
      title={item.title}
      meta="New Bot, not created yet"
      leading={tile(<Bot size={18} color={colors.mutedForeground} />)}
      trailing={trailing}
      chevron={false}
      onPress={() => onOpenDraft(item.id)}
    />
  );
}

function Section({ label, count, attn, children }: { label: string; count: number; attn?: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        <CountPill count={count} tone={attn ? "attn" : undefined} />
      </View>
      <ListGroup>{children}</ListGroup>
    </View>
  );
}

/** Chats and Bots in one inbox: Needs you first, then the rest, newest first. */
export function AssistantInbox({
  inbox,
  now,
  onOpenChat,
  onOpenBot,
  onOpenDraft,
}: {
  inbox: Inbox;
  now: number;
  onOpenChat: (id: string) => void;
  onOpenBot: (id: string) => void;
  onOpenDraft: (id: string) => void;
}) {
  const [draftsOpen, setDraftsOpen] = useState(false);
  const row = (item: InboxItem) => (
    <Row
      key={`${item.type}-${item.id}`}
      item={item}
      now={now}
      onOpenChat={onOpenChat}
      onOpenBot={onOpenBot}
      onOpenDraft={onOpenDraft}
      draftsOpen={draftsOpen}
      onToggleDrafts={() => setDraftsOpen((open) => !open)}
    />
  );
  // An open summary row lists its drafts right under it, in the same group.
  const rows = (items: InboxItem[]) => items.flatMap((item) => [row(item), ...(item.type === "drafts" && draftsOpen ? item.drafts.map(row) : [])]);
  return (
    <>
      {inbox.needs.length ? (
        <Section label="Needs you" count={inbox.needs.length} attn>
          {rows(inbox.needs)}
        </Section>
      ) : null}
      {inbox.recent.length ? (
        <Section label={inbox.needs.length ? "Recent" : "All"} count={inbox.recent.length}>
          {rows(inbox.recent)}
        </Section>
      ) : null}
    </>
  );
}

const styles = createThemedStyleSheet(() => ({
  section: { gap: 8 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, marginBottom: 2, marginHorizontal: 4 },
  label: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  tile: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  trailing: { flexDirection: "row", alignItems: "center", gap: 6 },
  when: { color: colors.mutedForeground, fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
}));
