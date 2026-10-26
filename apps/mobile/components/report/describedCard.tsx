// Before @openuidev/react-lang, which reads its devtools flag as it loads.
import "../genui/setup";
import { useMemo, useState } from "react";
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
import { BOARD_ROOT, boardFunctions, withBoardRenderers, type BoardName, type BoardProps } from "@timely/contract/genuiBoard";
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
  // New data gives new functions, so the program is read again with it.
  const library = useMemo(
    () => createLibrary({ components, functions: boardFunctions(data, { now, timeZone }), root: BOARD_ROOT }),
    [data, now, timeZone],
  );
  const [root, setRoot] = useState<GenuiNode | null | undefined>(undefined);
  // The package's default Renderer draws DOM elements, so the phone renders
  // the parsed root itself inside Renderer.Root (which keeps the error boundaries).
  return (
    <Link.Provider value={onLink}>
      <View style={styles.bleed}>
        <Renderer.Root
          response={program}
          library={library}
          publishObservability={false}
          onParseResult={(result) => setRoot((result?.root as GenuiNode | null | undefined) ?? null)}
        >
          {root ? (
            <Root node={root} />
          ) : root === null ? (
            <Text style={styles.empty}>This card could not be drawn. Change it to build it again.</Text>
          ) : null}
        </Renderer.Root>
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
