// Before @openuidev/react-lang, which reads its devtools flag as it loads.
import "../genui/setup";
import { createContext, useContext, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { CalendarDays } from "lucide-react-native";
import { createLibrary, Renderer, useRenderNode, type ComponentRenderer } from "@openuidev/react-lang";
import {
  GENUI_ROOT,
  genuiNodes,
  isBoardBlock,
  splitReply,
  spokenTime,
  withRenderers,
  type GenuiName,
  type GenuiNode,
  type GenuiProps,
} from "@timely/contract/genui";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { PropertyChip } from "../ui/primitives";
import DateTimeSheet from "../ui/DateTimeSheet";
import { Ask, kit, Link, type KitProps } from "../genui/kit";
import { ChatText } from "./shared";

/*
 * Reply cards on the phone: the agent's ```openui-lang programs
 * (packages/contract/src/genui.ts) drawn with the phone kit (../genui/kit),
 * the twin of the web's app/_components/chat/replyCards.tsx. A reply with a
 * board (a day strip, stats, a chart) runs under the avatar to use the full
 * width. Answer chips and "Pick a time…" send the person's reply.
 */

/** This is the newest reply, so its Choices still answer it. */
const Newest = createContext(false);

// The avatar and gap before the reply column in Thread.
const AVATAR = 38;

function Reply({ props, renderNode }: KitProps<"Reply">) {
  const blocks = genuiNodes(props.blocks);
  const wide = blocks.some(isBoardBlock);
  return (
    <View style={styles.reply}>
      {blocks.map((block, index) => (
        <View key={index} style={wide && block.typeName !== "Choices" ? styles.wide : undefined}>
          {renderNode(block)}
        </View>
      ))}
    </View>
  );
}

function Choices({ props }: KitProps<"Choices">) {
  const ask = useContext(Ask);
  const answer = useContext(Newest) ? ask : undefined;
  const [picked, setPicked] = useState("");
  const [picking, setPicking] = useState(false);
  const send = (text: string) => {
    if (!answer || !text) return;
    setPicked(text);
    answer(text);
  };
  const options = (Array.isArray(props.options) ? props.options : []).slice(0, 4);
  return (
    <View accessibilityLabel="Suggested answers" style={[styles.choices, !answer && styles.choicesOff]}>
      {options.map((option) => (
        <PropertyChip key={option} label={option} active={picked === option} onPress={() => send(option)} />
      ))}
      {props.pickTime ? (
        <>
          <PropertyChip
            empty
            label="Pick a time…"
            icon={<CalendarDays size={15} color={colors.mutedForeground} />}
            onPress={() => setPicking(true)}
          />
          <DateTimeSheet
            open={picking}
            value={null}
            mode="datetime"
            clearable={false}
            onClose={() => setPicking(false)}
            onChange={(date) => date && send(spokenTime(date))}
          />
        </>
      ) : null}
    </View>
  );
}

const renderers: { [N in GenuiName]: ComponentRenderer<GenuiProps<N>> } = {
  ...kit,
  Reply,
  Choices,
};

const library = createLibrary({
  components: withRenderers(renderers),
  root: GENUI_ROOT,
});

function Root({ node }: { node: GenuiNode }) {
  const renderNode = useRenderNode();
  return <>{renderNode(node)}</>;
}

// The package's default Renderer draws DOM elements, so the phone renders the
// parsed root itself inside Renderer.Root (which keeps the error boundaries).
function Cards({ code }: { code: string }) {
  const [root, setRoot] = useState<GenuiNode | null | undefined>(undefined);
  return (
    <Renderer.Root
      response={code}
      library={library}
      publishObservability={false}
      onParseResult={(result) => setRoot((result?.root as GenuiNode | null | undefined) ?? null)}
    >
      {root ? (
        <Root node={root} />
      ) : root === null ? (
        <Text style={styles.failed}>These cards could not be shown.</Text>
      ) : null}
    </Renderer.Root>
  );
}

/**
 * An assistant reply: its text, with any reply cards drawn where the agent put
 * them. `ask` sends a card's text (an answer chip, "Plan something") as the
 * person's next message; leave it unset while the chat can't take one. Only
 * the `newest` reply's answer chips stay live.
 */
export default function ReplyBody({
  content,
  onLink,
  ask,
  newest = false,
}: {
  content: string;
  onLink: (href: string) => void;
  ask?: (text: string) => void;
  newest?: boolean;
}) {
  const parts = useMemo(() => splitReply(content), [content]);
  return (
    <Link.Provider value={onLink}>
      <Ask.Provider value={ask}>
        <Newest.Provider value={newest}>
          {parts.map((part, index) =>
            part.kind === "text" ? (
              <ChatText key={index} text={part.text} onLink={onLink} />
            ) : (
              <Cards key={index} code={part.code} />
            ),
          )}
        </Newest.Provider>
      </Ask.Provider>
    </Link.Provider>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  reply: { gap: 10, marginTop: 2 },
  wide: { marginLeft: -AVATAR },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  choicesOff: { opacity: 0.5, pointerEvents: "none" },
  failed: { color: colors.mutedForeground, fontSize: 12 },
}));
