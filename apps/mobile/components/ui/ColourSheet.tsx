import { useState } from "react";
import { Text, View } from "react-native";
import { Check, ChevronDown } from "lucide-react-native";
import BottomSheet, { SheetOption } from "./BottomSheet";
import AnimatedPressable from "./AnimatedPressable";
import { FieldLabel } from "./primitives";
import { ENTITY_COLORS, colorName } from "../../lib/entityColor";
import { colors, controlRadius, createThemedStyleSheet } from "../../lib/theme";

function sameColor(a?: string | null, b?: string | null) {
  return Boolean(a && b && a.trim().toUpperCase() === b.trim().toUpperCase());
}

function inPalette(color?: string | null) {
  return ENTITY_COLORS.some((entry) => sameColor(entry, color));
}

/**
 * Timely's colour picker on the phone: Auto (when the item has one), the
 * named palette as big swatches, and the item's own colour as "Custom" when
 * it was picked off the palette on the desktop. Picking closes the sheet.
 * Projects, stages, statuses, labels and field options all use it.
 */
export default function ColourSheet({
  open,
  onClose,
  value,
  onChange,
  title = "Colour",
  subtitle,
  autoColor,
}: {
  open: boolean;
  onClose: () => void;
  /** The current colour; "" means Auto. */
  value: string;
  onChange: (color: string) => void;
  title?: string;
  /** Defaults to the current colour's name. */
  subtitle?: string;
  /** Offer "Auto" (stored as ""), shown in this colour. */
  autoColor?: string;
}) {
  const custom = value.trim() && !inPalette(value) ? value.trim() : null;
  const pick = (color: string) => {
    onChange(color);
    onClose();
  };
  return (
    <BottomSheet open={open} onClose={onClose} title={title} subtitle={subtitle ?? colorName(value)}>
      {autoColor ? (
        <SheetOption selected={!value.trim()} leading={<View style={[styles.dot, { backgroundColor: autoColor }]} />} onSelect={() => pick("")}>
          Auto
        </SheetOption>
      ) : null}
      {custom ? (
        <SheetOption selected leading={<View style={[styles.dot, { backgroundColor: custom }]} />} onSelect={onClose}>
          Custom
        </SheetOption>
      ) : null}
      <View style={styles.swatches}>
        {ENTITY_COLORS.map((color) => {
          const selected = sameColor(value, color);
          return (
            <AnimatedPressable
              key={color}
              accessibilityRole="button"
              accessibilityLabel={colorName(color)}
              accessibilityState={{ selected }}
              onPress={() => pick(color)}
              style={styles.swatchCell}
              testID="colour-swatch"
            >
              <View style={[styles.swatchRing, selected && { borderColor: colors.foreground }]}>
                <View style={[styles.swatchBig, { backgroundColor: color }]}>
                  {selected ? <Check size={16} color="#ffffff" strokeWidth={3} /> : null}
                </View>
              </View>
              <Text numberOfLines={1} style={[styles.swatchName, selected && { color: colors.foreground }]}>
                {colorName(color)}
              </Text>
            </AnimatedPressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

/**
 * A form control for a colour, shaped like `Select`: the colour and its name
 * in a field box, opening `ColourSheet` (as a page when inside a sheet).
 */
export function ColourField({
  label = "Colour",
  value,
  onChange,
  subtitle,
}: {
  label?: string;
  value: string;
  onChange: (color: string) => void;
  /** Sheet subtitle, such as the item being coloured. */
  subtitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const name = colorName(value);
  return (
    <View style={styles.fieldWrap}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={`${label || "Colour"}, ${name}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={styles.trigger}
        testID="colour-field"
      >
        <View style={[styles.dot, { backgroundColor: value || colors.mutedForeground }]} />
        <Text style={styles.triggerValue} numberOfLines={1}>
          {name}
        </Text>
        <ChevronDown size={16} color={colors.mutedForeground} />
      </AnimatedPressable>
      <ColourSheet open={open} onClose={() => setOpen(false)} value={value} onChange={onChange} title={label || "Colour"} subtitle={subtitle} />
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  dot: { width: 16, height: 16, borderRadius: 8 },
  swatches: { flexDirection: "row", flexWrap: "wrap", rowGap: 12, paddingTop: 8, paddingBottom: 8 },
  swatchCell: { width: "25%", alignItems: "center", gap: 6 },
  swatchRing: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  swatchBig: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  swatchName: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500" },
  fieldWrap: { gap: 6 },
  trigger: {
    minHeight: 48,
    borderRadius: controlRadius + 2,
    borderWidth: 1,
    borderColor: colors.input,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  triggerValue: { flex: 1, color: colors.foreground, fontSize: 16 },
}));
