// Before @openuidev/react-lang, which reads its devtools flag as it loads.
import "../genui/setup";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  createLibrary,
  Renderer,
  useRenderNode,
  type ComponentRenderProps,
  type ComponentRenderer,
} from "@openuidev/react-lang";
import type { DashboardData } from "@timely/contract/dashboard";
import { genuiNodes, type GenuiNode } from "@timely/contract/genui";
import { BOARD_ROOT, drawBoard, withBoardRenderers, type BoardName, type BoardProps } from "@timely/contract/genuiBoard";
import { createThemedStyleSheet } from "../../lib/theme";
import { kit, Link, RowGroup, Surface } from "../genui/kit";

/*
 * A described card on the phone dashboard: the agent's program
 * (genuiBoard.ts) drawn with the phone kit, flat inside the board card, the
 * twin of the web's report/describedCard.tsx. Its @Data calls read the
 * dashboard's own data, so a tick or a refresh redraws it at once and the
 * model is never asked again.
 */

type Props<N extends BoardName> = ComponentRenderProps<BoardProps<N>>;

function Panel({ props, renderNode }: Props<"Panel">) {
  return (
    <Surface.Provider value="board">
      <View>
        {genuiNodes(props.blocks).map((block, index) => (
          <View key={index} style={index > 0 ? styles.divider : undefined}>
            {renderNode(block)}
          </View>
        ))}
      </View>
    </Surface.Provider>
  );
}

function List({ props, renderNode }: Props<"List">) {
  const rows = genuiNodes(props.rows);
  return (
    <View>
      {rows.length ? (
        <RowGroup rows={rows} renderNode={renderNode} />
      ) : (
        <Text style={styles.empty}>{props.empty || "Nothing here yet"}</Text>
      )}
      {props.open ? <View style={[styles.divider, styles.foot]}>{renderNode(props.open)}</View> : null}
    </View>
  );
}

const renderers: { [N in BoardName]: ComponentRenderer<BoardProps<N>> } = { ...kit, Panel, List };
const components = withBoardRenderers(renderers);

function Root({ node }: { node: GenuiNode }) {
  const renderNode = useRenderNode();
  return <>{renderNode(node)}</>;
}

// Renderer.Root gives the drawn nodes their renderers and error boundaries;
// the root itself comes from drawBoard, already worked out.
const library = createLibrary({ components, root: BOARD_ROOT });

export default function DescribedCardView({
  program,
  data,
  timeZone,
  now,
  onLink,
}: {
  program: string;
  data: DashboardData;
  timeZone?: string;
  now: Date;
  onLink: (href: string) => void;
}) {
  // New data answers the @Data calls again, so a tick redraws the card at once.
  const root = useMemo(() => drawBoard(program, data, { now, timeZone }), [program, data, now, timeZone]);
  return (
    <Link.Provider value={onLink}>
      <View style={styles.bleed}>
        {root ? (
          <Renderer.Root response="" library={library} publishObservability={false}>
            <Root node={root} />
          </Renderer.Root>
        ) : (
          <Text style={styles.empty}>This card could not be drawn. Change it to build it again.</Text>
        )}
      </View>
    </Link.Provider>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  // The board card pads its body by 14; the rows run edge to edge like the card's own dividers.
  bleed: { marginHorizontal: -14, marginBottom: -14 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  foot: { paddingHorizontal: 14, paddingVertical: 11 },
  empty: { color: colors.mutedForeground, fontSize: 14, paddingHorizontal: 14, paddingVertical: 12 },
}));
