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
        <ListRow label="Chats run on" meta={ENGINE_COPY[engine].description}>
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
          <ListRow
            icon={<CircleAlert aria-hidden className="size-4 shrink-0 text-warning-text" />}
            label={engine === "agent" ? "New can't run here now" : "New isn't available here yet"}
            meta={settings.engineReason || "The agent engine isn't installed on this server."}
          />
        )}
      </ListGroup>
      <GroupHint>
        {patch.error
          ? patch.error.message
          : engine === "agent" && !settings.engineAvailable
            ? "Chats on New stop with “Use classic for this chat” until it can run."
            : "Private photo chats and applying changes always run on Classic."}
      </GroupHint>
    </div>
  );
}
