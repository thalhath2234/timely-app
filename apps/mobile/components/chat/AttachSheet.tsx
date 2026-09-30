import { Text } from "react-native";
import {
  Camera,
  ClipboardPaste,
  FileImage,
  Images,
  ScanLine,
} from "lucide-react-native";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import { colors, createThemedStyleSheet } from "../../lib/theme";

export type ImageSource =
  | "camera"
  | "library"
  | "files"
  | "screenshot"
  | "clipboard";

const sources: { id: ImageSource; label: string; icon: typeof Camera }[] = [
  { id: "camera", label: "Take a photo", icon: Camera },
  { id: "library", label: "Photo library", icon: Images },
  { id: "files", label: "Image files", icon: FileImage },
  { id: "screenshot", label: "Capture current screen", icon: ScanLine },
  { id: "clipboard", label: "Paste image", icon: ClipboardPaste },
];

export default function AttachSheet({
  open,
  remaining,
  onClose,
  onPick,
}: {
  open: boolean;
  remaining: number;
  onClose: () => void;
  onPick: (source: ImageSource) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Attach image">
      <Text style={styles.hint}>
        {remaining} of 5 photos left for this message. JPEG or PNG, up to 10 MB.
        Uploads are temporary and expire after 24 hours.
      </Text>
      {sources.map(({ id, label, icon: Icon }) => (
        <SheetOption
          key={id}
          leading={<Icon size={20} color={colors.foreground} />}
          onSelect={() => {
            onClose();
            onPick(id);
          }}
        >
          {label}
        </SheetOption>
      ))}
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet(() => ({
  hint: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 19,
    paddingBottom: 12,
  },
}));
