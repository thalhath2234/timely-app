"use client";

import { useMemo } from "react";
import { Bell, SlidersHorizontal } from "lucide-react";
import { ListSwitch } from "@/app/_components/_ui/groupedList";
import { RailRow, RailRows, RailSection, RailStat } from "@/app/_components/_ui/pageWithRail";
import { useNotificationSettings, useUpdateNotificationSettings } from "@/app/utils/hooks/notifications";
import { useDecisions } from "@/app/utils/hooks/decisions";
import { useToastStore } from "@/app/_store/toastStore";
import type { AppNotification, NotificationSettings } from "@/app/_types/types";

const CATEGORY_LABEL: Record<string, string> = {
  reminder: "Reminders",
  digest: "Digests",
  suggestion: "Smart alerts",
  overdue: "Overdue",
  missed: "Missed blocks",
};

function categoryLabel(category: string) {
  return CATEGORY_LABEL[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

/** "08:00" as the user's clock shows it. */
function clock(value: string) {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return value;
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** The Notifications page rail: what is waiting, and the delivery switches
 * from Settings so the common changes need no trip there. */
export default function NotificationsRail({ items }: { items: AppNotification[] }) {
  const settings = useNotificationSettings();
  const update = useUpdateNotificationSettings();
  const smart = useDecisions().data?.available === true;

  const counts = useMemo(() => {
    const unread = items.filter((item) => !item.readAt).length;
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const today = items.filter((item) => new Date(item.createdAt).getTime() >= dayStart.getTime()).length;
    const byCategory = new Map<string, number>();
    for (const item of items) byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + 1);
    return { unread, today, byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]) };
  }, [items]);

  const current = settings.data;
  const set = (patch: Partial<NotificationSettings>) => {
    if (!current) return;
    const next = { ...current, ...patch };
    void update
      .mutateAsync({ ...next, planning: next.digestMorning })
      .catch((error) => useToastStore.getState().show(error instanceof Error ? error.message : "Could not save"));
  };
  const quiet =
    current?.quietHoursStart && current?.quietHoursEnd ? `${clock(current.quietHoursStart)} – ${clock(current.quietHoursEnd)}` : "Off";

  return (
    <>
      <RailSection title="Waiting" icon={<Bell className="size-3.5 text-primary" />} data-testid="notifications-waiting">
        <div className="mb-3 grid grid-cols-2 gap-3">
          <RailStat value={counts.unread} label="unread" tone={counts.unread > 0 ? "primary" : "default"} />
          <RailStat value={counts.today} label="today" />
        </div>
        {counts.byCategory.length > 0 ? (
          <RailRows>
            {counts.byCategory.map(([category, count]) => (
              <RailRow key={category} label={categoryLabel(category)} value={count} tone="muted" />
            ))}
          </RailRows>
        ) : null}
      </RailSection>

      <RailSection
        title="Delivery"
        icon={<SlidersHorizontal className="size-3.5 text-muted-foreground" />}
        meta={update.isPending ? "Saving…" : undefined}
        data-testid="notifications-delivery"
      >
        {current ? (
          <RailRows>
            <RailRow
              label="Reminder pings"
              value={<ListSwitch label="Reminder pings" checked={current.reminders} onChange={(reminders) => set({ reminders })} />}
            />
            <RailRow
              label="Morning digest"
              meta={`at ${clock(current.morningDigestAt)}`}
              value={<ListSwitch label="Morning digest" checked={current.digestMorning} onChange={(digestMorning) => set({ digestMorning })} />}
            />
            <RailRow
              label="End-of-day recap"
              meta={`at ${clock(current.eveningDigestAt)}`}
              value={<ListSwitch label="End-of-day recap" checked={current.digestEvening} onChange={(digestEvening) => set({ digestEvening })} />}
            />
            {smart ? (
              <RailRow
                label="Smart alerts"
                meta="Up to three a day"
                value={<ListSwitch label="Smart alerts" checked={current.smartAlerts !== false} onChange={(smartAlerts) => set({ smartAlerts })} />}
              />
            ) : null}
            <RailRow label="Quiet hours" value={quiet} tone="muted" href="/settings?tab=notifications" />
            <RailRow label="All notification settings" href="/settings?tab=notifications" tone="muted" value="›" />
          </RailRows>
        ) : (
          <p className="text-xs text-muted-foreground">{settings.isError ? "Settings could not be loaded." : "Loading…"}</p>
        )}
      </RailSection>
    </>
  );
}
