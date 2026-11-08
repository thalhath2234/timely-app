import { useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { X } from "lucide-react-native";
import {
  notItMessage,
  previewCard,
  proposalFacts,
  sourceLabel,
  watchTitle,
  type PreviewWatch,
  type WatchInput,
} from "@timely/contract/bots";
import type { ReviewBotRow, ReviewGroup } from "@timely/contract/changeReview";
import { useBotIcons } from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { BotCard } from "../bots/BotCard";
import { BotMark, botSites, type SiteIcons } from "../bots/BotMark";
import type { BotActions } from "../bots/useBotActions";
import { ListGroup, ListRow, ListSubLabel } from "../settings/SettingsList";
import { Button } from "../ui/primitives";
import NotItSheet, { Excerpt } from "./NotItSheet";

type BotGroup = Extract<ReviewGroup, { kind: "bot" }>;

/**
 * What the person can say back to a proposed bot from its card: pick another
 * price on the page (sent as their message), or say it in their own words.
 */
export type BotReplyActions = {
  send: (text: string) => void;
  compose: (text: string) => void;
  disabled?: boolean;
};

/** The "On your board" card only draws; it has no buttons to act with. */
const NO_ACTIONS: BotActions = { act: () => {}, busy: () => null };

/** The line under "Right now it reads", by what the watch reads. */
function readsSub(read: PreviewWatch, watch: WatchInput | undefined) {
  if (read.kind === "feed") return "The newest posts in the feed";
  if (read.kind === "price")
    return `The price from ${sourceLabel(watch?.source ?? "")}`;
  if (read.read === "product_price" || read.read === "selector_price")
    return "The price I found on the page";
  return "The part I found on the page";
}

/** "Right now it reads: ₹19,999", the excerpt it read, and "That's not it". */
function ReadsBox({
  read,
  watch,
  label,
  botName,
  reply,
}: {
  read: PreviewWatch;
  watch: WatchInput | undefined;
  label?: string;
  botName: string;
  reply?: BotReplyActions;
}) {
  const [open, setOpen] = useState(false);
  const candidates = read.ok ? (read.candidates ?? []) : [];
  const other = () => reply?.compose("That’s not it: ");
  return (
    <View
      accessibilityLabel={label ? `What ${label} reads` : "What it reads"}
      style={styles.reads}
    >
      {label ? (
        <Text numberOfLines={1} style={styles.muted13}>
          {label}
        </Text>
      ) : null}
      {read.ok ? (
        <>
          <Text style={styles.readsTitle}>
            Right now it reads: {read.summary || "nothing yet"}
          </Text>
          <Text style={styles.muted13}>{readsSub(read, watch)}</Text>
          <Excerpt read={read} />
        </>
      ) : (
        <>
          <Text style={styles.readsTitle}>It couldn’t read it just now</Text>
          <Text style={styles.bad}>
            {read.health?.line || "The page did not answer."}
          </Text>
        </>
      )}
      {reply ? (
        <View style={{ alignSelf: "flex-start" }}>
          <Button
            label="That’s not it"
            variant="outline"
            icon={<X size={16} color={colors.foreground} />}
            disabled={reply.disabled}
            onPress={() => (candidates.length ? setOpen(true) : other())}
          />
        </View>
      ) : null}
      {reply && candidates.length ? (
        <NotItSheet
          open={open}
          onClose={() => setOpen(false)}
          botName={botName}
          watch={read}
          onPick={(candidate) =>
            reply.send(
              notItMessage(candidate, { site: read.site, url: watch?.url }),
            )
          }
          onOther={other}
        />
      ) : null}
    </View>
  );
}

function RowValue({ row, icons }: { row: ReviewBotRow; icons: SiteIcons }) {
  return (
    <View style={styles.value}>
      {row.site && row.kind ? (
        <BotMark
          watches={[{ kind: row.kind, site: row.site }]}
          size={24}
          badge={false}
          icons={icons}
        />
      ) : null}
      <Text numberOfLines={2} style={styles.valueText}>
        {row.before ? <Text style={styles.struck}>{row.before}</Text> : null}
        {row.before ? " → " : ""}
        {row.value}
      </Text>
    </View>
  );
}

/**
 * A proposed bot in chat, as Option 2 draws it on the phone, stacked: the
 * bot's rows, how it lands on the board with First check / Then / At most,
 * then what each watch reads right now with "That's not it".
 */
export default function BotChangeBody({
  group,
  status,
  reply,
}: {
  group: BotGroup;
  /** Shown instead of the New/Edit pill once the change is applied or fails. */
  status?: ReactNode;
  reply?: BotReplyActions;
}) {
  const now = useMemo(() => new Date(), []);
  // The header mark takes each watch's site from the reading (the
  // registrable domain the rows and board preview show), not the full host.
  const marked = useMemo(
    () =>
      group.args.watches.map((w, i) => {
        const site = group.preview?.watches?.find((r) => r.index === i)?.site;
        return site ? { ...w, site } : w;
      }),
    [group.args.watches, group.preview],
  );
  const icons = useBotIcons(botSites(marked)).data;
  const card = useMemo(
    () => previewCard(group.args, group.preview, now),
    [group.args, group.preview, now],
  );
  const reads = group.preview?.watches ?? [];
  const several = group.args.watches.length > 1;
  let lastWatch: number | undefined;
  const rows: ReactNode[] = [];
  group.rows.forEach((row, i) => {
    if (row.watch && row.watchIndex !== lastWatch)
      rows.push(<ListSubLabel key={`sub:${i}`}>{row.watch}</ListSubLabel>);
    lastWatch = row.watchIndex;
    rows.push(
      <ListRow
        key={`row:${i}`}
        title={row.label}
        accessibilityLabel={`${row.label}, ${row.before ? `${row.before} to ` : ""}${row.value}`}
        trailing={<RowValue row={row} icons={icons} />}
      />,
    );
  });
  return (
    <View style={{ gap: 12 }}>
      <ListGroup>
        <View style={styles.head}>
          <BotMark watches={marked} size={36} icons={icons} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.eyebrow}>{group.eyebrow}</Text>
            <Text numberOfLines={2} style={styles.title}>
              {group.name}
            </Text>
          </View>
          {status ?? (
            <View style={styles.pill}>
              <Text style={styles.pillText}>
                {group.action === "create" ? "New" : "Edit"}
              </Text>
            </View>
          )}
        </View>
        {rows}
      </ListGroup>
      <Text style={styles.boardLabel}>On your board</Text>
      <BotCard
        bot={card}
        now={now}
        variant="preview"
        icons={icons}
        actions={NO_ACTIONS}
      />
      <ListGroup>
        {proposalFacts(group.args).map(([label, value]) => (
          <ListRow key={label} title={label} trailing={value} />
        ))}
      </ListGroup>
      {reads.map((read) => {
        const watch = group.args.watches[read.index];
        return (
          <ReadsBox
            key={read.index}
            read={read}
            watch={watch}
            label={
              several && watch
                ? watchTitle({ ...watch, site: read.site })
                : undefined
            }
            botName={group.name}
            reply={reply}
          />
        );
      })}
      {group.previewError ? (
        <View accessibilityLabel="What it reads" style={styles.reads}>
          <Text style={styles.readsTitle}>It couldn’t read it just now</Text>
          <Text style={styles.bad}>{group.previewError}</Text>
          {reply ? (
            <View style={{ alignSelf: "flex-start" }}>
              <Button
                label="That’s not it"
                variant="outline"
                icon={<X size={16} color={colors.foreground} />}
                disabled={reply.disabled}
                onPress={() => reply.compose("That’s not it: ")}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = createThemedStyleSheet(() => ({
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: colors.mutedForeground,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
    color: colors.foreground,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: `${colors.primary}1F`,
  },
  pillText: { fontSize: 11, fontWeight: "500", color: colors.primary },
  value: {
    flexShrink: 1,
    maxWidth: "62%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  valueText: {
    flexShrink: 1,
    textAlign: "right",
    fontSize: 14,
    fontWeight: "500",
    color: colors.mutedForeground,
    fontVariant: ["tabular-nums"],
  },
  struck: { textDecorationLine: "line-through" },
  boardLabel: {
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: colors.mutedForeground,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  reads: { gap: 6 },
  readsTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  muted13: { fontSize: 13, lineHeight: 18, color: colors.mutedForeground },
  bad: { fontSize: 13, lineHeight: 18, color: colors.destructive },
}));
