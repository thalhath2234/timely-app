import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { CalendarDays, Database, Download, FileSpreadsheet, RefreshCw, Trash2, Upload } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { Card, Chip, PrimaryButton, SectionLabel } from "../../../components/ui/primitives";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { createBackup, deleteBackup, getBackupSettings, listBackups, restoreBackupJSON, shareExport, updateBackupSettings, type BackupSettings } from "../../../lib/api/portability";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export default function DataSettingsScreen() {
  const client = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["backup-settings"], queryFn: getBackupSettings });
  const backupsQ = useQuery({ queryKey: ["backups"], queryFn: listBackups });
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
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
    Alert.alert("Replace account data?", "This replaces all tasks, projects, calendar items, docs, sheets, and settings. Your login and devices remain unchanged.", [
      { text: "Cancel", style: "cancel" },
      { text: "Restore", style: "destructive", onPress: () => void run("restore", async () => {
        const contents = await new File(result.assets[0].uri).text();
        const restored = await restoreBackupJSON(contents);
        await client.invalidateQueries();
        const count = Object.values(restored.counts).reduce((sum, value) => sum + value, 0);
        setMessage(`Restore complete · ${count} records loaded.`);
      }) },
    ]);
  }

  return (
    <Screen>
      <MobileHeader title="Data & backups" back large={false} />
      <ScrollView contentContainerStyle={styles.content}>
        <SectionLabel>Portable exports</SectionLabel>
        <ExportRow Icon={Database} label="Full JSON backup" busy={busy === "json"} onPress={() => run("json", () => shareExport("/export/full", "timely-backup.json", "application/json"))} />
        <ExportRow Icon={FileSpreadsheet} label="Tasks CSV" busy={busy === "csv"} onPress={() => run("csv", () => shareExport("/export/tasks.csv", "timely-tasks.csv", "text/csv"))} />
        <ExportRow Icon={CalendarDays} label="Calendar ICS" busy={busy === "ics"} onPress={() => run("ics", () => shareExport("/export/calendar.ics", "timely-calendar.ics", "text/calendar"))} />

        <SectionLabel>Encrypted server backups</SectionLabel>
        <Card>
          <View style={styles.row}>
            <View style={styles.grow}><Text style={styles.title}>Scheduled backups</Text><Text style={styles.meta}>Encrypted at rest with automatic retention.</Text></View>
            <Switch accessibilityLabel="Scheduled backups" value={current.enabled} onValueChange={(enabled) => save.mutate({ ...current, enabled })} trackColor={{ true: colors.primary }} />
          </View>
          <Text style={styles.fieldLabel}>Frequency</Text>
          <View style={styles.chips}>{[1, 3, 7, 14, 30].map((days) => <Chip key={days} label={`${days}d`} active={current.intervalDays === days} onPress={() => save.mutate({ ...current, intervalDays: days })} />)}</View>
          <Text style={styles.fieldLabel}>Retention</Text>
          <View style={styles.chips}>{[3, 7, 14, 30].map((count) => <Chip key={count} label={`${count}`} active={current.retentionCount === count} onPress={() => save.mutate({ ...current, retentionCount: count })} />)}</View>
          {current.nextRunAt ? <Text style={styles.meta}>Next run {new Date(current.nextRunAt).toLocaleString()}</Text> : null}
          <View style={{ marginTop: 14 }}><PrimaryButton label={create.isPending ? "Creating…" : "Create backup now"} disabled={create.isPending} onPress={() => create.mutate()} /></View>
        </Card>

        {(backupsQ.data ?? []).map((backup) => (
          <View key={backup.id} style={styles.backup}>
            <View style={styles.grow}><Text style={styles.title}>{new Date(backup.createdAt).toLocaleString()}</Text><Text style={styles.meta}>{Math.max(1, Math.round(backup.byteSize / 1024))} KB</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Download backup" onPress={() => run(backup.id, () => shareExport(`/backups/${backup.id}`, "timely-backup.json", "application/json"))} style={styles.icon}><Download size={18} color={colors.foreground} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Delete backup" onPress={() => Alert.alert("Delete backup?", "This encrypted copy will be permanently removed.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => remove.mutate(backup.id) }])} style={styles.icon}><Trash2 size={18} color={colors.destructive} /></Pressable>
          </View>
        ))}

        <SectionLabel>Restore</SectionLabel>
        <Pressable accessibilityRole="button" onPress={() => void restore()} style={styles.restore}><Upload size={18} color={colors.foreground} /><View><Text style={styles.title}>Choose JSON backup</Text><Text style={styles.meta}>Replaces this account&apos;s current data.</Text></View></Pressable>
        {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
      </ScrollView>
    </Screen>
  );
}

function ExportRow({ Icon, label, onPress, busy }: { Icon: typeof Database; label: string; onPress: () => void; busy: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={onPress} style={styles.export}><Icon size={18} color={colors.primary} /><Text style={styles.title}>{busy ? "Preparing…" : label}</Text><RefreshCw size={15} color={colors.mutedForeground} /></Pressable>;
}

const styles = createThemedStyleSheet((colors) => ({
  content: { padding: 14, paddingBottom: 40, gap: 9 },
  export: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  grow: { flex: 1 },
  title: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 3 },
  fieldLabel: { color: colors.mutedForeground, fontSize: 12, marginTop: 14, marginBottom: 7 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  backup: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  icon: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  restore: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, backgroundColor: colors.card },
  success: { color: colors.success, fontSize: 13, textAlign: "center", marginTop: 8 },
}));
