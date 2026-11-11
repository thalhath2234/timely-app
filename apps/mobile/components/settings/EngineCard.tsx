import { useState } from "react";
import { Text, View } from "react-native";
import { ENGINE_COPY, type AccountEngine, type AgentChatSettings } from "@timely/contract/agentChat";
import { createThemedStyleSheet } from "../../lib/theme";
import { usePatchAgentChatSettings } from "../../lib/hooks";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "./SettingsList";

const ENGINES: AccountEngine[] = ["classic", "agent"];

/**
 * Settings → Agent → Engine (Q-2.2): Classic or New for this account's chats,
 * Classic until the person picks New. New shows why it can't run here when
 * the server says so; a chat can still go back to Classic on its own.
 */
export default function EngineCard({ settings }: { settings: AgentChatSettings }) {
  const patch = usePatchAgentChatSettings();
  const [open, setOpen] = useState(false);
  const current = settings.engine === "agent" ? "agent" : "classic";
  const unavailable = !settings.engineAvailable;
  return (
    <View testID="agent-engine" style={{ gap: 6 }}>
      <GroupLabel>Engine</GroupLabel>
      <ListGroup>
        <ListRow
          testID="agent-engine-row"
          title="Chats run on"
          trailing={ENGINE_COPY[current].name}
          accessibilityLabel={`Chats run on ${ENGINE_COPY[current].name}. Change`}
          onPress={() => setOpen(true)}
        />
      </ListGroup>
      {patch.error ? (
        <Text style={styles.error}>{patch.error.message || "Could not save."}</Text>
      ) : (
        <GroupHint>
          {unavailable && settings.engineReason
            ? `New isn’t available here: ${settings.engineReason}`
            : ENGINE_COPY[current].description}
        </GroupHint>
      )}
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Engine" subtitle="New runs use it; a run already going finishes where it started">
        {ENGINES.map((engine) => (
          <SheetOption
            key={engine}
            selected={engine === current}
            // New can't be picked while it can't run; Classic always can.
            disabled={engine === "agent" && unavailable && current !== "agent"}
            detail={engine === "agent" && unavailable && settings.engineReason ? settings.engineReason : ENGINE_COPY[engine].description}
            onSelect={() => {
              setOpen(false);
              if (engine !== current) patch.mutate({ engine });
            }}
          >
            {ENGINE_COPY[engine].name}
          </SheetOption>
        ))}
      </BottomSheet>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  error: { color: colors.destructive, fontSize: 12, marginHorizontal: 4 },
}));
