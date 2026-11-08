import { useState } from "react";
import { View } from "react-native";
import { AlarmClockOff, Calendar, CalendarClock, Sun } from "lucide-react-native";
import { maxSnoozeUntil, snoozeLabel, snoozePresets, type BotView, untilLabel } from "@timely/contract/bots";
import BottomSheet from "../ui/BottomSheet";
import DateTimeSheet from "../ui/DateTimeSheet";
import { GroupHint, ListGroup, ListRow } from "../settings/SettingsList";
import { useSnoozeBot } from "../../lib/hooks";
import type { SnoozeBody } from "../../lib/api/bots";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { IconTile } from "./rows";

const say = (message: string) => useToastStore.getState().show(message);

/** Tomorrow at 09:00, where "Until a time" starts. */
function tomorrowMorning(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Snooze, a page of the bot sheet (as option 1 draws it): For a day, For a
 * week, Until a time (Timely's own date and time picker, as a further page),
 * and Stop snoozing while snoozed. Checks keep running; alerts wait.
 */
export function SnoozeSheet({ bot, open, onClose, now }: { bot: BotView; open: boolean; onClose: () => void; now: Date }) {
  const snooze = useSnoozeBot();
  const [picking, setPicking] = useState(false);
  const [day, week] = snoozePresets(now);
  const snoozed = snoozeLabel(bot, now);

  const send = (body: SnoozeBody) =>
    snooze.mutate(
      { id: bot.id, body },
      {
        onSuccess: (view) => {
          const label = snoozeLabel(view, new Date());
          say(label ? `${bot.name}: ${label.charAt(0).toLowerCase()}${label.slice(1)}` : `${bot.name} is no longer snoozed`);
          setPicking(false);
          onClose();
        },
        onError: (error) => say(error.message),
      },
    );

  return (
    <BottomSheet open={open} onClose={onClose} title="Snooze" subtitle={bot.name}>
      <View style={styles.body}>
        <ListGroup>
          <ListRow
            title="For a day"
            meta={upper(day.label)}
            leading={
              <IconTile>
                <Sun size={16} color={colors.mutedForeground} />
              </IconTile>
            }
            chevron={false}
            disabled={snooze.isPending}
            onPress={() => send({ for: "day" })}
          />
          <ListRow
            title="For a week"
            meta={`Until ${week.long}`}
            leading={
              <IconTile>
                <Calendar size={16} color={colors.mutedForeground} />
              </IconTile>
            }
            chevron={false}
            disabled={snooze.isPending}
            onPress={() => send({ for: "week" })}
          />
          <ListRow
            title="Until a time"
            meta="Pick a day and time"
            leading={
              <IconTile>
                <CalendarClock size={16} color={colors.mutedForeground} />
              </IconTile>
            }
            disabled={snooze.isPending}
            onPress={() => setPicking(true)}
          />
          {snoozed ? (
            <ListRow
              title="Stop snoozing"
              meta={snoozed}
              leading={
                <IconTile>
                  <AlarmClockOff size={16} color={colors.mutedForeground} />
                </IconTile>
              }
              chevron={false}
              disabled={snooze.isPending}
              onPress={() => send({ until: null })}
            />
          ) : null}
        </ListGroup>
        <GroupHint>Checks keep running. Alerts are kept on the bot, not sent, until the snooze ends.</GroupHint>
      </View>
      <DateTimeSheet
        open={picking}
        mode="datetime"
        title="Until a time"
        subtitle="Snooze"
        clearable={false}
        value={bot.snoozedUntil && Date.parse(bot.snoozedUntil) > now.getTime() ? new Date(bot.snoozedUntil) : tomorrowMorning(now)}
        min={now}
        max={maxSnoozeUntil(now)}
        confirmLabel={(picked) => `Snooze until ${untilLabel(picked.toISOString(), new Date())}`}
        onClose={() => setPicking(false)}
        onChange={(picked) => {
          if (picked) send({ until: picked.toISOString() });
        }}
      />
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet(() => ({
  body: { gap: 8, paddingTop: 4 },
}));
