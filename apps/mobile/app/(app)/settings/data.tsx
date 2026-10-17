import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { CalendarDays, Database, Download, FileSpreadsheet, Share2, Trash2, Upload } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import SegmentedControl from "../../../components/ui/SegmentedControl";
import { GroupHint, GroupLabel, ListGroup, ListRow, SwitchRow } from "../../../components/settings/SettingsList";
import ConfirmSheet, { type ConfirmRequest } from "../../../components/ui/ConfirmSheet";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { createBackup, deleteBackup, getBackupSettings, listBackups, restoreBackupJSON, shareExport, updateBackupSettings, type BackupSettings } from "../../../lib/api/portability";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export default function DataSettingsScreen() {
  const client = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["backup-settings"], queryFn: getBackupSettings });
  const backupsQ = useQuery({ queryKey: ["backups"], queryFn: listBackups });
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const current: BackupSettings = settingsQ.data ?? { enabled: false, intervalDays: 1, retentionCount: 7 };
  const save = useMutation({ mutationFn: updateBackupSettings, onSuccess: (next) => client.setQueryData(["backup-settings"], next) });
  const create = useMutation({ mutationFn: createBackup, onSuccess: () => client.invalidateQueries({ queryKey: ["backups"] }) });
  const remove = useMutation({ mutationFn: deleteBackup, onSuccess: () => client.invalidateQueries({ queryKey: ["backups"] }) });

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setMessage("");
    try { await action(); setMessage("Export ready."); }
    catch (error) { Alert.alert("Could not continue", error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(""); }
  }

  async function restore() {
    const result = await DocumentPicker.getDocumentAsync({ type: "application/json", copyToCacheDirectory: true });
    if (result.canceled) return;
    setConfirm({
      title: "Replace account data?",
      message: "This replaces all tasks, projects, calendar items, docs, sheets, and settings. Your login and devices remain unchanged.",
      confirmLabel: "Restore",
      onConfirm: () => void run("restore", async () => {
        const contents = await new File(result.assets[0].uri).text();
        const restored = await restoreBackupJSON(contents);
        await client.invalidateQueries();
        const count = Object.values(restored.counts).reduce((sum, value) => sum + value, 0);
        setMessage(`Restore complete · ${count} records loaded.`);
      }),
    });
  }

  return (
    <Screen>
      <MobileHeader title="Data & backups" back large={false} />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <GroupLabel>Export</GroupLabel>
        <ListGroup>
          <ExportRow Icon={Database} label="Full JSON backup" busy={busy === "json"} onPress={() => run("json", () => shareExport("/export/full", "timely-backup.json", "application/json"))} />
          <ExportRow Icon={FileSpreadsheet} label="Tasks CSV" busy={busy === "csv"} onPress={() => run("csv", () => shareExport("/export/tasks.csv", "timely-tasks.csv", "text/csv"))} />
          <ExportRow Icon={CalendarDays} label="Calendar ICS" busy={busy === "ics"} onPress={() => run("ics", () => shareExport("/export/calendar.ics", "timely-calendar.ics", "text/calendar"))} />
        </ListGroup>
        <GroupHint>Each export opens the share sheet so you can save or send the file.</GroupHint>

        <GroupLabel>Encrypted server backups</GroupLabel>
        <ListGroup>
          <SwitchRow
            title="Scheduled backups"
            meta={current.enabled && current.nextRunAt ? `Next ${new Date(current.nextRunAt).toLocaleString()}` : "Encrypted at rest, old copies removed"}
            value={current.enabled}
            onChange={(enabled) => save.mutate({ ...current, enabled })}
          />
          <ListRow
            title="Every"
            trailing={
              <View>
                <SegmentedControl
                  size="sm"
                  accessibilityLabel="Backup frequency"
                  value={String(current.intervalDays)}
                  onChange={(days) => save.mutate({ ...current, intervalDays: Number(days) })}
                  options={[1, 3, 7, 14, 30].map((days) => ({ value: String(days), label: `${days}d` }))}
                />
              </View>
            }
          />
          <ListRow
            title="Keep"
            trailing={
              <View>
                <SegmentedControl
                  size="sm"
                  accessibilityLabel="Backups to keep"
                  value={String(current.retentionCount)}
                  onChange={(count) => save.mutate({ ...current, retentionCount: Number(count) })}
                  options={[3, 7, 14, 30].map((count) => ({ value: String(count), label: String(count) }))}
                />
              </View>
            }
          />
        </ListGroup>

        <GroupLabel>{`Saved backups${backupsQ.data?.length ? ` · ${backupsQ.data.length}` : ""}`}</GroupLabel>
        <ListGroup>
          <ListRow title={create.isPending ? "Backing up…" : "Back up now"} tone="add" disabled={create.isPending} onPress={() => create.mutate()} />
          {(backupsQ.data ?? []).map((backup) => (
            <View key={backup.id} style={styles.backup}>
              <View style={styles.grow}>
                <Text style={styles.title}>{new Date(backup.createdAt).toLocaleString()}</Text>
                <Text style={styles.meta}>{Math.max(1, Math.round(backup.byteSize / 1024))} KB</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Download backup" onPress={() => run(backup.id, () => shareExport(`/backups/${backup.id}`, "timely-backup.json", "application/json"))} style={styles.icon}><Download size={18} color={colors.foreground} /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Delete backup" onPress={() => setConfirm({ title: "Delete backup?", message: "This encrypted copy will be permanently removed.", onConfirm: () => remove.mutate(backup.id) })} style={styles.icon}><Trash2 size={18} color={colors.destructive} /></Pressable>
            </View>
          ))}
        </ListGroup>

        <GroupLabel>Restore</GroupLabel>
        <ListGroup>
          <ListRow
            title="Choose JSON backup"
            meta="Replaces this account's current data"
            leading={<Upload size={18} color={colors.foreground} />}
            onPress={() => void restore()}
          />
        </ListGroup>
        {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
      </ScrollView>
      <ConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ""}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        onConfirm={() => confirm?.onConfirm()}
      />
    </Screen>
  );
}

function ExportRow({ Icon, label, onPress, busy }: { Icon: typeof Database; label: string; onPress: () => void; busy: boolean }) {
  return (
    <ListRow
      title={busy ? "Preparing…" : label}
      accessibilityLabel={`Export ${label}`}
      leading={<Icon size={18} color={colors.primary} />}
      trailing={<Share2 size={16} color={colors.mutedForeground} />}
      chevron={false}
      disabled={busy}
      onPress={onPress}
    />
  );
}

const styles = createThemedStyleSheet((colors) => ({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  grow: { flex: 1 },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  backup: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 14, paddingRight: 4 },
  icon: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  success: { color: colors.success, fontSize: 13, textAlign: "center", marginTop: 8 },
}));
