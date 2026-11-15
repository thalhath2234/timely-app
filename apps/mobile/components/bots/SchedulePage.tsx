import { useState } from "react";
import { Text, View } from "react-native";
import type { BotSchedule } from "@timely/contract/bots";
import SegmentedControl from "../ui/SegmentedControl";
import { Chip } from "../ui/primitives";
import { TimeField } from "../ui/DateTimeField";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "../settings/SettingsList";
import { Check } from "lucide-react-native";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { EVERY_CHOICES, scheduleWords } from "./agentBot";
import { SavePage } from "./SavePage";

type Mode = "every" | "daily";

const DAYS: { id: number; label: string }[] = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
  { id: 0, label: "Sun" },
];

/**
 * When the Bot runs: every so often, or at a time on chosen days (the time
 * through Timely's own picker). A cron schedule set elsewhere is shown and
 * kept until a different one is picked here.
 */
export function SchedulePage({
  open,
  initial,
  timezone,
  onSave,
  onClose,
}: {
  open: boolean;
  initial: BotSchedule | undefined;
  timezone?: string;
  onSave: (schedule: BotSchedule) => Promise<void>;
  onClose: () => void;
}) {
  const start = (initial ?? {}) as Partial<{ everyMinutes: number; dailyAt: string; weekdays: number[]; cron: string }>;
  const [mode, setMode] = useState<Mode>(start.dailyAt ? "daily" : "every");
  const [minutes, setMinutes] = useState(start.everyMinutes ?? 60);
  const [at, setAt] = useState(start.dailyAt ?? "09:00");
  const [days, setDays] = useState<number[]>(start.weekdays?.length ? start.weekdays : [0, 1, 2, 3, 4, 5, 6]);
  const [touched, setTouched] = useState(false);
  const next: BotSchedule = mode === "every" ? { everyMinutes: minutes } : { dailyAt: at, weekdays: days };
  const toggle = (day: number) => {
    setTouched(true);
    setDays((now) => (now.includes(day) ? now.filter((d) => d !== day) : [...now, day]));
  };
  const valid = mode === "every" ? minutes > 0 : !!at && days.length > 0;
  return (
    <SavePage open={open} title="Schedule" subtitle={scheduleWords(next)} canSave={valid && (touched || !!start.cron)} onSave={() => onSave(next)} onClose={onClose}>
      <SegmentedControl
        accessibilityLabel="How often"
        value={mode}
        onChange={(value: Mode) => {
          setMode(value);
          setTouched(true);
        }}
        options={[
          { value: "every", label: "Every so often" },
          { value: "daily", label: "At a time" },
        ]}
      />
      {mode === "every" ? (
        <View style={styles.gap}>
          <ListGroup>
            {EVERY_CHOICES.map((choice) => (
              <ListRow
                key={choice.minutes}
                title={choice.label}
                chevron={false}
                trailing={minutes === choice.minutes ? <Check size={18} color={colors.primary} /> : undefined}
                onPress={() => {
                  setMinutes(choice.minutes);
                  setTouched(true);
                }}
              />
            ))}
          </ListGroup>
          <GroupHint>A Bot that reads pages is never run faster than its sources allow.</GroupHint>
        </View>
      ) : (
        <View style={styles.gap}>
          <ListGroup>
            <ListRow
              title="At"
              chevron={false}
              trailing={
                <TimeField
                  compact
                  label="Time of day"
                  value={at}
                  onChange={(value) => {
                    setAt(value);
                    setTouched(true);
                  }}
                />
              }
            />
          </ListGroup>
          <GroupLabel>On</GroupLabel>
          <View style={styles.days}>
            {DAYS.map((day) => (
              <Chip key={day.id} label={day.label} active={days.includes(day.id)} onPress={() => toggle(day.id)} />
            ))}
          </View>
          {days.length === 0 ? <Text style={styles.warn}>Pick at least one day.</Text> : null}
          {timezone ? <GroupHint>{`In ${timezone}`}</GroupHint> : null}
        </View>
      )}
      {start.cron ? <GroupHint>{`Now: ${scheduleWords(start as BotSchedule)}. Picking another schedule replaces it.`}</GroupHint> : null}
    </SavePage>
  );
}

const styles = createThemedStyleSheet(() => ({
  gap: { gap: 8 },
  days: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  warn: { color: colors.destructive, fontSize: 13 },
}));
