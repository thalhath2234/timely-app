import { Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BotSchedule, BotView } from "@timely/contract/bots";
import { Button } from "../ui/primitives";
import { convertBot, getConversion } from "../../lib/api/bots";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { gateWords, promptPreview, scheduleWords } from "../bots/agentBot";

const say = (message: string) => useToastStore.getState().show(message);

/**
 * Switches a rules Bot to an agent, one Bot at a time: the card shows what the
 * agent would run (its prompt, schedule and gate) and nothing is stored until
 * Switch. There is no way to approve them all at once.
 */
export function ConvertCard({ bot, onDismiss }: { bot: Pick<BotView, "id" | "name">; onDismiss: () => void }) {
  const client = useQueryClient();
  const preview = useQuery({
    queryKey: ["bot-conversion", bot.id],
    queryFn: () => getConversion(bot.id),
    staleTime: 60_000,
    retry: false,
  });
  const approve = useMutation({
    mutationFn: () => convertBot(bot.id),
    onSuccess: () => {
      say(`${bot.name} is an agent now`);
      void client.invalidateQueries({ queryKey: ["bots"] });
    },
    onError: (error: Error) => say(error.message),
  });
  // A Bot that cannot be converted (the server refuses) is not offered.
  if (preview.isPending || !preview.data) return null;
  const p = preview.data;
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Switch to an agent</Text>
      <Text style={styles.title}>{bot.name}</Text>
      <Text style={styles.body}>{promptPreview(p.prompt, 220)}</Text>
      <Text style={styles.meta}>{`${scheduleWords(p.schedule as BotSchedule)} · ${gateWords(p.gate)}`}</Text>
      <View style={styles.actions}>
        <Button label="Switch" size="sm" loading={approve.isPending} onPress={() => approve.mutate()} />
        <Button label="Not now" variant="outline" size="sm" disabled={approve.isPending} onPress={onDismiss} />
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet(() => ({
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 6 },
  eyebrow: { color: colors.mutedForeground, fontSize: 11, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase" },
  title: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  body: { color: colors.foreground, fontSize: 14, lineHeight: 20 },
  meta: { color: colors.mutedForeground, fontSize: 13 },
  actions: { flexDirection: "row", gap: 8, marginTop: 6 },
}));
