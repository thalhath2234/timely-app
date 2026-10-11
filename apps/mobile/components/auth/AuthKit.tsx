import { useEffect, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { Eye, EyeOff } from "lucide-react-native";
import AnimatedPressable from "../ui/AnimatedPressable";
import TimelyLogo, { LogoSpinner } from "../ui/TimelyLogo";
import { blockStart, clock, dateLine, minuteOfDay, type DayBlock } from "../../lib/authDay";
import { listEntering, pageEntering } from "../../lib/motion";

/**
 * Sign-in, sign-up and onboarding continue the landing page, so they are
 * always dark, whatever the app theme. Values mirror the web's `.lp` tokens
 * in `apps/web/app/_components/site/site.css`.
 */
export const AUTH = {
  bg: "#0d0e13",
  surface: "#14161d",
  line: "rgba(236,235,245,0.08)",
  lineStrong: "rgba(236,235,245,0.14)",
  ink: "#ecebf5",
  soft: "#a3a2b6",
  faint: "#85849a",
  now: "#c0c1ff",
  nowInk: "#1000a9",
  error: "#ff8a80",
  green: "#30a66d",
  display: "ArchivoCondensed",
  mono: "SpaceMono",
} as const;

/** `hex` mixed into the dark surface, like CSS `color-mix(in srgb, hex amount, base)`. */
export function tint(hex: string, amount: number, base: string = AUTH.bg) {
  const parse = (value: string) => {
    const clean = value.replace("#", "");
    return [0, 2, 4].map((offset) => parseInt(clean.slice(offset, offset + 2), 16));
  };
  const [r1, g1, b1] = parse(hex);
  const [r2, g2, b2] = parse(base);
  const mix = (a: number, b: number) => Math.round(a * amount + b * (1 - amount));
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
}

/** The current time, refreshed every 15 seconds. */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The block the person is in now: "10:05–10:10 Sign in". */
export function NowBlock({ label, color = AUTH.now, minutes = 5 }: { label: string; color?: string; minutes?: number }) {
  const start = minuteOfDay(useNow());
  return (
    <View style={[styles.nowBlock, { borderLeftColor: color, backgroundColor: tint(color, 0.16) }]}>
      <Text style={styles.nowTime}>
        {clock(start)}–{clock(start + minutes)}
      </Text>
      <Text style={styles.nowLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Frame for the auth screens: wordmark, the landing page's date line, the
 * now block, a condensed headline and the content below it.
 */
export function AuthScreen({
  block,
  title,
  lead,
  headerAction,
  contentKey,
  children,
}: {
  block: ReactNode;
  title: string;
  lead?: string;
  headerAction?: ReactNode;
  /** Change it (a step id) to replay the entrance. */
  contentKey?: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const now = useNow();
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.wordmark}>
              <TimelyLogo size={24} ink={AUTH.ink} accent={AUTH.now} />
              <Text style={styles.wordmarkText}>Timely</Text>
            </View>
            {headerAction}
          </View>
          <View style={styles.dateRow}>
            <Text style={styles.dateText}>{dateLine(now).toUpperCase()}</Text>
          </View>
          <Animated.View key={contentKey} entering={pageEntering(reduceMotion)} style={styles.content}>
            {block}
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            {lead ? <Text style={styles.lead}>{lead}</Text> : null}
            <View style={styles.body}>{children}</View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type FieldProps = Omit<TextInputProps, "style" | "placeholderTextColor"> & {
  label: string;
  hint?: string;
  error?: string;
  secure?: boolean;
};

/** A labelled field; `secure` adds a show/hide button. */
export function AuthField({ label, hint, error, secure, onFocus, onBlur, ...input }: FieldProps) {
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.field, focused && styles.fieldFocused, error ? styles.fieldInvalid : null]}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={AUTH.faint}
          secureTextEntry={secure && !shown}
          autoCorrect={false}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={styles.input}
          {...input}
        />
        {secure ? (
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={shown ? "Hide password" : "Show password"}
            onPress={() => setShown((value) => !value)}
            style={styles.eye}
          >
            {shown ? <EyeOff size={18} color={AUTH.soft} /> : <Eye size={18} color={AUTH.soft} />}
          </AnimatedPressable>
        ) : null}
      </View>
      {error || hint ? <Text style={[styles.hint, error ? { color: AUTH.error } : null]}>{error ?? hint}</Text> : null}
    </View>
  );
}

/** Primary (lavender) or ghost button. */
export function AuthButton({
  label,
  onPress,
  disabled,
  pending,
  variant = "primary",
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  pending?: boolean;
  variant?: "primary" | "ghost";
  testID?: string;
}) {
  const primary = variant === "primary";
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(pending) }}
      onPress={onPress}
      disabled={disabled}
      wrapStyle={{ alignSelf: "stretch" }}
      style={[primary ? styles.primary : styles.ghost, disabled && { opacity: 0.5 }]}
    >
      {pending ? <LogoSpinner size={18} color={primary ? AUTH.nowInk : AUTH.ink} /> : null}
      <Text style={primary ? styles.primaryText : styles.ghostText}>{label}</Text>
    </AnimatedPressable>
  );
}

