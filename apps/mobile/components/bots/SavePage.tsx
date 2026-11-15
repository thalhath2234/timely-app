import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import BottomSheet from "../ui/BottomSheet";
import { PrimaryButton } from "../ui/primitives";
import { colors, createThemedStyleSheet } from "../../lib/theme";

/**
 * One editor page of the Bot sheet: a body, and Save in the sheet's footer
 * (which docks on top of the keyboard). A refused save keeps the page open
 * with the server's words.
 */
export function SavePage({
  open,
  title,
  subtitle,
  canSave,
  onSave,
  onClose,
  children,
  saveLabel = "Save",
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  canSave: boolean;
  onSave: () => Promise<void>;
  onClose: () => void;
  children: ReactNode;
  saveLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setRefused(null);
    try {
      await onSave();
    } catch (error) {
      setRefused(error instanceof Error ? error.message : "That didn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={
        <View style={styles.footer}>
          {refused ? <Text style={styles.error}>{refused}</Text> : null}
          <PrimaryButton label={saveLabel} disabled={!canSave} loading={busy} onPress={() => void save()} />
        </View>
      }
    >
      <View style={styles.body}>{children}</View>
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet(() => ({
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  footer: { gap: 8 },
  error: { color: colors.destructive, fontSize: 13 },
}));
