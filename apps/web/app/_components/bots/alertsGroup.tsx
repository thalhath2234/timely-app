"use client";

import type { ReactNode } from "react";
import { Bell, Monitor, Smartphone } from "lucide-react";
import { BOT_LIMITS, type BotSettings } from "@timely/contract/bots";
import {
  GroupHint,
  GroupLabel,
  ListGroup,
  ListRow,
  ListSwitch,
} from "@/app/_components/_ui/groupedList";

function RowIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-fill text-muted-foreground [&_svg]:size-3.5"
    >
      {children}
    </span>
  );
}

const ROWS: {
  key: keyof BotSettings;
  label: string;
  meta?: string;
  icon: ReactNode;
}[] = [
  { key: "desktop", label: "Desktop", icon: <Monitor /> },
  { key: "phone", label: "Phone", icon: <Smartphone /> },
  {
    key: "urgent",
    label: "Urgent",
    meta: "Rings through quiet hours",
    icon: <Bell />,
  },
];

/**
 * Alerts: where the bot tells you (Desktop, Phone, and Urgent, which rings
 * through quiet hours). `alertsToday` shows the day's count beside the label
 * on a saved bot.
 */
export function AlertsGroup({
  value,
  onChange,
  alertsToday,
  error,
}: {
  value: BotSettings;
  onChange: (next: BotSettings) => void;
  alertsToday?: number;
  error?: ReactNode;
}) {
  const cap = BOT_LIMITS.alertsPerDay;
  return (
    <section>
      <GroupLabel
        aside={
          alertsToday == null ? undefined : `${alertsToday} of ${cap} today`
        }
      >
        Alerts
      </GroupLabel>
      <ListGroup>
        {ROWS.map((row) => (
          <ListRow
            key={row.key}
            label={row.label}
            meta={row.meta}
            icon={<RowIcon>{row.icon}</RowIcon>}
          >
            <ListSwitch
              label={row.label}
              checked={value[row.key]}
              onChange={(next) => onChange({ ...value, [row.key]: next })}
            />
          </ListRow>
        ))}
      </ListGroup>
      {error ? (
        <GroupHint className="text-destructive">{error}</GroupHint>
      ) : null}
      <GroupHint>
        Up to {cap} alerts a day. After that you get one “and 2 more today”.
      </GroupHint>
    </section>
  );
}
