import { useState } from "react";
import { Pause } from "lucide-react-native";
import { todayRows, type BotView, type BotsSummary, type TodayRow } from "@timely/contract/bots";
import ConfirmSheet from "../ui/ConfirmSheet";
import { Button } from "../ui/primitives";
import { ListGroup, ListRow, SwitchRow } from "../settings/SettingsList";
import { useSetAllPaused, useSetLink } from "../../lib/hooks";
import { useToastStore } from "../../lib/toast";
import { colors } from "../../lib/theme";

const say = (message: string) => useToastStore.getState().show(message);
const failed = (error: Error) => say(error.message);

/**
 * The board's Today group, as on the web: the Pause all bots switch (turning
 * it on asks first), today's AI checks and passed items, and a row for each
 * switched-off pass with Turn on.
 */
export function TodayGroup({ summary, bots }: { summary: BotsSummary; bots: BotView[] }) {
  const pauseAll = useSetAllPaused();
  const setLink = useSetLink();
  const [asking, setAsking] = useState(false);
  const rows = todayRows(summary, bots);
  // The switch shows where it is going while the board catches up.
  const pausedNow = pauseAll.isPending && pauseAll.variables !== undefined ? pauseAll.variables : !!summary.allPaused;

  const setPaused = (on: boolean) =>
    pauseAll.mutate(on, {
      onSuccess: () => say(on ? "All bots are paused" : "Bots are on again"),
      onError: failed,
    });

  const row = (r: TodayRow) => {
    if (r.kind === "switch")
      return (
        <SwitchRow
          key={r.id}
          title={r.label}
          value={pausedNow}
          onChange={(next) => {
            if (pauseAll.isPending) return;
            if (next) setAsking(true);
            else setPaused(false);
          }}
        />
      );
    if (r.kind === "link") {
      // "A → B" in one line cuts B off on a phone: A is the title, B the line under it.
      const link = summary.links?.find((l) => l.id === r.id);
      const from = link && bots.find((b) => b.id === link.fromBotId)?.name;
      const to = link && bots.find((b) => b.id === link.toBotId)?.name;
      return (
        <ListRow
          key={r.id}
          title={from ?? r.label}
          meta={to ? `Passes to ${to} · ${r.value}` : r.value}
          action={
            <Button
              label={r.action}
              variant="outline"
              size="sm"
              accessibilityLabel={`${r.action} ${r.label}`}
              loading={setLink.isPending && setLink.variables?.linkId === r.id}
              onPress={() => setLink.mutate({ linkId: r.id, enabled: true }, { onError: failed })}
            />
          }
        />
      );
    }
    return <ListRow key={r.id} title={r.label} trailing={r.value} />;
  };

  return (
    <>
      <ListGroup>{rows.map(row)}</ListGroup>
      <ConfirmSheet
        open={asking}
        onClose={() => setAsking(false)}
        title="Pause all bots?"
        message="Nothing is checked, passed on or sent until you turn them on again."
        confirmLabel="Pause all"
        tone="primary"
        icon={<Pause size={16} color={colors.primaryForeground} />}
        onConfirm={() => setPaused(true)}
      />
    </>
  );
}
