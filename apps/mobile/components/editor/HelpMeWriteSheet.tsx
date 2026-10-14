import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { RotateCcw } from "lucide-react-native";
import {
  SELECTION_ACTIONS,
  WRITE_BUSY,
  writeStarters,
  type WriteAction,
  type WriteKind,
  type WriteResult,
} from "@timely/contract/helpMeWrite";
import { fromMarkdown } from "@timely/contract/markdown";
import { helpMeWrite } from "../../lib/api/write";
import { useAgentProvidersQuery } from "../../lib/hooks";
import { colors, controlRadius, createThemedStyleSheet } from "../../lib/theme";
import BottomSheet from "../ui/BottomSheet";
import { Button, Chip, Field } from "../ui/primitives";
import { LogoSpinner } from "../ui/TimelyLogo";
import RichDoc from "../docs/RichDoc";
import { readyProviders } from "../chat/ModelSheet";

/** What the editor holds, so the draft fits it. */
export type WriteContext = { kind: WriteKind; title?: string };

/** The editor's selection and text when Help me write opened. */
export type WriteInfo = { from: number; to: number; selection: string; text: string };

/** How the draft goes in: over the selection, after it or at the caret, or at
 * the end of the text ("Continue writing"). */
export type WriteInsert = { markdown: string; mode: "replace" | "below" | "insert" | "end" };

type Run = { action: WriteAction; prompt?: string; selection?: string; label?: string };

/** Help me write needs a generative AI provider (Settings > Agent keys);
 * TypeSafe alone only answers typed questions, so it does not count. */
export function useHelpMeWriteAvailable(enabled: boolean) {
  const { data } = useAgentProvidersQuery();
  return enabled && readyProviders(data).length > 0;
}

export default function HelpMeWriteSheet({
  info,
  context,
  onClose,
  onInsert,
}: {
  /** Open while set. */
  info: WriteInfo | null;
  context: WriteContext;
  onClose: () => void;
  onInsert: (insert: WriteInsert) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [refine, setRefine] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<(WriteResult & { run: Run }) | null>(null);
  // The phone client cannot abort a request; Stop and Close drop its answer.
  const attempt = useRef(0);

  useEffect(() => {
    // A new opening starts clean.
    attempt.current += 1;
    setPrompt("");
    setRefine("");
    setBusy(null);
    setError("");
    setResult(null);
  }, [info]);

  const hasSelection = Boolean(info?.selection);
  const choices = hasSelection ? SELECTION_ACTIONS : writeStarters(context.kind, Boolean(info?.text));

  const start = async (run: Run) => {
    if (!info) return;
    const id = ++attempt.current;
    setBusy(run.label ?? WRITE_BUSY[run.action]);
    setError("");
    try {
      const out = await helpMeWrite({
        action: run.action,
        prompt: run.prompt,
        selection: run.selection ?? (info.selection || undefined),
        kind: context.kind,
        title: context.title,
        text: info.text,
      });
      if (id !== attempt.current) return;
      setResult({ ...out, run });
      setRefine("");
    } catch (err) {
      if (id !== attempt.current) return;
      setError(err instanceof Error ? err.message : "Could not write that. Try again.");
    } finally {
      if (id === attempt.current) setBusy(null);
    }
  };

  const insert = (mode: "replace" | "below") => {
    if (!result) return;
    onInsert({
      markdown: result.text,
      mode: hasSelection ? mode : result.run.action === "continue" ? "end" : "insert",
    });
  };

  const footer = result && !busy ? (
    <View style={styles.footer}>
      <Button label="Try again" variant="ghost" size="sm" icon={<RotateCcw size={16} color={colors.mutedForeground} />} onPress={() => void start(result.run)} />
      <Button label="Discard" variant="destructive-ghost" size="sm" onPress={() => setResult(null)} />
      <View style={{ flex: 1 }} />
      {hasSelection ? <Button label="Below" accessibilityLabel="Insert below" variant="outline" size="sm" onPress={() => insert("below")} /> : null}
      <Button label={hasSelection ? "Replace" : "Insert"} size="sm" onPress={() => insert("replace")} />
    </View>
  ) : undefined;

  return (
    <BottomSheet open={info !== null} onClose={onClose} title="Help me write" footer={footer}>
      <Text style={styles.where}>
        {hasSelection ? "Rewrite the selected text" : context.kind === "doc" ? "Draft into this doc" : "Draft the description"}
      </Text>

      {hasSelection && !result ? (
        <Text numberOfLines={3} style={styles.quote}>
          {info?.selection}
        </Text>
      ) : null}

      {busy ? (
        <View style={styles.busy} accessibilityLiveRegion="polite">
          <LogoSpinner size={18} />
          <Text style={styles.busyText}>{busy}…</Text>
          <Button
            label="Stop"
            variant="ghost"
            size="sm"
            onPress={() => {
              attempt.current += 1;
              setBusy(null);
            }}
          />
        </View>
      ) : result ? (
        <View style={styles.gap}>
          <ScrollView
            style={styles.preview}
            contentContainerStyle={styles.previewContent}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            <RichDoc content={fromMarkdown(result.text, { breaks: true }).content} />
          </ScrollView>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field value={refine} onChangeText={setRefine} placeholder="Ask for changes" autoCapitalize="sentences" />
            </View>
            <Button
              label="Update"
              variant="secondary"
              disabled={!refine.trim()}
              onPress={() => void start({ action: "write", prompt: refine.trim(), selection: result.text, label: "Updating the draft" })}
            />
          </View>
        </View>
      ) : (
        <View style={styles.gap}>
          <View style={styles.chips}>
            {choices.map((choice) => (
              <Chip key={choice.label} label={choice.label} onPress={() => void start({ action: choice.action, prompt: choice.prompt })} />
            ))}
          </View>
          <Field
            label={hasSelection ? "Or say how to change it" : "Or say what to write"}
            value={prompt}
            onChangeText={setPrompt}
            multiline
            autoCapitalize="sentences"
            placeholder={
              hasSelection
                ? "Make it friendlier, translate to Spanish…"
                : context.kind === "doc"
                  ? "A packing list for two days in Lisbon…"
                  : "What done looks like, and who to ask…"
            }
          />
          <Button label="Write" size="lg" stretch disabled={!prompt.trim()} onPress={() => void start({ action: "write", prompt: prompt.trim() })} />
        </View>
      )}

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  where: { color: colors.mutedForeground, fontSize: 14, marginBottom: 14 },
  quote: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 19,
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
    paddingLeft: 10,
    marginBottom: 12,
  },
  gap: { gap: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  busy: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 18,
    borderRadius: controlRadius + 2,
    backgroundColor: colors.muted,
  },
  busyText: { flex: 1, color: colors.mutedForeground, fontSize: 15 },
  preview: {
    maxHeight: 280,
    borderRadius: controlRadius + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  // Padding goes on the content, not the ScrollView: on Android a ScrollView's
  // own padding is not part of what scrolls, so it clipped the draft's last line.
  previewContent: { paddingHorizontal: 14, paddingVertical: 10 },
  footer: { flexDirection: "row", alignItems: "center", gap: 4 },
  error: {
    marginTop: 12,
    color: colors.destructiveForeground,
    fontSize: 13,
    backgroundColor: colors.destructiveContainer,
    borderRadius: controlRadius,
    padding: 10,
    overflow: "hidden",
  },
}));
