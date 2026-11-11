"use client";

import { CircleAlert } from "lucide-react";
import {
  ENGINE_COPY,
  type AccountEngine,
  type AgentChatSettings,
} from "@timely/contract/agentChat";
import SegmentedControl from "@/app/_components/_ui/segmentedControl";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "@/app/_components/_ui/groupedList";
import { usePatchChatSettings } from "@/app/utils/hooks/chat";

/**
 * Settings → Agent → Engine (Q-2.2): which engine new runs use, Classic
 * until the person picks New. When New cannot run here, a row says why;
 * Timely never switches a chat's engine on its own.
 */
export default function EngineGroup({ settings }: { settings: AgentChatSettings }) {
  const patch = usePatchChatSettings();
  const engine = settings.engine;
  return (
    <div data-testid="agent-engine">
      <GroupLabel aside="For new runs">Engine</GroupLabel>
      <ListGroup>
        <ListRow label="Chats run on">
          <SegmentedControl<AccountEngine>
            size="sm"
            aria-label="Engine"
            value={engine}
            onChange={(next) => patch.mutate({ engine: next })}
            options={[
              { value: "classic", label: ENGINE_COPY.classic.name },
              { value: "agent", label: ENGINE_COPY.agent.name },
            ]}
          />
        </ListRow>
        {!settings.engineAvailable && (
          // A row of its own whose reason wraps; ListRow's second line truncates.
          <div role="status" className="flex items-start gap-2.5 px-3.5 py-2.5">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-warning-text" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-foreground">
                {engine === "agent" ? "New can't run here now" : "New isn't available here yet"}
              </span>
              <span className="block text-xs leading-4 text-muted-foreground">
                {settings.engineReason || "The agent engine isn't installed on this server."}
              </span>
            </span>
          </div>
        )}
      </ListGroup>
      <GroupHint>
        {patch.error
          ? patch.error.message
          : engine === "agent" && !settings.engineAvailable
            ? "Chats on New stop with “Use classic for this chat” until it can run."
            : `${ENGINE_COPY[engine].description} Private photo chats and applying changes always run on Classic.`}
      </GroupHint>
    </div>
  );
}
