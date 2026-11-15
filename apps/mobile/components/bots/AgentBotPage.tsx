import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Pause, Play, RefreshCw, Trash2 } from "lucide-react-native";
import { agoLabel, clockLabel, type BotDetail, type BotPermission, type BotSchedule } from "@timely/contract/bots";
import AnimatedPressable from "../ui/AnimatedPressable";
import BottomSheet from "../ui/BottomSheet";
import ConfirmSheet from "../ui/ConfirmSheet";
import { SkeletonRows } from "../ui/motionKit";
import { Button, Field } from "../ui/primitives";
import { GroupHint, GroupLabel, ListGroup, ListRow, SwitchRow } from "../settings/SettingsList";
import {
  deleteBotNote,
  listBotFindings,
  listBotNotes,
  updateAgentBot,
  type AgentBotPatch,
  type AgentBotView,
} from "../../lib/api/bots";
import { useBotQuery, useDeleteBot, usePauseBot, useResumeBot, useRunBot } from "../../lib/hooks";
import { useNow } from "../../lib/dashboard";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { heldWords } from "../assistant/inbox";
import { BotMark } from "./BotMark";
import { PermissionPage } from "./PermissionPage";
import { PromptPage } from "./PromptPage";
import { SavePage } from "./SavePage";
import { SchedulePage } from "./SchedulePage";
import { SkillsPage } from "./SkillsPage";
import { ToolsPage } from "./ToolsPage";
import { checkLine, gateWords, permissionWords, promptPreview, scheduleWords, skillsSummary, toolsSummary } from "./agentBot";

const say = (message: string) => useToastStore.getState().show(message);

type Page = "prompt" | "schedule" | "tools" | "skills" | "permission" | "name" | "delete" | null;

/**
 * An agent Bot's page: its prompt, schedule, reach (tools, skills, permission,
 * memory) as grouped rows that open one page each, then what it did lately
 * (checks, alerts, findings, notes). The Bot thread is where it is changed by
 * talking; these rows are for direct edits. A Bot on the agent engine
 * opens this instead of the rules editor.
 */
