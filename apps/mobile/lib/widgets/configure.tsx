import { useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Check } from "lucide-react-native";
import { WidgetPreview, type WidgetConfigurationScreenProps } from "react-native-android-widget";
import type { DashboardCard } from "@timely/contract/dashboard";
import AnimatedPressable from "../../components/ui/AnimatedPressable";
import { Button, SectionLabel } from "../../components/ui/primitives";
import { LogoSpinner } from "../../components/ui/TimelyLogo";
import { colors, createThemedStyleSheet, initializeTheme, radius, ThemeRoot } from "../theme";
import { cardWidgetModel, widgetChoices, type WidgetModel } from "./model";
import { renderCard } from "./render";
import { loadCards, loadWidgetInput } from "./data";
import { renderWidgetFor } from "./taskHandler";
import { setWidgetEntry, widgetEntry } from "./storage";

/**
 * Opens when a "Timely card" widget is added (or held and reconfigured):
 * pick which Dashboard card it shows, with a live preview, then Add.
 * Custom cards are listed first because they exist nowhere else.
 */

type Load = { state: "loading" } | { state: "signedOut" } | { state: "ready"; cards: DashboardCard[] };

const PREVIEW_HEIGHT = 168;

export function WidgetConfigurationScreen(props: WidgetConfigurationScreenProps) {
  const [themed, setThemed] = useState(false);
  useEffect(() => {
    void initializeTheme().finally(() => setThemed(true));
  }, []);
  if (!themed) return <View style={{ flex: 1 }} />;
  return (
    <ThemeRoot>
      <SafeAreaProvider>
        <CardPicker {...props} />
      </SafeAreaProvider>
    </ThemeRoot>
  );
}

export function CardPicker({ widgetInfo, renderWidget, setResult }: WidgetConfigurationScreenProps) {
  const insets = useSafeAreaInsets();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [selected, setSelected] = useState<string | null>(() => widgetEntry(widgetInfo.widgetId).cardId ?? null);
  const [models, setModels] = useState<Record<string, WidgetModel>>({});
  const [saving, setSaving] = useState(false);
  const reconfiguring = Boolean(widgetEntry(widgetInfo.widgetId).cardId);

  useEffect(() => {
    let alive = true;
    void loadCards().then((board) => {
      if (!alive) return;
      if (!board) return setLoad({ state: "signedOut" });
      setLoad({ state: "ready", cards: board.cards });
      setSelected((current) => (current && board.cards.some((card) => card.id === current) ? current : (board.cards[0]?.id ?? null)));
    });
    return () => {
      alive = false;
    };
  }, []);

  const cards = load.state === "ready" ? load.cards : [];
  const card = cards.find((c) => c.id === selected) ?? null;

  useEffect(() => {
    if (!card || models[card.id]) return;
    let alive = true;
    void loadWidgetInput([card]).then((input) => {
      if (alive && input) setModels((current) => ({ ...current, [card.id]: cardWidgetModel(card, input) }));
    });
    return () => {
      alive = false;
    };
  }, [card, models]);

  const choices = useMemo(() => widgetChoices(cards), [cards]);
  const yours = choices.filter((choice) => choice.custom);
  const builtin = choices.filter((choice) => !choice.custom);
  const model = card ? models[card.id] : undefined;
  const previewWidth = Math.min(widgetInfo.width || 170, 320);

  const save = async () => {
    if (!card) return;
    setSaving(true);
    setWidgetEntry(widgetInfo.widgetId, { cardId: card.id, ...(model ? { model } : {}) });
    try {
      renderWidget(await renderWidgetFor(widgetInfo, card.id));
    } catch {
      if (model) renderWidget(renderCard(model, { width: widgetInfo.width, height: widgetInfo.height }));
    }
    setResult("ok");
  };

  const row = (choice: (typeof choices)[number]) => {
    const active = choice.id === selected;
    return (
      <AnimatedPressable
        key={choice.id}
        accessibilityRole="radio"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`${choice.title}, ${choice.kind}`}
        onPress={() => setSelected(choice.id)}
        style={[styles.row, active && styles.rowActive]}
      >
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {choice.title}
          </Text>
          <Text style={styles.rowKind} numberOfLines={1}>
            {choice.kind}
          </Text>
        </View>
        <View style={[styles.radio, active && styles.radioActive]}>{active ? <Check size={14} color={colors.primaryForeground} strokeWidth={3} /> : null}</View>
      </AnimatedPressable>
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{reconfiguring ? "Change card" : "Choose a card"}</Text>
        <Text style={styles.subtitle}>The widget shows one card from your Dashboard and keeps it up to date.</Text>
      </View>

      {load.state === "loading" ? (
        <View style={styles.center}>
          <LogoSpinner size={28} />
        </View>
      ) : load.state === "signedOut" ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Sign in first</Text>
          <Text style={styles.emptyText}>Open Timely and sign in, then add the widget again.</Text>
        </View>
      ) : (
        <>
          <View style={styles.previewWell}>
            {Platform.OS === "android" && model ? (
              <WidgetPreview
                renderWidget={(size) => renderCard(model, size).light}
                width={previewWidth}
                height={PREVIEW_HEIGHT}
              />
            ) : (
              <View style={[styles.previewPlaceholder, { width: previewWidth }]}>
                <LogoSpinner size={20} />
              </View>
            )}
          </View>
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {yours.length ? (
              <>
                <SectionLabel>Your cards</SectionLabel>
                <View style={styles.group}>{yours.map(row)}</View>
              </>
            ) : null}
            <SectionLabel>Dashboard cards</SectionLabel>
            <View style={styles.group}>{builtin.map(row)}</View>
          </ScrollView>
        </>
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.footerButton}>
          <Button label="Cancel" variant="secondary" onPress={() => setResult("cancel")} stretch />
        </View>
        <View style={styles.footerButton}>
          <Button label={reconfiguring ? "Save" : "Add widget"} onPress={() => void save()} disabled={!card} loading={saving} stretch />
        </View>
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet((c) => ({
  screen: { flex: 1, backgroundColor: c.background },
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 4 },
  title: { fontSize: 22, fontWeight: "700", color: c.foreground },
  subtitle: { fontSize: 14, lineHeight: 20, color: c.mutedForeground },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 17, fontWeight: "600", color: c.foreground },
  emptyText: { fontSize: 14, lineHeight: 20, color: c.mutedForeground, textAlign: "center" },
  previewWell: {
    marginHorizontal: 20,
    height: PREVIEW_HEIGHT + 32,
    borderRadius: radius,
    backgroundColor: c.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  previewPlaceholder: { height: PREVIEW_HEIGHT, borderRadius: 20, backgroundColor: c.card, alignItems: "center", justifyContent: "center" },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingBottom: 16 },
  group: { borderRadius: radius, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10 },
  rowActive: { backgroundColor: c.accent },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: c.foreground },
  rowKind: { fontSize: 13, color: c.mutedForeground },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  radioActive: { backgroundColor: c.primary, borderColor: c.primary },
  footer: { flexDirection: "row", gap: 12, paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.background },
  footerButton: { flex: 1 },
}));
