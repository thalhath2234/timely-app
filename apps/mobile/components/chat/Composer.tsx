import { Image, ScrollView, Text, TextInput, View } from "react-native";
import {
  ArrowUp,
  Globe2,
  ImagePlus,
  ScanLine,
  Square,
  Trash2,
  X,
} from "lucide-react-native";
import type { ChatContext, PendingImage } from "../../lib/chat/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import { chipIcon } from "./chatMeta";
import { Action, IconButton, styles as common } from "./shared";

export function ContextChips({
  chips,
  disabled,
  onRemove,
}: {
  chips: ChatContext[];
  disabled: boolean;
  onRemove: (index: number) => void;
}) {
  if (!chips.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 6, paddingHorizontal: 12 }}
    >
      {chips.map((chip, index) => {
        const Icon = chipIcon(chip.kind);
        return (
          <View key={`${chip.kind}:${chip.value}`} style={styles.chip}>
            <Icon size={12} color={colors.accentForeground} />
            <Text numberOfLines={1} style={styles.chipText}>
              {chip.label}
            </Text>
            <AnimatedPressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${chip.label} context`}
              hitSlop={8}
              disabled={disabled}
              onPress={() => onRemove(index)}
              style={[styles.chipRemove, disabled && { opacity: 0.4 }]}
            >
              <X size={12} color={colors.accentForeground} />
            </AnimatedPressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

export default function Composer({
  text,
  onChangeText,
  placeholder,
  chips,
  onRemoveChip,
  onAddScreen,
  canConfigure,
  images,
  onPreview,
  onRemoveImage,
  onAttach,
  search,
  onToggleSearch,
  privateImages,
  busy,
  pending,
  uploading,
  offline,
  editable,
  onSend,
  onStop,
  hasDraft,
  onDiscardDraft,
  otherDraft,
  onReturnDraft,
}: {
  text: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  chips: ChatContext[];
  onRemoveChip: (index: number) => void;
  onAddScreen: () => void;
  canConfigure: boolean;
  images: PendingImage[];
  onPreview: (uri: string) => void;
  onRemoveImage: (image: PendingImage) => void;
  onAttach: () => void;
  search: boolean;
  onToggleSearch: () => void;
  privateImages: boolean;
  busy: boolean;
  pending: boolean;
  uploading: boolean;
  offline: boolean;
  editable: boolean;
  onSend: () => void;
  onStop: () => void;
  hasDraft: boolean;
  onDiscardDraft: () => void;
  otherDraft: boolean;
  onReturnDraft: () => void;
}) {
  if (otherDraft)
    return (
      <View style={styles.wrap}>
        <View style={styles.draftBanner}>
          <Text style={common.text}>
            You have an unsent draft in another conversation.
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Action
                label="Open draft"
                primary
                compact
                onPress={onReturnDraft}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Action
                label="Discard draft"
                compact
                tone="destructive"
                onPress={onDiscardDraft}
              />
            </View>
          </View>
        </View>
      </View>
    );
  const canSend =
    (text.trim() || images.length) &&
    !pending &&
    !uploading &&
    !busy &&
    !offline;
  const searchOn = search && !privateImages;
  return (
    <View style={styles.wrap}>
      <ContextChips
        chips={chips}
        disabled={!canConfigure}
        onRemove={onRemoveChip}
      />
      {images.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            gap: 10,
            paddingHorizontal: 12,
            paddingTop: 8,
          }}
        >
          {images.map((image) => (
            <View key={image.uri}>
              <AnimatedPressable
                accessibilityRole="imagebutton"
                accessibilityLabel={`Preview ${image.name}`}
                onPress={() => onPreview(image.uri)}
              >
                <Image source={{ uri: image.uri }} style={styles.thumb} />
              </AnimatedPressable>
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${image.name}`}
                hitSlop={6}
                disabled={pending}
                onPress={() => onRemoveImage(image)}
                style={styles.thumbRemove}
              >
                <X size={12} color={colors.foreground} />
              </AnimatedPressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.box}>
        <TextInput
          accessibilityLabel="Message the assistant"
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          value={text}
          editable={editable}
          onChangeText={onChangeText}
          multiline
          maxLength={16000}
          selectionColor={colors.primary}
          style={styles.input}
        />
        <View style={styles.toolbar}>
          <View style={styles.tools}>
            <IconButton
              label="Attach image"
              plain
              disabled={pending || busy || images.length >= 5}
              onPress={onAttach}
            >
              <ImagePlus size={20} color={colors.mutedForeground} />
            </IconButton>
            <IconButton
              label="Add current screen as context"
              plain
              disabled={!canConfigure}
              onPress={onAddScreen}
            >
              <ScanLine size={20} color={colors.mutedForeground} />
            </IconButton>
            <AnimatedPressable
              accessibilityRole="switch"
              accessibilityLabel={
                privateImages ? "Private image chat" : "Web search"
              }
              accessibilityState={{
                checked: searchOn,
                disabled: !canConfigure || privateImages,
              }}
              disabled={!canConfigure || privateImages}
              onPress={onToggleSearch}
              style={[
                styles.searchToggle,
                searchOn && styles.searchOn,
                (!canConfigure || privateImages) && { opacity: 0.5 },
              ]}
            >
              <Globe2
                size={16}
                color={searchOn ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.searchText,
                  searchOn && { color: colors.primary },
                ]}
              >
                {privateImages ? "Private" : "Search"}
              </Text>
            </AnimatedPressable>
          </View>
          <View style={styles.tools}>
            {hasDraft && !busy ? (
              <IconButton
                label="Discard draft"
                plain
                disabled={pending}
                onPress={onDiscardDraft}
              >
                <Trash2 size={18} color={colors.mutedForeground} />
              </IconButton>
            ) : null}
            {busy ? (
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel="Stop run"
                disabled={pending || offline}
                onPress={onStop}
                style={[
                  styles.send,
                  styles.stop,
                  (pending || offline) && { opacity: 0.4 },
                ]}
              >
                <Square
                  size={16}
                  color={colors.foreground}
                  fill={colors.foreground}
                />
              </AnimatedPressable>
            ) : (
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel={
                  images.length && !text.trim()
                    ? "Read receipt"
                    : "Send message"
                }
                disabled={!canSend}
                onPress={onSend}
                style={[styles.send, !canSend && { opacity: 0.35 }]}
              >
                <ArrowUp
                  size={20}
                  color={colors.primaryForeground}
                  strokeWidth={2.5}
                />
              </AnimatedPressable>
            )}
          </View>
        </View>
      </View>
      <Text style={styles.hint}>
        {uploading
          ? "Uploading image…"
          : offline
            ? "Reconnect to send messages or apply changes."
            : images.length
              ? "One receipt per message · up to 5 photos · removed after saving or 24 hours"
              : privateImages
                ? "Image-based changes always need your review."
                : "Simple changes happen directly. Larger changes are yours to review."}
      </Text>
    </View>
  );
}

const styles = createThemedStyleSheet(() => ({
  wrap: {
    paddingTop: 8,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 220,
    borderRadius: 10,
    backgroundColor: colors.accent,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 4,
  },
  chipText: {
    color: colors.accentForeground,
    fontSize: 12,
    fontWeight: "700",
    flexShrink: 1,
  },
  chipRemove: { padding: 4, borderRadius: 8 },
  thumb: {
    width: 68,
    height: 68,
    borderRadius: 14,
    backgroundColor: colors.muted,
  },
  thumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  box: {
    marginHorizontal: 12,
    borderRadius: 22,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 6,
  },
  input: {
    minHeight: 44,
    maxHeight: 140,
    color: colors.foreground,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    textAlignVertical: "top",
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tools: { flexDirection: "row", alignItems: "center", gap: 2 },
  searchToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 34,
    borderRadius: 12,
    paddingHorizontal: 10,
  },
  searchOn: { backgroundColor: colors.accent },
  searchText: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: "700",
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  stop: { backgroundColor: colors.muted },
  hint: {
    color: colors.mutedForeground,
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
    paddingHorizontal: 16,
  },
  draftBanner: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
}));