export function AgentBotPage({
  botId,
  onClose,
  onTalk,
}: {
  botId: string;
  onClose: () => void;
  /** Opens this Bot's thread. */
  onTalk: () => void;
}) {
  const now = useNow(30_000);
  const client = useQueryClient();
  const query = useBotQuery(botId);
  const detail = query.data as (BotDetail & AgentBotView) | undefined;
  const [page, setPage] = useState<Page>(null);
  const run = useRunBot();
  const pause = usePauseBot();
  const resume = useResumeBot();
  const remove = useDeleteBot();
  const notes = useQuery({ queryKey: ["bot-notes", botId], queryFn: () => listBotNotes(botId), staleTime: 15_000 });
  const findings = useQuery({ queryKey: ["bot-findings", botId], queryFn: () => listBotFindings(botId, 8), staleTime: 15_000 });
  const forget = useMutation({
    mutationFn: (key: string) => deleteBotNote(botId, key),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["bot-notes", botId] }),
    onError: (error: Error) => say(error.message),
  });

  const save = async (patch: AgentBotPatch) => {
    await updateAgentBot(botId, patch);
    await client.invalidateQueries({ queryKey: ["bots"] });
    setPage(null);
  };
  const flip = (patch: AgentBotPatch) =>
    void updateAgentBot(botId, patch)
      .then(() => client.invalidateQueries({ queryKey: ["bots"] }))
      .catch((error: Error) => say(error.message));

  if (!detail) {
    return (
      <BottomSheet open onClose={onClose} title="Bot">
        <View style={styles.body}>
          {query.error ? <Text style={styles.muted}>Couldn’t load this Bot. Close it and try again.</Text> : <SkeletonRows rows={3} height={72} />}
        </View>
      </BottomSheet>
    );
  }

  const paused = detail.status === "paused";
  const checks = (detail.checks ?? []).slice(0, 5);
  const alerts = (detail.alerts ?? []).filter((a) => a.kind === "alert").slice(0, 4);
  const reads = detail.watches ?? [];
  const noteRows = notes.data ?? [];
  const found = findings.data ?? [];

  const footer = (
    <View style={styles.footer}>
      <View style={styles.footWide}>
        <Button label="Talk to it" icon={<MessageCircle size={16} color={colors.primaryForeground} />} stretch dense onPress={onTalk} />
      </View>
      <View style={styles.footCell}>
        <Button
          label="Check now"
          variant="outline"
          stretch
          dense
          disabled={paused}
          loading={run.isPending || detail.checking}
          icon={<RefreshCw size={16} color={colors.foreground} />}
          onPress={() => run.mutate(botId, { onSuccess: (r) => say(r.line), onError: (e) => say(e.message) })}
        />
      </View>
      <View style={styles.footCell}>
        {paused ? (
          <Button label="Resume" variant="outline" stretch dense loading={resume.isPending} icon={<Play size={16} color={colors.foreground} />} onPress={() => resume.mutate(botId, { onError: (e) => say(e.message) })} />
        ) : (
          <Button label="Pause" variant="outline" stretch dense loading={pause.isPending} icon={<Pause size={16} color={colors.foreground} />} onPress={() => pause.mutate(botId, { onError: (e) => say(e.message) })} />
        )}
      </View>
    </View>
  );

  return (
    <BottomSheet
      open
      onClose={onClose}
      leading={
        <AnimatedPressable accessibilityRole="button" accessibilityLabel={`${detail.name}. Rename`} onPress={() => setPage("name")} style={styles.lead}>
          <BotMark watches={detail.watches} kind={detail.kind} size={28} />
          <Text numberOfLines={2} style={styles.name}>
            {detail.name}
          </Text>
        </AnimatedPressable>
      }
      footer={footer}
    >
      <View style={styles.body}>
        <View style={styles.chips}>
          <Chip tone={paused ? "off" : "ok"}>{paused ? "Paused" : detail.health.line || "Working"}</Chip>
          {detail.lastCheckAt ? <Chip>{`Checked ${agoLabel(detail.lastCheckAt, now)}`}</Chip> : null}
          {!paused && detail.nextCheckAt ? <Chip>{`Next ${clockLabel(detail.nextCheckAt, now)}`}</Chip> : null}
        </View>

        <View style={styles.section}>
          <GroupLabel>How it works</GroupLabel>
          <ListGroup>
            <ListRow title="Prompt" meta={promptPreview(detail.prompt)} onPress={() => setPage("prompt")} />
            <ListRow title="Schedule" trailing={scheduleWords(detail.schedule)} onPress={() => setPage("schedule")} />
            {reads.length > 0 ? (
              <SwitchRow
                title="Only when something changed"
                meta="It reads its sites first and runs only if one changed."
                value={detail.gate === "changed"}
                onChange={(on) => flip({ gate: on ? "changed" : "always" })}
              />
            ) : (
              <ListRow title="Runs" trailing={gateWords(detail.gate)} chevron={false} />
            )}
            <SwitchRow
              title="Market hours only"
              value={!!detail.marketHours}
              onChange={(marketHours) => flip({ marketHours })}
            />
          </ListGroup>
          {reads.length > 0 ? <GroupHint>{`Reads: ${reads.map((w) => w.title || w.site || w.url).filter(Boolean).slice(0, 3).join(", ")}`}</GroupHint> : null}
        </View>

        <View style={styles.section}>
          <GroupLabel>What it can use</GroupLabel>
          <ListGroup>
            <ListRow title="Tools" meta={toolsSummary(detail.tools)} onPress={() => setPage("tools")} />
            <ListRow title="Skills" trailing={skillsSummary(detail.skills)} onPress={() => setPage("skills")} />
            <ListRow title="Permission" trailing={permissionWords(detail.permission)} onPress={() => setPage("permission")} />
            <SwitchRow
              title="Memory and About you"
              meta="Off keeps each run clean. It never searches your past chats."
              value={!!detail.tools?.useMemory}
              onChange={(useMemory) => flip({ tools: { useMemory } })}
            />
          </ListGroup>
        </View>

        <View style={styles.section}>
          <GroupLabel aside={checks.length ? `${detail.week?.checks ?? checks.length} this week` : undefined}>Recent checks</GroupLabel>
          {checks.length ? (
            <ListGroup>
              {checks.map((check) => (
                <ListRow key={check.id} title={checkLine(check)} meta={agoLabel(check.startedAt, now)} chevron={false} />
              ))}
            </ListGroup>
          ) : (
            <Text style={styles.muted}>No checks yet.</Text>
          )}
        </View>

        <View style={styles.section}>
          <GroupLabel aside={detail.alertsMonth ? `${detail.alertsMonth} in 30 days` : undefined}>Alerts</GroupLabel>
          {alerts.length ? (
            <ListGroup>
              {alerts.map((alert) => (
                <ListRow
                  key={alert.id}
                  title={alert.title}
                  meta={[heldWords(alert.held), agoLabel(alert.createdAt, now)].filter(Boolean).join(" · ")}
                  chevron={false}
                  onPress={onTalk}
                />
              ))}
            </ListGroup>
          ) : (
            <Text style={styles.muted}>No alerts yet. They land in its thread.</Text>
          )}
        </View>

        {found.length > 0 ? (
          <View style={styles.section}>
            <GroupLabel>Findings</GroupLabel>
            <ListGroup>
              {found.slice(0, 5).map((f) => (
                <ListRow key={f.id} title={f.title} meta={f.why || undefined} chevron={false} />
              ))}
            </ListGroup>
          </View>
        ) : null}

        {noteRows.length > 0 ? (
          <View style={styles.section}>
            <GroupLabel>Notes it keeps</GroupLabel>
            <ListGroup>
              {noteRows.map((note) => (
                <ListRow
                  key={note.key}
                  title={note.key}
                  meta={note.value}
                  chevron={false}
                  trailing={
                    <AnimatedPressable accessibilityRole="button" accessibilityLabel={`Forget ${note.key}`} hitSlop={8} onPress={() => forget.mutate(note.key)}>
                      <Trash2 size={18} color={colors.mutedForeground} />
                    </AnimatedPressable>
                  }
                />
              ))}
            </ListGroup>
          </View>
        ) : null}

        <ListGroup>
          <ListRow title="Delete bot" tone="danger" leading={<Trash2 size={18} color={colors.destructive} />} onPress={() => setPage("delete")} />
        </ListGroup>
      </View>

      {page === "prompt" ? <PromptPage open initial={detail.prompt ?? ""} onSave={(prompt) => save({ prompt })} onClose={() => setPage(null)} /> : null}
      {page === "schedule" ? (
        <SchedulePage
          open
          initial={detail.schedule as BotSchedule | undefined}
          timezone={detail.timezone}
          onSave={(schedule) => save({ schedule })}
          onClose={() => setPage(null)}
        />
      ) : null}
      {page === "tools" ? <ToolsPage open initial={detail.tools} onSave={(tools) => save({ tools })} onClose={() => setPage(null)} /> : null}
      {page === "skills" ? <SkillsPage open initial={detail.skills ?? []} onSave={(skills) => save({ skills })} onClose={() => setPage(null)} /> : null}
      {page === "permission" ? (
        <PermissionPage
          open
          initial={(detail.permission ?? "auto") as BotPermission}
          onSave={(permission) => save({ permission })}
          onClose={() => setPage(null)}
        />
      ) : null}
      {page === "name" ? <NamePage initial={detail.name} onSave={(name) => save({ name })} onClose={() => setPage(null)} /> : null}
      <ConfirmSheet
        open={page === "delete"}
        onClose={() => setPage(null)}
        title={`Delete ${detail.name}?`}
        message="Its log, alerts, notes and thread go too."
        confirmLabel="Delete"
        onConfirm={() =>
          remove.mutate(botId, {
            onSuccess: () => {
              say(`${detail.name} is deleted`);
              onClose();
            },
            onError: (error) => say(error.message),
          })
        }
      />
    </BottomSheet>
  );
}

