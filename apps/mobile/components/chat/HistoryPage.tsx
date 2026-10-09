import { useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MessageCircle, Pencil, Search, Trash2, X } from "lucide-react-native";
import type { Chat } from "../../lib/chat/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import ConfirmSheet from "../ui/ConfirmSheet";
import EmptyState from "../ui/EmptyState";
import ListEnter from "../ui/ListEnter";
import { Field, PrimaryButton } from "../ui/primitives";
import TimelyLogo, { LogoSpinner } from "../ui/TimelyLogo";
import { groupChats, relativeTime, statusMeta, toneColor } from "./chatMeta";
import { Action } from "./shared";

export default function HistoryPage({
  chats,
  loading,
  refreshing,
  error,
  offline,
  activeId,
  onRefresh,
  onOpen,
  onRename,
  onDelete,
}: {
  chats: Chat[];
  loading: boolean;
  refreshing: boolean;
  error?: string;
  offline: boolean;
  activeId: string | null;
  onRefresh: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<Chat | null>(null);
  const [renaming, setRenaming] = useState<Chat | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<Chat | null>(null);
  const [saving, setSaving] = useState(false);
  const filtered = chats.filter((c) =>
    c.title.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const groups = groupChats(filtered);
  let index = 0;
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchWrap}>
        <View style={styles.search}>
          <Search size={16} color={colors.mutedForeground} />
          <Field
            bare
            placeholder="Search chats"
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <AnimatedPressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setSearch("")}
            >
              <X size={16} color={colors.mutedForeground} />
            </AnimatedPressable>
          ) : null}
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            enabled={!offline}
          />
        }
      >
        {error && !chats.length ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Couldn't load chat history</Text>
            <Text style={styles.meta}>{error}</Text>
            <Action label="Try again" compact onPress={onRefresh} />
          </View>
        ) : null}
        {loading && !chats.length ? (
          <TimelyLogo size={40} animated style={{ alignSelf: "center", marginTop: 32 }} />
        ) : null}
        {!loading && !error && !filtered.length ? (
          <EmptyState
            icon={MessageCircle}
            title={search ? "No matching chats" : "No conversations yet"}
            description={
              search
                ? "Try a different word from the chat title."
                : "Ask Timely anything about your work and it will show up here."
            }
          />
        ) : null}
        {groups.map((group) => (
          <View key={group.label} style={styles.group}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            {group.items.map((chat) => {
              const meta = statusMeta(chat.status);
              const Icon = meta.icon;
              const color = toneColor(meta.tone, colors);
              const active = chat.id === activeId;
              const attention = [
                "approval",
                "choose",
                "failed",
                "running",
                "queued",
              ].includes(chat.status);
              return (
                <ListEnter key={chat.id} index={index++}>
                  <AnimatedPressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${chat.title}`}
                    accessibilityHint="Long press for more options"
                    onPress={() => onOpen(chat.id)}
                    onLongPress={() => setMenu(chat)}
                    style={[styles.row, active && styles.rowActive]}
                  >
                    <View
                      style={[
                        styles.rowIcon,
                        { backgroundColor: `${color}1f` },
                      ]}
                    >
                      {meta.spin ? (
                        <LogoSpinner size={16} color={color} />
                      ) : (
                        <Icon size={16} color={color} />
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.title,
                          chat.unread && styles.unreadTitle,
                          active && { color: colors.primary },
                        ]}
                      >
                        {chat.title}
                      </Text>
                      <Text numberOfLines={1} style={styles.meta}>
                        {attention ? meta.label : relativeTime(chat.updatedAt)}
                      </Text>
                    </View>
                    {chat.unread ? <View style={styles.dot} /> : null}
                  </AnimatedPressable>
                </ListEnter>
              );
            })}
          </View>
        ))}
        {offline ? (
          <Text style={[styles.meta, { textAlign: "center", marginTop: 16 }]}>
            Offline · showing cached history
          </Text>
        ) : null}
      </ScrollView>
      <BottomSheet
        open={!!menu}
        onClose={() => setMenu(null)}
        title={menu?.title}
      >
        <SheetOption
          leading={<Pencil size={18} color={colors.foreground} />}
          onSelect={() => {
            if (!menu) return;
            setTitle(menu.title);
            setRenaming(menu);
            setMenu(null);
          }}
        >
          Rename
        </SheetOption>
        <SheetOption
          leading={<Trash2 size={18} color={colors.destructive} />}
          onSelect={() => {
            setDeleting(menu);
            setMenu(null);
          }}
        >
          <Text style={styles.deleteOption}>Delete conversation</Text>
        </SheetOption>
      </BottomSheet>
      <BottomSheet
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename chat"
        footer={
          <PrimaryButton
            label={saving ? "Saving…" : "Save"}
            disabled={saving || !title.trim() || offline}
            onPress={() => {
              if (!renaming) return;
              setSaving(true);
              void onRename(renaming.id, title.trim())
                .then(() => setRenaming(null))
                .finally(() => setSaving(false));
            }}
          />
        }
      >
        <View style={{ paddingBottom: 12 }}>
          <Field
            placeholder="Chat title"
            value={title}
            onChangeText={setTitle}
            autoCapitalize="sentences"
          />
        </View>
      </BottomSheet>
      <ConfirmSheet
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.title ?? ""}”?`}
        message="Its history, temporary images and notifications are removed. Changes already applied to your work stay."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleting) void onDelete(deleting.id);
        }}
      />
    </View>
  );
}

const styles = createThemedStyleSheet(() => ({
  searchWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  search: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: colors.muted,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  body: { paddingHorizontal: 12, paddingBottom: 40 },
  group: { marginTop: 14 },
  groupLabel: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 2,
  },
  rowActive: { backgroundColor: colors.accent },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  unreadTitle: { fontWeight: "800" },
  meta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  deleteOption: { color: colors.destructive, fontSize: 15, fontWeight: "600" },
  errorCard: {
    marginTop: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.destructive,
    backgroundColor: `${colors.destructive}10`,
    padding: 16,
    gap: 8,
  },
  errorTitle: { color: colors.foreground, fontSize: 15, fontWeight: "700" },
}));
