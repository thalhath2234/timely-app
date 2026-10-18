import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Button } from "../ui/primitives";
import { useCaptureInbox } from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import type { Task } from "../../lib/types";

/**
 * The one way to capture a thought into the Inbox: the box docked at the
 * bottom of the Inbox screen and the Inbox form in the + sheet.
 */
export default function InboxCapture({
  onCaptured,
  autoFocus,
  keepFocus,
  initialTitle = "",
  compact,
}: {
  onCaptured?: (task: Task | undefined) => void;
  autoFocus?: boolean;
  /** Clear and stay in the box for the next thought (the Inbox screen). */
  keepFocus?: boolean;
  initialTitle?: string;
  /** One line, input beside the button (the Inbox screen's docked box). */
  compact?: boolean;
}) {
  const capture = useCaptureInbox();
  const [title, setTitle] = useState(initialTitle);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!autoFocus) return;
    // Wait for the sheet to finish sliding in, or the keyboard opens under it.
    const timer = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, [autoFocus]);

  const onCapture = () => {
    const name = title.trim();
    if (!name || capture.isPending) return;
    void capture.mutateAsync(name).then((task) => {
      setTitle("");
      if (keepFocus) inputRef.current?.focus();
      onCaptured?.(task);
    });
  };

  if (compact) {
    return (
      <View style={styles.box}>
        <View style={styles.compactRow}>
          <TextInput
            ref={inputRef}
            value={title}
            onChangeText={setTitle}
            placeholder="Something to follow up…"
            placeholderTextColor={colors.mutedForeground}
            selectionColor={colors.primary}
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={onCapture}
            submitBehavior="submit"
            accessibilityLabel="Capture to inbox"
            style={styles.compactInput}
          />
          <Button label="Capture" size="lg" loading={capture.isPending} disabled={!title.trim()} onPress={onCapture} />
        </View>
        {capture.isError ? (
          <Text style={[styles.hint, styles.error]} numberOfLines={2}>
            {capture.error instanceof Error ? capture.error.message : "Could not capture."}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={styles.label}>What&apos;s on your mind?</Text>
      <TextInput
        ref={inputRef}
        value={title}
        onChangeText={setTitle}
        placeholder="Capture a thought…"
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        autoCapitalize="sentences"
        returnKeyType="done"
        onSubmitEditing={onCapture}
        submitBehavior="submit"
        accessibilityLabel="Capture to inbox"
        style={styles.input}
      />
      <View style={styles.row}>
        <Text style={[styles.hint, capture.isError && styles.error]} numberOfLines={2}>
          {capture.isError
            ? capture.error instanceof Error
              ? capture.error.message
              : "Could not capture."
            : "Nothing is scheduled until you decide."}
        </Text>
        <Button label="Capture" size="lg" loading={capture.isPending} disabled={!title.trim()} onPress={onCapture} />
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  box: { gap: 8 },
  label: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500" },
  input: { color: colors.foreground, fontSize: 18, fontWeight: "500", paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  compactRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  compactInput: {
    flex: 1,
    minWidth: 0,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: 16,
  },
  hint: { flex: 1, color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  error: { color: colors.destructive },
}));