function NamePage({ initial, onSave, onClose }: { initial: string; onSave: (name: string) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  const clean = value.replace(/\s+/g, " ").trim();
  return (
    <SavePage open title="Name" canSave={!!clean && clean !== initial.trim()} onSave={() => onSave(clean)} onClose={onClose}>
      <Field label="Name" value={value} onChangeText={(next) => setValue(next.replace(/[\r\n]+/g, " "))} autoCapitalize="sentences" maxLength={80} />
    </SavePage>
  );
}

function Chip({ children, tone }: { children: string; tone?: "ok" | "off" }) {
  return (
    <View style={[styles.chip, tone === "ok" && styles.chipOk]}>
      <Text numberOfLines={1} style={[styles.chipText, tone === "ok" && { color: colors.successText }]}>
        {children}
      </Text>
    </View>
  );
}

const styles = createThemedStyleSheet(() => ({
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 16 },
  section: { gap: 8 },
  muted: { color: colors.mutedForeground, fontSize: 14 },
  lead: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },
  name: { flexShrink: 1, color: colors.foreground, fontSize: 18, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: colors.muted },
  chipOk: { backgroundColor: colors.accent },
  chipText: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500" },
  footer: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  footWide: { flexBasis: "100%" },
  footCell: { flex: 1 },
}));
