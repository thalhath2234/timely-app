import { useState } from "react";
import { Text, View } from "react-native";
import { Eye, Lock, ShieldCheck, Zap, type LucideIcon } from "lucide-react-native";
import {
  ALWAYS_BLOCKED_NOTE,
  PERMISSION_COPY,
  type PermissionMode,
} from "@timely/contract/agentChat";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { permissionChip, permissionOptions, type PermissionChip as Chip } from "../../lib/chat/agentRun";
import AnimatedPressable from "../ui/AnimatedPressable";
import BottomSheet from "../ui/BottomSheet";
import { ListGroup, ListRow } from "../settings/SettingsList";

const ICONS: Record<Chip["icon"], LucideIcon> = { eye: Eye, shield: ShieldCheck, bolt: Zap };

/** The drawn tones: green Supervised, indigo (the accent) Auto, amber Full Access. */
export function permissionTone(tone: Chip["tone"]) {
  if (tone === "green") return { fg: colors.successText, wash: `${colors.success}1f` };
  if (tone === "amber") return { fg: colors.warningText, wash: `${colors.warning}1f`, edge: `${colors.warning}73` };
  return { fg: colors.primary, wash: `${colors.primary}1a` };
}

/** The chat header's permission chip (Main.dc.html): glyph and mode name, opening the picker. */
export function PermissionChip({ mode, onPress, disabled }: { mode: string | undefined; onPress: () => void; disabled?: boolean }) {
  const chip = permissionChip(mode);
  const tone = permissionTone(chip.tone);
  const Icon = ICONS[chip.icon];
  return (
    <AnimatedPressable
      testID="permission-chip"
      accessibilityRole="button"
      accessibilityLabel={chip.accessibilityLabel}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: tone.wash, borderColor: tone.edge ?? "transparent" }, disabled && { opacity: 0.5 }]}
    >
      <Icon size={14} color={tone.fg} strokeWidth={2.2} />
      <Text numberOfLines={1} style={[styles.chipText, { color: tone.fg }]}>
        {chip.label}
      </Text>
    </AnimatedPressable>
  );
}

/** The chip's look without its button, for a settings row's value. */
export function PermissionBadge({ mode }: { mode: string | undefined }) {
  const chip = permissionChip(mode);
  const tone = permissionTone(chip.tone);
  const Icon = ICONS[chip.icon];
  return (
    <View style={[styles.chip, styles.badge, { backgroundColor: tone.wash, borderColor: tone.edge ?? "transparent" }]}>
      <Icon size={12} color={tone.fg} strokeWidth={2.2} />
      <Text numberOfLines={1} style={[styles.chipText, { color: tone.fg }]}>
        {chip.label}
      </Text>
    </View>
  );
}

/** A mode's tile, name, line and radio, as one row of the picker. */
export function PermissionModeRow({
  mode,
  name,
  line,
  selected,
  disabled,
  onPress,
}: {
  mode: PermissionMode;
  name: string;
  line: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const chip = permissionChip(mode);
  const tone = permissionTone(chip.tone);
  const Icon = ICONS[chip.icon];
  return (
    <AnimatedPressable
      testID={`permission-${mode}`}
      accessibilityRole="radio"
      accessibilityLabel={`${name}, ${line}`}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.mode, selected && { backgroundColor: `${colors.primary}14` }]}
    >
      <View style={[styles.tile, { backgroundColor: tone.wash }, disabled && styles.dim]}>
        <Icon size={18} color={tone.fg} />
      </View>
      <View style={[styles.modeText, disabled && styles.dim]}>
        <Text style={styles.modeName}>{name}</Text>
        <Text style={styles.modeLine}>{line}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioOn, disabled && styles.dim]} />
    </AnimatedPressable>
  );
}

/** "Disk wipes and handing out your keys stay blocked in every mode." */
export function BlockedNote() {
  return (
    <View style={styles.note}>
      <Lock size={13} color={colors.mutedForeground} style={{ marginTop: 2 }} />
      <Text style={styles.noteText}>{ALWAYS_BLOCKED_NOTE}</Text>
    </View>
  );
}

/**
 * Permission for this chat (Option1PermissionsPhone.dc.html): the three modes
 * and the account's default for new chats. Full Access is shown but can't be
 * turned on here in phase 2: "Turn on from the desktop app".
 */
export default function PermissionSheet({
  open,
  onClose,
  value,
  defaultMode,
  onPick,
  onPickDefault,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  value: string | undefined;
  /** The account's mode for new chats; unknown while settings load. */
  defaultMode: PermissionMode | undefined;
  onPick: (mode: PermissionMode) => void;
  /** Unset when the server has no account settings (older API). */
  onPickDefault?: (mode: PermissionMode) => void;
  saving?: boolean;
}) {
  const [defaultOpen, setDefaultOpen] = useState(false);
  const defaultName = defaultMode ? PERMISSION_COPY[defaultMode].name : "";
  return (
    <BottomSheet
      open={open}
      onClose={() => {
        setDefaultOpen(false);
        onClose();
      }}
      title="Permission for this chat"
      subtitle={defaultName ? `New chats start on ${defaultName}` : undefined}
    >
      <View style={{ gap: 12 }}>
        <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel="Permission">
          {permissionOptions(value).map((option, index) => (
            <View key={option.mode}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <PermissionModeRow
                {...option}
                disabled={option.disabled || !!saving}
                onPress={() => {
                  if (!option.selected) onPick(option.mode);
                }}
              />
            </View>
          ))}
        </View>
        {onPickDefault && defaultMode ? (
          <ListGroup>
            <ListRow
              testID="permission-default"
              title="Default for new chats"
              trailing={defaultName}
              onPress={() => setDefaultOpen(true)}
            />
          </ListGroup>
        ) : null}
        <BlockedNote />
      </View>
      {onPickDefault && defaultMode ? (
        <BottomSheet open={defaultOpen} onClose={() => setDefaultOpen(false)} title="Default for new chats" subtitle="This chat keeps its own choice">
          <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel="Default for new chats">
            {permissionOptions(defaultMode).map((option, index) => (
              <View key={option.mode}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <PermissionModeRow
                  {...option}
                  onPress={() => {
                    if (!option.selected) onPickDefault(option.mode);
                    setDefaultOpen(false);
                  }}
                />
              </View>
            ))}
          </View>
        </BottomSheet>
      ) : null}
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  chip: {
    height: 28,
    paddingLeft: 9,
    paddingRight: 10,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    maxWidth: 130,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
  badge: { height: 24, paddingLeft: 8, paddingRight: 9, gap: 4 },
  group: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  divider: { height: 1, backgroundColor: colors.border },
  mode: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  tile: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modeText: { flex: 1, minWidth: 0, gap: 2 },
  modeName: { color: colors.foreground, fontSize: 15, fontWeight: "500", lineHeight: 20 },
  modeLine: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.borderStrong, marginTop: 9 },
  radioOn: { borderWidth: 5, borderColor: colors.primary },
  dim: { opacity: 0.5 },
  note: { flexDirection: "row", gap: 6, paddingHorizontal: 4 },
  noteText: { flex: 1, color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
}));
