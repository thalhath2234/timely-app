import { Text, View } from "react-native";
import { FileText } from "lucide-react-native";
import type { DocContent } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { PrimaryButton } from "../ui/primitives";
import RichTextEditor from "./RichTextEditor";

export default function DescriptionCard({
  content,
  syncKey,
  placeholder,
  onChange,
  onSelectionChange,
  onSave,
}: {
  content: DocContent;
  syncKey: number;
  placeholder: string;
  onChange: (value: { content: DocContent; plainText: string }) => void;
  onSave: () => void;
  onSelectionChange?: (text: string) => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <View style={styles.icon}><FileText size={18} color={colors.accentForeground} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Description</Text>
          <Text style={styles.caption}>Details, links, and rich text</Text>
        </View>
      </View>
      <RichTextEditor compact content={content} syncKey={syncKey} placeholder={placeholder} onChange={onChange} onSelectionChange={onSelectionChange} />
      <PrimaryButton label="Save description" onPress={onSave} />
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: { gap: 14, borderRadius: 24, backgroundColor: colors.card, padding: 16 },
  heading: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  title: { color: colors.foreground, fontSize: 17, fontWeight: "700" },
  caption: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
}));
