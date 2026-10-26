import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Check, Sparkles } from "lucide-react-native";
import { DESCRIBED_MAX_PROMPT, defaultQuery, fitQuery, type DashboardCard } from "@timely/contract/dashboard";
import { describeChanges, describeExamples, readBoardProgram } from "@timely/contract/genuiBoard";
import { todayInZone } from "@timely/contract/workStatus";
import BottomSheet from "../ui/BottomSheet";
import { Button, Field, PrimaryButton } from "../ui/primitives";
import { LogoSpinner } from "../ui/TimelyLogo";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "../settings/SettingsList";
import { readyProviders } from "../chat/ModelSheet";
import { describeCardWithAi } from "../../lib/api/dashboardCard";
import { useDashboardData, useNow } from "../../lib/dashboard";
import { useAgentProvidersQuery } from "../../lib/hooks";
import { colors, controlRadius, createThemedStyleSheet } from "../../lib/theme";
import DescribedCardView from "./describedCard";
import { LiveBlockFrame } from "./liveBlockFrame";

export interface DescribedDraft {
  title: string;
  /** Everything the person asked, one request per line. */
  prompt: string;
  program: string;
}

/**
 * Describe a card on the phone: the twin of the web's describe dialog. The
 * person says what the card should show, the account's AI provider writes
 * the card's program once, and the preview draws it from the dashboard's own
 * data. A built card takes further words as changes. There is no size row:
 * the card takes the size its program names. In a doc the same sheet builds
 * a live block, previewed as the doc draws it, with no name to pick.
 */
