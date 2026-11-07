"use client";

import { Bell, Monitor, Smartphone } from "lucide-react";
import { DEFAULT_BOT_SETTINGS, type BotSettings } from "@timely/contract/bots";
import { ListRow, ListSwitch } from "@/app/_components/_ui/groupedList";
import { useToastStore } from "@/app/_store/toastStore";
import { useBotDefaults, useSetBotDefaults } from "@/app/utils/hooks/bots";

/**
 * "Alerts for new bots": where a bot made from now on tells the person. Used
 * by the empty Bots page and Settings › Notifications.
 */
export function useAlertDefaults() {
  const defaults = useBotDefaults();
  const save = useSetBotDefaults();
  const current: BotSettings =
    save.isPending && save.variables
      ? save.variables
      : (defaults.data ?? DEFAULT_BOT_SETTINGS);
  const set = (patch: Partial<BotSettings>) =>
    save.mutate(
      { ...current, ...patch },
      { onError: (error) => useToastStore.getState().show(error.message) },
    );
  // Each save sends the whole object, so the switches wait for the stored
  // values: a save built on the fallback would overwrite them.
  return { defaults, current, set, disabled: !defaults.data };
}

const icon = "size-4 shrink-0 text-muted-foreground";

/** The Desktop, Phone and Urgent rows, as an array so a ListGroup draws the dividers. */
export function alertDefaultRows({
  current,
  set,
  disabled,
}: Pick<ReturnType<typeof useAlertDefaults>, "current" | "set" | "disabled">) {
  return [
    <ListRow key="desktop" label="Desktop" icon={<Monitor aria-hidden className={icon} />}>
      <ListSwitch
        label="Desktop alerts for new bots"
        checked={current.desktop}
        disabled={disabled}
        onChange={(desktop) => set({ desktop })}
      />
    </ListRow>,
    <ListRow key="phone" label="Phone" icon={<Smartphone aria-hidden className={icon} />}>
      <ListSwitch
        label="Phone alerts for new bots"
        checked={current.phone}
        disabled={disabled}
        onChange={(phone) => set({ phone })}
      />
    </ListRow>,
    <ListRow key="urgent" label="Urgent" meta="Rings through quiet hours" icon={<Bell aria-hidden className={icon} />}>
      <ListSwitch
        label="New bots' alerts are urgent"
        checked={current.urgent}
        disabled={disabled}
        onChange={(urgent) => set({ urgent })}
      />
    </ListRow>,
  ];
}
