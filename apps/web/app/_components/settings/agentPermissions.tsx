"use client";

import {
  ChevronRight,
  CreditCard,
  Globe,
  Lock,
  Package,
  Send,
  Settings2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  ALWAYS_BLOCKED_NOTE,
  AUTO_ASKS_BEFORE,
  type AgentChatSettings,
  type CriticalRow,
  type PermissionMode,
} from "@timely/contract/agentChat";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "@/app/_components/_ui/groupedList";
import { PermissionChip, PermissionPopover } from "@/app/_components/chat/permissionPicker";
import { cn } from "@/app/utils/cn";
import { usePatchChatSettings } from "@/app/utils/hooks/chat";

/**
 * Settings → Agent → Permissions, the drawn "Settings › Assistant" panel
 * (on the Agent tab until the combined Assistant tab of phase 6): the modes
 * new chats and bots start on, what Auto always asks before, and Full
 * Access. In phase 2 Full Access works like Auto for Timely data, so the
 * rows say only what is true now.
 */

/** The drawn icon of each "Auto always asks before" row, by critical item. */
const CRITICAL_ICONS: Record<CriticalRow["item"], LucideIcon> = {
  1: Trash2,
  2: Send,
  3: CreditCard,
  4: Package,
  5: Settings2,
  6: Globe,
};

/** A grouped row whose value is the mode chip; it opens the picker. */
function ModeRow({
  label,
  value,
  scope,
  onChange,
  edge,
}: {
  label: string;
  value: PermissionMode;
  scope: "new chats" | "bots";
  onChange: (mode: PermissionMode) => void;
  /** Rounds the hover to the card's corner. */
  edge: "top" | "bottom";
}) {
  return (
    <PermissionPopover
      value={value}
      onChange={onChange}
      scope={scope}
      title={scope === "bots" ? "Permission for bots" : "Permission for new chats"}
      placement="below"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
          className={cn(
            "flex min-h-10 w-full cursor-pointer items-center gap-2.5 px-3.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 aria-expanded:bg-muted/50",
            edge === "top" ? "rounded-t-[11px]" : "rounded-b-[11px]",
          )}
        >
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{label}</span>
          <PermissionChip mode={value} size="sm" />
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      )}
    />
  );
}

export default function PermissionsGroups({ settings }: { settings: AgentChatSettings }) {
  const patch = usePatchChatSettings();
  return (
    <div className="flex flex-col gap-5" data-testid="agent-permissions">
      <div>
        <GroupLabel aside="Default for new runs">Permissions</GroupLabel>
        {/* ListGroup's look without its clipping, so the picker can open below a row. */}
        <div className="rounded-[12px] border border-border bg-card">
          <ModeRow
            label="New chats"
            scope="new chats"
            edge="top"
            value={settings.chatPermission}
            onChange={(mode) => patch.mutate({ chatPermission: mode })}
          />
          <div aria-hidden className="ml-3.5 h-px bg-border" />
          <ModeRow
            label="Bots"
            scope="bots"
            edge="bottom"
            value={settings.botPermission}
            onChange={(mode) => patch.mutate({ botPermission: mode })}
          />
        </div>
        <GroupHint>
          {patch.error
            ? patch.error.message
            : "Each chat can pick its own from the chip under the message box. A change that needs you waits in the chat until you approve it."}
        </GroupHint>
      </div>

      <div>
        <GroupLabel>Auto always asks before</GroupLabel>
        <ListGroup>
          {AUTO_ASKS_BEFORE.map((row) => {
            const Icon = CRITICAL_ICONS[row.item];
            return (
              <ListRow
                key={row.item}
                icon={<Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
                label={row.title}
                meta={row.detail}
              />
            );
          })}
        </ListGroup>
      </div>

      <div>
        <GroupLabel>Full Access</GroupLabel>
        <ListGroup>
          <ListRow label="Turning it on asks for">
            <span className="text-[13px] font-medium text-muted-foreground">A confirmation</span>
          </ListRow>
          <ListRow label="Allowed on">
            <span className="text-[13px] font-medium text-muted-foreground">
              {settings.fullAccessAllowedOn === "devices" ? "All your devices" : "This desktop"}
            </span>
          </ListRow>
        </ListGroup>
        <p className="flex gap-1.5 px-1 pt-1.5 text-xs leading-relaxed text-muted-foreground">
          <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{ALWAYS_BLOCKED_NOTE}</span>
        </p>
      </div>
    </div>
  );
}