/** A quiet text button ("Skip for now", "Back"). */
export function AuthLink({ label, onPress, disabled, tone = "soft" }: { label: string; onPress: () => void; disabled?: boolean; tone?: "soft" | "now" }) {
  return (
    <AnimatedPressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={styles.link}>
      <Text style={[styles.linkText, tone === "now" && { color: AUTH.now, fontWeight: "600" }]}>{label}</Text>
    </AnimatedPressable>
  );
}

/** An error or confirmation, drawn as a red or green block. */
export function AuthNotice({ tone = "error", children }: { tone?: "error" | "success"; children: string }) {
  const color = tone === "error" ? AUTH.error : AUTH.green;
  return (
    <View
      accessibilityRole={tone === "error" ? "alert" : "text"}
      accessibilityLiveRegion="polite"
      style={[styles.notice, { borderLeftColor: color, backgroundColor: tint(color, 0.13) }]}
    >
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

/** A toggle chip; picked chips become small calendar blocks. */
export function ChoiceChip({
  label,
  pressed,
  onPress,
  color,
  off,
}: {
  label: string;
  pressed: boolean;
  onPress: () => void;
  color?: string;
  off?: boolean;
}) {
  const accent = color ?? AUTH.now;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected: pressed }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.chip,
        pressed && { borderColor: "transparent", borderLeftColor: accent, borderLeftWidth: 3, backgroundColor: tint(accent, 0.18) },
        off && styles.chipOff,
      ]}
    >
      {color ? <View style={[styles.dot, { backgroundColor: color, opacity: off ? 0.35 : 1 }]} /> : null}
      <Text style={[styles.chipText, pressed && { color: AUTH.ink }, off && { color: AUTH.faint }]}>{label}</Text>
    </AnimatedPressable>
  );
}

