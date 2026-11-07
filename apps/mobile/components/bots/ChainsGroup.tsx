import type { BotView, Chain } from "@timely/contract/bots";
import { ListGroup, ListRow } from "../settings/SettingsList";

/**
 * The board's Chains group, as on the web: one row per chain of Pass to
 * links with what it passed on today, opening its first bot. The first bot
 * is the title and the rest of the chain the line under it ("→ Price check
 * → Wishlist"), so a long chain is not cut off on a phone.
 */
export function ChainsGroup({ chains, bots, onOpen }: { chains: Chain[]; bots: Pick<BotView, "id" | "name">[]; onOpen: (id: string) => void }) {
  const name = (id: string) => bots.find((b) => b.id === id)?.name ?? id;
  return (
    <ListGroup>
      {chains.map((c) => (
        <ListRow
          key={c.ids.join(">")}
          title={name(c.ids[0])}
          meta={c.ids
            .slice(1)
            .map((id) => `→ ${name(id)}`)
            .join(" ")}
          trailing={`${c.passedToday} today`}
          accessibilityLabel={`${c.label}, ${c.passedToday} passed on today. Opens ${name(c.ids[0])}`}
          onPress={() => onOpen(c.firstBotId)}
        />
      ))}
    </ListGroup>
  );
}