export default function DescribeCardSheet({
  open,
  initial,
  place = "dashboard",
  onClose,
  onSave,
}: {
  open: boolean;
  /** A described card being changed; absent starts a new one. */
  initial?: DescribedDraft;
  /** "doc" builds a live block for a doc instead of a dashboard card. */
  place?: "dashboard" | "doc";
  onClose: () => void;
  onSave: (draft: DescribedDraft) => void;
}) {
  const router = useRouter();
  const doc = place === "doc";
  const noun = doc ? "block" : "card";
  const [words, setWords] = useState("");
  const [program, setProgram] = useState("");
  const [asked, setAsked] = useState<string[]>([]);
  const built = useMemo(() => (program ? readBoardProgram(program) : null), [program]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The phone client cannot abort a request; closing the sheet drops its answer.
  const attempt = useRef(0);

  // Each opening starts from the card being changed, or from nothing.
  useEffect(() => {
    if (!open) return;
    attempt.current += 1;
    setWords("");
    setProgram(initial?.program ?? "");
    setAsked(initial?.prompt ? initial.prompt.split("\n").filter(Boolean) : []);
    // A name the person typed stays; otherwise the card takes the program's title.
    setTitle(initial && initial.title !== readBoardProgram(initial.program)?.title ? initial.title : "");
    setBusy(false);
    setError("");
  }, [open, initial]);

  // The preview reads what the program needs, even a source no other card on the board uses.
  const previewCards = useMemo<DashboardCard[]>(
    () =>
      program
        ? [
            {
              id: "describe",
              type: "custom",
              w: 4,
              h: 3,
              query: { ...fitQuery(defaultQuery("tasks")), described: { prompt: "", program } },
            },
          ]
        : [],
    [program],
  );
  const { data, timeZone } = useDashboardData(previewCards);
  const now = useNow(60_000);
  const providers = useAgentProvidersQuery();
  const aiReady = !providers.data || readyProviders(providers.data).length > 0;

  const build = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    const mine = ++attempt.current;
    setBusy(true);
    setError("");
    try {
      const answer = await describeCardWithAi({ prompt, today: todayInZone(timeZone), current: program || undefined, place });
      if (mine !== attempt.current) return;
      if (!readBoardProgram(answer.program, data)) throw new Error(`The AI's answer was not a ${noun}. Try again.`);
      setProgram(answer.program);
      setAsked((list) => [...list, prompt]);
      setWords("");
    } catch (failure) {
      if (mine === attempt.current)
        setError(failure instanceof Error ? failure.message : `Could not build the ${noun}. Try again.`);
    } finally {
      if (mine === attempt.current) setBusy(false);
    }
  };

  const name = title.trim() || built?.title || "";
  const tries = program ? describeChanges(program) : describeExamples(data.sheets);

  const save = () => onSave({ title: name, prompt: asked.join("\n").slice(-DESCRIBED_MAX_PROMPT), program });

  const needsProvider = (
    <View style={styles.body}>
      <ListGroup>
        <ListRow
          leading={<Sparkles size={18} color={colors.mutedForeground} />}
          title={doc ? "Live blocks need an AI provider" : "Describing cards needs an AI provider"}
          meta={`Add a key in Settings → Agent, then describe your ${noun} here.`}
          onPress={() => router.push("/(app)/settings/agent")}
        />
      </ListGroup>
    </View>
  );

  const form = (
    <View style={styles.body}>
      {program ? (
        <View style={styles.section}>
          {doc ? (
            // The block as the doc draws it.
            <View accessibilityLabel={`Preview of ${name}`}>
              <LiveBlockFrame title={name || "Live block"}>
                <DescribedCardView program={program} data={data} timeZone={timeZone} now={now} onLink={() => undefined} />
              </LiveBlockFrame>
            </View>
          ) : (
            <View style={styles.preview} accessibilityLabel={`Preview of ${name}`}>
              <View style={styles.previewHead}>
                <Sparkles size={15} color={colors.mutedForeground} />
                <Text style={styles.previewTitle} numberOfLines={1}>
                  {name}
                </Text>
              </View>
              <DescribedCardView program={program} data={data} timeZone={timeZone} now={now} onLink={() => undefined} />
            </View>
          )}
          <GroupHint>{`Reads your data each time the ${doc ? "doc opens" : "dashboard shows"}. The AI isn't asked again.`}</GroupHint>
        </View>
      ) : null}

      {program && !doc ? (
        <View style={styles.section}>
          <ListGroup>
            <ListRow
              title="Name"
              trailing={
                <View style={styles.inline}>
                  <Field
                    bare
                    align="right"
                    value={title}
                    onChangeText={(next) => setTitle(next.slice(0, 120))}
                    placeholder={built?.title}
                    autoCapitalize="sentences"
                    accessibilityLabel="Name"
                  />
                </View>
              }
            />
          </ListGroup>
        </View>
      ) : null}

      <View style={styles.section}>
        <Field
          label={program ? "Change it" : "Your words"}
          value={words}
          onChangeText={(next) => setWords(next.slice(0, DESCRIBED_MAX_PROMPT))}
          multiline
          autoCapitalize="sentences"
          placeholder={program ? "Show more rows, add a chart by day…" : "Overdue client work and what's due this week"}
        />
        {busy ? (
          <View style={styles.busy} accessibilityLiveRegion="polite">
            <LogoSpinner size={18} />
            <Text style={styles.busyText}>{`Building your ${noun}…`}</Text>
          </View>
        ) : (
          <Button
            label={program ? `Change ${noun}` : `Build ${noun}`}
            variant={program ? "secondary" : "primary"}
            size="lg"
            stretch
            disabled={!words.trim()}
            onPress={() => void build(words)}
          />
        )}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>

      {asked.length ? (
        <View style={styles.section}>
          <GroupLabel>What you asked</GroupLabel>
          <ListGroup>
            {asked.map((entry, index) => (
              <ListRow key={index} leading={<Check size={16} color={colors.success} />} title={entry} />
            ))}
          </ListGroup>
        </View>
      ) : null}

      <View style={styles.section}>
        <GroupLabel>{program ? "Try a change" : "Or start from one"}</GroupLabel>
        <ListGroup>
          {tries.map((entry) => (
            <ListRow
              key={entry}
              leading={<Sparkles size={16} color={colors.primary} />}
              title={entry.charAt(0).toUpperCase() + entry.slice(1)}
              disabled={busy}
              onPress={() => void build(entry)}
            />
          ))}
        </ListGroup>
      </View>
    </View>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={doc ? (initial ? "Change live block" : "Add a live block") : initial ? "Change card" : "Describe a card"}
      footer={
        program && aiReady ? (
          <PrimaryButton
            label={initial ? "Save changes" : doc ? "Insert block" : "Add to dashboard"}
            disabled={busy}
            testID="describe-save"
            onPress={save}
          />
        ) : undefined
      }
    >
      {open ? (aiReady ? form : needsProvider) : null}
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { gap: 16, paddingBottom: 8 },
  section: { gap: 8 },
  preview: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
    gap: 12,
    overflow: "hidden",
  },
  previewHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  previewTitle: { flex: 1, color: colors.foreground, fontSize: 14, fontWeight: "600" },
  inline: { width: 190 },
  busy: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: controlRadius + 2,
    backgroundColor: colors.muted,
  },
  busyText: { flex: 1, color: colors.mutedForeground, fontSize: 15 },
  error: { color: colors.destructive, fontSize: 14 },
}));
