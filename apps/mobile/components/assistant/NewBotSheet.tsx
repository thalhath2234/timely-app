import { View } from "react-native";
import { MessageCircle } from "lucide-react-native";
import BottomSheet from "../ui/BottomSheet";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "../settings/SettingsList";
import { scheduleWords, starterRequest, starterRows } from "../bots/agentBot";
import { colors, createThemedStyleSheet } from "../../lib/theme";

/**
 * New Bot: describe it (it starts as its thread, with the whole setup shown
 * for one Create) or begin from a Starter, one per Hermes blueprint. A Starter
 * that needs a connector Timely lacks says what it needs and stays off.
 */
export function NewBotSheet({
  open,
  connectors = [],
  onClose,
  onStart,
}: {
  open: boolean;
  /** Connectors the account has; none are offered yet, so email Starters stay off. */
  connectors?: readonly string[];
  onClose: () => void;
  /** Opens a new Bot's thread, with the Starter's request already sent when there is one. */
  onStart: (firstMessage?: string) => void;
}) {
  const rows = starterRows(connectors);
  return (
    <BottomSheet open={open} onClose={onClose} title="New Bot" subtitle="Say what it should do, or start from one">
      <View style={styles.body}>
        <ListGroup>
          <ListRow
            title="Describe it"
            meta="Tell it what to watch or do, and when"
            leading={<MessageCircle size={18} color={colors.primary} />}
            onPress={() => onStart(undefined)}
          />
        </ListGroup>
        <GroupLabel aside={String(rows.length)}>Starters</GroupLabel>
        <ListGroup>
          {rows.map(({ starter, available, copy }) => (
            <ListRow
              key={starter.key}
              title={starter.title}
              meta={available ? scheduleWords(starter.schedule) : (copy ?? undefined)}
              disabled={!available}
              onPress={available ? () => onStart(starterRequest(starter)) : undefined}
            />
          ))}
        </ListGroup>
        <GroupHint>You see its whole setup first and create it with one tap.</GroupHint>
      </View>
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet(() => ({
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
}));
