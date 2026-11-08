import { useState } from "react";
import { Text, View } from "react-native";
import { FlaskConical, Trash2 } from "lucide-react-native";
import {
  READ_OPTIONS,
  cleanWatchInput,
  formatMoney,
  type PreviewCandidate,
  type PreviewInput,
  type ReadMode,
  type WatchInput,
  type WatchKind,
  type WatchView,
} from "@timely/contract/bots";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import ConfirmSheet from "../ui/ConfirmSheet";
import { Button, PrimaryButton, Select } from "../ui/primitives";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "../settings/SettingsList";
import { useBotPreview } from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { FieldRow } from "./rows";
import { blankWatch, isStock, reshape, watchErrors } from "./watchDraft";

/** Coins can be quoted in these; Finnhub's stock prices are in USD only. */
const CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY"];

const KIND_OPTIONS: { value: WatchKind; label: string }[] = [
  { value: "page", label: "A page" },
  { value: "feed", label: "A feed" },
  { value: "price", label: "A price" },
];

/** The page read once: what it says now, and the prices found on it to follow instead. */
function PreviewBox({ input, watch, onPick }: { input: PreviewInput; watch: WatchInput; onPick: (candidate: PreviewCandidate) => void }) {
  const preview = useBotPreview(input);
  if (preview.isLoading) return <GroupHint>Reading it once…</GroupHint>;
  if (preview.error) return <Text style={styles.error}>{preview.error.message}</Text>;
  const read = preview.data?.watches[0];
  if (!read) return null;
  if (!read.ok) return <Text style={styles.error}>{read.health?.line || "It could not be read."}</Text>;
  const text = read.excerpt?.text || read.text;
  const candidates = read.candidates ?? [];
  return (
    <View style={styles.section}>
      <GroupLabel aside="Read once, nothing saved">Right now it reads</GroupLabel>
      <View style={styles.readCard}>
        <Text style={styles.readSummary}>{read.summary || "Something, with no summary"}</Text>
        {text ? (
          <Text numberOfLines={4} style={styles.quote}>
            {text}
          </Text>
        ) : null}
        {read.items?.slice(0, 5).map((item, i) => (
          <Text key={`${item.url}-${i}`} numberOfLines={1} style={styles.item}>
            {item.title}
          </Text>
        ))}
      </View>
      {candidates.length ? (
        <>
          <GroupLabel aside="Pick one to follow it">Prices on the page</GroupLabel>
          {candidates.slice(0, 6).map((c, i) => {
            const following =
              c.selector !== "" ? watch.read === "selector_price" && watch.selector === c.selector : watch.read === "product_price";
            return (
              <SheetOption key={`${c.selector}-${i}`} selected={following} onSelect={() => onPick(c)}>
                <View style={styles.candidate}>
                  <Text style={[styles.candidateAmount, c.struck && styles.struck]}>{formatMoney(c.amount, c.currency)}</Text>
                  <Text numberOfLines={1} style={styles.candidateLabel}>
                    {`${c.label}${c.struck ? " · struck out" : ""}`}
                  </Text>
                </View>
              </SheetOption>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

/**
 * One watch on its own page of the bot sheet: a page (its link, what it
 * reads and the part), a feed (its link) or a price (stock or coin, symbol,
 * currency). Test reads it once without saving and offers the prices it
 * found. Save hands the watch back; the sheet saves the bot.
 */
export function WatchPage({
  open,
  watch: initial,
  view,
  isNew,
  isLast,
  unsaved = false,
  hasKey,
  onSave,
  onRemove,
  onClose,
  onAddKey,
}: {
  open: boolean;
  watch: WatchInput;
  view?: WatchView;
  isNew: boolean;
  /** The bot's only watch: it cannot be removed. */
  isLast: boolean;
  /** The bot is not created yet: a watch goes at once, even its only one. */
  unsaved?: boolean;
  hasKey: (source: string) => boolean;
  /** Resolves once saved; a refusal throws with the server's words. */
  onSave: (watch: WatchInput) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  onClose: () => void;
  onAddKey: () => void;
}) {
  const [w, setW] = useState<WatchInput>(initial);
  const [test, setTest] = useState<PreviewInput | null>(null);
  const [lastRefused, setLastRefused] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // As the web editor: a saved stock watch whose key went away keeps its place
  // (the bot shows needs_key), so its other edits still save. Only a new
  // stock watch, or one that now follows another symbol, needs the key.
  const was = view ? cleanWatchInput(initial) : undefined;
  const edited = cleanWatchInput(w);
  const keyKept = !!was && was.source === edited.source && was.symbol === edited.symbol;
  const errors = watchErrors(w, keyKept ? undefined : hasKey);
  const needsKey = w.kind === "price" && isStock(w.source) && !hasKey("finnhub");
  const update = (next: WatchInput) => {
    setW(reshape(w, next));
    setTest(null);
    setRefused(null);
  };
  const partRead = w.read === "selector" || w.read === "selector_price";
  const urlOk = w.kind !== "price" && !!w.url?.trim() && !errors.some((e) => /address|link/.test(e));

  const run = async (action: () => void | Promise<void>) => {
    setBusy(true);
    setRefused(null);
    try {
      await action();
    } catch (error) {
      setRefused(error instanceof Error ? error.message : "That didn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (unsaved) {
      void run(() => onRemove?.());
      return;
    }
    if (isLast) {
      setLastRefused(true);
      return;
    }
    setConfirming(true);
  };

  const rows = [];
  if (isNew) {
    rows.push(
      <Select
        key="kind"
        trigger="row"
        label="Watches"
        value={w.kind}
        options={KIND_OPTIONS}
        onChange={(kind) => {
          if (kind === w.kind) return;
          setW(blankWatch(kind as WatchKind));
          setTest(null);
        }}
      />,
    );
  }
  if (w.kind === "price") {
    rows.push(
      <Select
        key="market"
        trigger="row"
        label="Kind"
        value={isStock(w.source) ? "stock" : "crypto"}
        options={[
          { value: "stock", label: "Stock" },
          { value: "crypto", label: "Coin" },
        ]}
        onChange={(v) => update({ ...w, source: v, currency: v === "crypto" ? w.currency || "USD" : "" })}
      />,
      <FieldRow
        key="symbol"
        title="Symbol"
        meta={isStock(w.source) ? "Like NVDA or AAPL" : "Like BTC or ETH. Pick the currency below"}
        value={w.symbol ?? ""}
        placeholder={isStock(w.source) ? "NVDA" : "BTC"}
        autoCapitalize="words"
        width={140}
        onChangeText={(symbol) => update({ ...w, symbol: symbol.toUpperCase() })}
      />,
      <Select
        key="currency"
        trigger="row"
        label="Currency"
        value={w.currency ?? ""}
        options={[{ value: "", label: "The source’s own" }, ...(isStock(w.source) ? ["USD"] : CURRENCIES).map((c) => ({ value: c, label: c }))]}
        onChange={(currency) => update({ ...w, currency })}
      />,
    );
  } else {
    rows.push(
      <FieldRow
        key="url"
        title={w.kind === "feed" ? "Feed link" : "Page link"}
        value={w.url ?? ""}
        placeholder="https://"
        keyboardType="url"
        width={190}
        onChangeText={(url) => update({ ...w, url })}
      />,
    );
    if (w.kind === "page") {
      rows.push(
        <Select
          key="read"
          trigger="row"
          label="Reads"
          value={w.read ?? "text"}
          options={READ_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
          onChange={(read) => update({ ...w, read: read as ReadMode })}
        />,
      );
    }
    if (partRead) {
      rows.push(
        <FieldRow
          key="selector"
          title="The part"
          meta="A CSS selector, like #price"
          value={w.selector ?? ""}
          placeholder="#price"
          width={150}
          onChangeText={(selector) => update({ ...w, selector })}
        />,
      );
    }
    rows.push(
      <ListRow
        key="test"
        title="Test it"
        meta="Reads it once now. Nothing is saved."
        trailing={
          <Button
            label="Test"
            size="sm"
            variant="outline"
            icon={<FlaskConical size={16} color={colors.foreground} />}
            disabled={!urlOk}
            onPress={() => setTest({ watches: [cleanWatchInput({ ...w, rules: undefined })] })}
          />
        }
      />,
    );
  }

  const footerLine = refused ?? errors[0] ?? null;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={isNew ? "New watch" : "Edit watch"}
      footer={<PrimaryButton label={isNew ? "Add watch" : "Save"} disabled={errors.length > 0} loading={busy} onPress={() => void run(() => onSave(cleanWatchInput(w)))} />}
    >
      <View style={styles.body}>
        <View style={styles.section}>
          <GroupLabel>What it reads</GroupLabel>
          <ListGroup>{rows}</ListGroup>
          {w.kind === "price" && isStock(w.source) ? (
            needsKey ? (
              <GroupHint>
                Stock prices need your free Finnhub key.{" "}
                <Text accessibilityRole="link" style={styles.link} onPress={onAddKey}>
                  Add a free Finnhub key
                </Text>
              </GroupHint>
            ) : (
              <GroupHint>Prices from Finnhub (your free key).</GroupHint>
            )
          ) : w.kind === "price" ? (
            <GroupHint>Coin prices from Coinbase. No key needed.</GroupHint>
          ) : null}
          {footerLine ? <Text style={refused ? styles.error : styles.muted}>{footerLine}</Text> : null}
        </View>
        {test ? (
          <PreviewBox
            input={test}
            watch={w}
            onPick={(c) =>
              update(c.selector ? { ...w, read: "selector_price", selector: c.selector } : { ...w, read: "product_price", selector: undefined })
            }
          />
        ) : null}
        {!isNew ? (
          <View style={styles.section}>
            <ListGroup>
              <ListRow title="Remove watch" tone="danger" leading={<Trash2 size={18} color={colors.destructive} />} onPress={remove} />
            </ListGroup>
            {lastRefused ? <Text style={styles.error}>A bot needs a watch. Delete the bot instead, or add another watch first.</Text> : null}
          </View>
        ) : null}
      </View>
      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Remove this watch?"
        message={view?.kind === "price" || view?.read === "product_price" ? "Its readings and price history go too." : "Its readings go too."}
        confirmLabel="Remove"
        onConfirm={() => void run(() => onRemove?.())}
      />
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { gap: 16, paddingTop: 4 },
  section: { gap: 6 },
  muted: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
  error: { color: colors.destructive, fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
  link: { color: colors.primary, fontWeight: "600" },
  readCard: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14, gap: 8 },
  readSummary: { color: colors.foreground, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  quote: {
    borderRadius: 10,
    backgroundColor: colors.muted,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.foreground,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "monospace",
  },
  item: { color: colors.mutedForeground, fontSize: 12 },
  candidate: { paddingVertical: 6 },
  candidateAmount: { color: colors.foreground, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  struck: { textDecorationLine: "line-through", color: colors.mutedForeground },
  candidateLabel: { color: colors.mutedForeground, fontSize: 12, marginTop: 1 },
}));