/** A compact list of today's blocks: the phone version of the web's day panel. */
export function DayPreview({ title, tabs, blocks, empty }: { title: string; tabs?: string[]; blocks: DayBlock[]; empty?: string }) {
  const reduceMotion = useReducedMotion();
  const now = minuteOfDay(useNow());
  return (
    <View style={styles.day} accessibilityLabel="Preview of your day">
      <View style={styles.dayHeader}>
        <Text style={styles.dayTitle}>{title}</Text>
        {tabs?.length ? (
          <View style={styles.tabs}>
            {tabs.map((tab, index) => (
              <Text key={tab} numberOfLines={1} style={[styles.tab, index === 0 && styles.tabOn]}>
                {tab}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.dayBody}>
        {blocks.length === 0 && empty ? <Text style={styles.dayEmpty}>{empty}</Text> : null}
        {blocks.map((block, index) => {
          const start = blockStart(block, now);
          return (
            <Animated.View
              key={block.id}
              entering={listEntering(index, reduceMotion)}
              style={[
                styles.dayBlock,
                { borderLeftColor: block.color, backgroundColor: tint(block.color, 0.17, AUTH.surface) },
                block.now && { borderWidth: 1, borderColor: block.color, borderLeftWidth: 3 },
              ]}
            >
              <View style={styles.dayBlockTop}>
                <Text style={styles.dayBlockTitle} numberOfLines={1}>
                  {block.title}
                </Text>
                <Text style={styles.dayBlockTime}>
                  {clock(start)}–{clock(start + block.length)}
                </Text>
              </View>
              {block.tag ? (
                <View style={styles.tag}>
                  <View style={[styles.dot, { backgroundColor: block.tag.color }]} />
                  <Text style={styles.tagText}>{block.tag.name}</Text>
                </View>
              ) : null}
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

/** A sentence-case section label ("Starter labels"). */
export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.section}>{children}</Text>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: AUTH.bg },
  scroll: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 24 },
  header: { height: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  wordmark: { flexDirection: "row", alignItems: "center", gap: 8 },
  wordmarkText: { color: AUTH.ink, fontSize: 19, fontWeight: "600", letterSpacing: -0.5 },
  dateRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AUTH.lineStrong, paddingBottom: 10, marginTop: 4 },
  dateText: { color: AUTH.soft, fontFamily: AUTH.mono, fontSize: 11, letterSpacing: 0.4 },
  content: { paddingTop: 24 },
  nowBlock: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingVertical: 4,
    paddingLeft: 8,
    paddingRight: 10,
    maxWidth: "100%",
  },
  nowTime: { color: AUTH.soft, fontFamily: AUTH.mono, fontSize: 11 },
  nowLabel: { color: AUTH.ink, fontSize: 12, fontWeight: "700", flexShrink: 1 },
  title: { color: AUTH.ink, fontFamily: AUTH.display, fontSize: 42, lineHeight: 42, marginTop: 16, letterSpacing: -0.4 },
  lead: { color: AUTH.soft, fontSize: 15, lineHeight: 23, marginTop: 12 },
  body: { marginTop: 24, gap: 14 },
  fieldWrap: { gap: 6 },
  fieldLabel: { color: AUTH.soft, fontSize: 13, fontWeight: "500" },
  field: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(236,235,245,0.12)",
    borderRadius: 10,
    backgroundColor: AUTH.surface,
  },
  fieldFocused: { borderColor: AUTH.now },
  fieldInvalid: { borderColor: AUTH.error },
  input: { flex: 1, minHeight: 46, paddingHorizontal: 14, color: AUTH.ink, fontSize: 16 },
  eye: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hint: { color: AUTH.soft, fontSize: 12 },
  primary: {
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: AUTH.now,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
  },
  primaryText: { color: AUTH.nowInk, fontSize: 16, fontWeight: "600" },
  ghost: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: AUTH.lineStrong,
    backgroundColor: AUTH.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
  },
  ghostText: { color: AUTH.ink, fontSize: 15, fontWeight: "600" },
  link: { alignSelf: "center", paddingVertical: 10, paddingHorizontal: 12 },
  linkText: { color: AUTH.soft, fontSize: 14 },
  notice: { borderLeftWidth: 3, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 12 },
  noticeText: { color: AUTH.ink, fontSize: 14, lineHeight: 20 },
  chip: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: "rgba(236,235,245,0.12)",
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  chipOff: { borderStyle: "dashed" },
  chipText: { color: AUTH.soft, fontSize: 14 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  section: { color: AUTH.soft, fontSize: 13, fontWeight: "500", marginTop: 8 },
  day: { borderWidth: 1, borderColor: AUTH.line, borderRadius: 14, backgroundColor: AUTH.surface, overflow: "hidden" },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AUTH.lineStrong,
  },
  dayTitle: { color: AUTH.ink, fontSize: 14, fontWeight: "600" },
  tabs: { flexDirection: "row", gap: 4, flexShrink: 1 },
  tab: {
    color: AUTH.soft,
    fontSize: 12,
    borderWidth: 1,
    borderColor: AUTH.line,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    overflow: "hidden",
  },
  tabOn: { color: AUTH.ink, borderColor: "transparent", backgroundColor: tint(AUTH.now, 0.18, AUTH.surface) },
  dayBody: { padding: 10, gap: 6 },
  dayEmpty: { color: AUTH.soft, fontSize: 13, paddingVertical: 6, paddingHorizontal: 4 },
  dayBlock: { borderLeftWidth: 3, borderRadius: 6, paddingVertical: 7, paddingHorizontal: 10, gap: 5 },
  dayBlockTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  dayBlockTitle: { flex: 1, color: AUTH.ink, fontSize: 13, fontWeight: "600" },
  dayBlockTime: { color: AUTH.soft, fontFamily: AUTH.mono, fontSize: 10.5 },
  tag: { flexDirection: "row", alignItems: "center", gap: 6 },
  tagText: { color: AUTH.soft, fontSize: 11 },
});
