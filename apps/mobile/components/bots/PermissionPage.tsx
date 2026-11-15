import { useState } from "react";
import { Check } from "lucide-react-native";
import type { BotPermission } from "@timely/contract/bots";
import { colors } from "../../lib/theme";
import { GroupHint, ListGroup, ListRow } from "../settings/SettingsList";
import { PERMISSION_COPY, PHONE_PERMISSIONS } from "./agentBot";
import { SavePage } from "./SavePage";

const ORDER: BotPermission[] = ["supervised", "auto", "full"];

/**
 * How much the Bot may do without asking. In Supervised and Auto a step that
 * needs your OK waits in Needs you and the run goes on. Full Access is shown
 * but set on the desktop, after the step-up.
 */
export function PermissionPage({
  open,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  initial: BotPermission;
  onSave: (mode: BotPermission) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<BotPermission>(initial);
  return (
    <SavePage open={open} title="Permission" canSave={mode !== initial} onSave={() => onSave(mode)} onClose={onClose}>
      <ListGroup>
        {ORDER.map((id) => {
          const offered = PHONE_PERMISSIONS.includes(id) || id === initial;
          return (
            <ListRow
              key={id}
              title={PERMISSION_COPY[id].name}
              meta={PERMISSION_COPY[id].line}
              chevron={false}
              disabled={!offered}
              onPress={offered ? () => setMode(id) : undefined}
              trailing={mode === id ? <Check size={18} color={colors.primary} /> : undefined}
            />
          );
        })}
      </ListGroup>
      <GroupHint>A step that needs approval becomes a card in Needs you. Run once runs exactly that call.</GroupHint>
    </SavePage>
  );
}
