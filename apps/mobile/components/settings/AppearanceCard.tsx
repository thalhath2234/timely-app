import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Monitor, Moon, Sun } from "lucide-react-native";
import { Field } from "../ui/primitives";
import AnimatedPressable from "../ui/AnimatedPressable";
import { useUpdateAppearance } from "../../lib/hooks";
import {
  ACCENT_PRESETS,
  applyAccountAppearance,
  colors,
  createThemedStyleSheet,
  DEFAULT_ACCENT_HEX,
  getAccentPreference,
  getThemePreference,
  normalizeHex,
  type AccentPreference,
  type ThemePreference,
} from "../../lib/theme";

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export default function AppearanceCard() {
  const update = useUpdateAppearance();
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const [accent, setAccent] = useState<AccentPreference>(getAccentPreference);
  const [hexDraft, setHexDraft] = useState<string>(accent === "default" ? DEFAULT_ACCENT_HEX : accent);
  const [busy, setBusy] = useState(false);

  async function save(nextTheme: ThemePreference, nextAccent: AccentPreference) {
    if (busy) return;
    setTheme(nextTheme);
    setAccent(nextAccent);
    if (nextAccent !== "default") setHexDraft(nextAccent);
    setBusy(true);
    try {
      await applyAccountAppearance({ theme: nextTheme, accent: nextAccent });
      await update.mutateAsync({ theme: nextTheme, accent: nextAccent });
    } catch {
      setTheme(getThemePreference());
      setAccent(getAccentPreference());
      Alert.alert("Appearance not saved", "Timely could not update the account theme.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View accessibilityLabel="Appearance" style={styles.card}>
      <Text style={styles.title}>Appearance</Text>
      <Text style={styles.meta}>Light, dark, and accent follow this account on every device.</Text>
      <View style={styles.themeOptions}>
        {THEME_OPTIONS.map((option) => {
          const selected = theme === option.value;
          const Icon = option.icon;
          return (
            <AnimatedPressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={`${option.label} theme`}
              accessibilityState={{ selected, disabled: busy }}
              disabled={busy}
              onPress={() => void save(option.value, accent)}
              style={[styles.themeOption, selected && styles.themeOptionSelected]}
            >
              <Icon size={16} color={selected ? colors.primaryForeground : colors.mutedForeground} />
              <Text style={[styles.themeOptionText, selected && styles.themeOptionTextSelected]}>{option.label}</Text>
            </AnimatedPressable>
          );
        })}
      </View>
      <Text style={styles.section}>Accent</Text>
      <View style={styles.swatches}>
        {ACCENT_PRESETS.map((preset) => {
          const selected = accent === preset.id;
          return (
            <AnimatedPressable
              key={preset.id}
              accessibilityRole="button"
              accessibilityLabel={preset.label}
              accessibilityState={{ selected, disabled: busy }}
              disabled={busy}
              onPress={() => void save(theme, preset.id)}
              style={[styles.swatch, { backgroundColor: preset.hex }, selected && styles.swatchSelected]}
            />
          );
        })}
      </View>
      <Field
        value={hexDraft}
        onChangeText={setHexDraft}
        placeholder="#6E56CF"
        autoCapitalize="none"
      />
      <AnimatedPressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          const next = normalizeHex(hexDraft);
          if (!next) {
            Alert.alert("Invalid color", "Use a 3- or 6-digit hex color, like #6E56CF.");
            return;
          }
          void save(theme, next);
        }}
        style={styles.hexButton}
      >
        <Text style={styles.hexButtonText}>Use custom hex</Text>
      </AnimatedPressable>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
    marginBottom: 8,
    gap: 8,
  },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  section: { color: colors.foreground, fontSize: 13, fontWeight: "600", marginTop: 6 },
  themeOptions: { flexDirection: "row", gap: 8, marginTop: 6 },
  themeOption: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  themeOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  themeOptionText: { color: colors.mutedForeground, fontSize: 13, fontWeight: "600" },
  themeOptionTextSelected: { color: colors.primaryForeground },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "transparent" },
  swatchSelected: { borderColor: colors.foreground },
  hexButton: { alignSelf: "flex-start", paddingVertical: 6 },
  hexButtonText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
}));
