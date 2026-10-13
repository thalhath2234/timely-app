import { Text, View } from "react-native";
import type { DocContent } from "../../lib/types";
import { createThemedStyleSheet } from "../../lib/theme";
import RichTextEditor from "./RichTextEditor";
import type { WriteContext } from "./HelpMeWriteSheet";

/** The description box on the task and project screens: one card like the
 * title card above it, with the editor inside and its toolbar as the card's
 * footer. Changes save on their own (the screen autosaves), like the desktop. */
export default function DescriptionCard({
  content,
  syncKey,
  placeholder,
  onChange,
  onSelectionChange,
  writeContext,
}: {
  content: DocContent;
  syncKey: number;
  placeholder: string;
  onChange: (value: { content: DocContent; plainText: string }) => void;
  onSelectionChange?: (text: string) => void;
  /** Help me write drafts for this task or project. */
  writeContext?: WriteContext;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>DESCRIPTION</Text>
      <RichTextEditor compact content={content} syncKey={syncKey} placeholder={placeholder} onChange={onChange} onSelectionChange={onSelectionChange} writeContext={writeContext} />
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: {
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingTop: 16,
    paddingHorizontal: 16,
    overflow: "hidden",
  },
  eyebrow: { color: colors.mutedForeground, fontSize: 11, fontWeight: "600", letterSpacing: 0.9 },
}));
