import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FileText, MoreHorizontal, Smile, Star, Trash2 } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import EmptyState from "../../../components/ui/EmptyState";
import RichTextEditor from "../../../components/editor/RichTextEditor";
import { useDeleteDoc, useDocQuery, useDocWatch, useDocsQuery, useUpdateDoc, useWorkspacesQuery } from "../../../lib/hooks";
import { saveStatusLabel, useAutosave } from "../../../lib/autosave";
import { resolveDocContent } from "../../../lib/markdown";
import { isRichContentEmpty } from "../../../lib/richText";
import type { UpdateDocPayload } from "../../../lib/api/docs";
import type { DocContent } from "../../../lib/types";
import { colors } from "../../../lib/theme";

const ICON_CHOICES = ["📄", "📝", "📌", "📊", "🗂️", "💡", "🚀", "🎯", "🐛", "🧪", "📚", "🔧", "🔥", "✅", "⭐", "🧠"];

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export default function DocDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const docQ = useDocQuery(id);

  if (!docQ.isFetchedAfterMount || docQ.isLoading) {
    return (
      <Screen>
        <MobileHeader title="Doc" back large={false} />
        <EmptyState icon={FileText} title="Opening doc" description="Fetching the latest page…" />
      </Screen>
    );
  }

  if (docQ.isError || !docQ.data) {
    return (
      <Screen>
        <MobileHeader title="Doc" back large={false} />
        <EmptyState icon={FileText} title="Doc not found" description="It may have been deleted." />
      </Screen>
    );
  }

  return <DocEditor key={docQ.data.id} docId={docQ.data.id} />;
}

function DocEditor({ docId }: { docId: string }) {
  const router = useRouter();
  const doc = useDocQuery(docId).data;
  const docs = useDocsQuery().data ?? [];
  const spaces = useWorkspacesQuery().data ?? [];
  const updateDoc = useUpdateDoc();
  const remove = useDeleteDoc();

  const [remoteEpoch, setRemoteEpoch] = useState(0);
  const [remoteContent, setRemoteContent] = useState<DocContent | null>(null);
  const lastSavedAtRef = useRef<string | null>(doc?.updatedAt ?? null);
  const editorFocusedRef = useRef(false);

  const seedContent = useMemo(
    () => (doc ? resolveDocContent(doc.content, doc.plainText) : { type: "doc", content: [] }),
    [doc?.id],
  );

  const [title, setTitle] = useState(doc?.title ?? "");
  const [icon, setIcon] = useState(doc?.icon ?? "");
  const [favorite, setFavorite] = useState(Boolean(doc?.isFavorite));
  const [wordCount, setWordCount] = useState(() => countWords(doc?.plainText ?? ""));
  const [menu, setMenu] = useState<"more" | "icon" | "parent" | "delete" | null>(null);

  const { schedule, flush, status, hasUnsavedChanges } = useAutosave<UpdateDocPayload>(async (patch) => {
    const saved = await updateDoc.mutateAsync({ id: docId, data: patch });
    lastSavedAtRef.current = saved.updatedAt;
    return saved;
  });

  useDocWatch(docId, {
    lastSavedAtRef,
    hasLocalEdits: hasUnsavedChanges,
    isEditorFocused: () => editorFocusedRef.current,
    onRemote: () => setRemoteEpoch((epoch) => epoch + 1),
    onDeleted: () => router.replace("/(app)/(tabs)/docs"),
  });

  useEffect(() => {
    if (remoteEpoch === 0 || !doc) return;
    setTitle(doc.title);
    setIcon(doc.icon ?? "");
    setFavorite(Boolean(doc.isFavorite));
    setWordCount(countWords(doc.plainText));
    setRemoteContent(resolveDocContent(doc.content, doc.plainText));
  }, [remoteEpoch, doc?.title, doc?.icon, doc?.isFavorite, doc?.plainText, doc?.content]);

  if (!doc) return null;

  const workspace = spaces.find((w) => w.id === doc.workspaceId);
  const parents = docs.filter((d) => d.id !== docId && d.workspaceId === doc.workspaceId);
  const parentTitle = docs.find((d) => d.id === doc.parentId)?.title || "None";

  return (
    <Screen>
      <MobileHeader
        title={workspace?.name || "Doc"}
        subtitle={saveStatusLabel(status) || undefined}
        back
        large={false}
        actions={
          <>
            <HeaderIconButton
              label={favorite ? "Remove from favorites" : "Add to favorites"}
              active={favorite}
              onPress={() => {
                setFavorite(!favorite);
                schedule({ isFavorite: !favorite });
              }}
            >
              <Star size={20} color={favorite ? colors.warning : colors.mutedForeground} fill={favorite ? colors.warning : "transparent"} />
            </HeaderIconButton>
            <HeaderIconButton label="More" onPress={() => setMenu("more")}>
              <MoreHorizontal size={22} color={colors.foreground} />
            </HeaderIconButton>
          </>
        }
      />

      <View style={styles.head}>
        <Pressable accessibilityLabel="Change icon" onPress={() => setMenu("icon")} style={styles.iconBtn}>
          {icon ? <Text style={styles.icon}>{icon}</Text> : <Smile size={22} color={colors.mutedForeground} />}
        </Pressable>
        <TextInput
          value={title}
          placeholder="Untitled"
          placeholderTextColor={colors.mutedForeground}
          onChangeText={(next) => {
            setTitle(next);
            schedule({ title: next });
          }}
          onBlur={() => void flush()}
          style={styles.title}
        />
      </View>
      <Text style={styles.words}>
        {wordCount} {wordCount === 1 ? "word" : "words"}
      </Text>

      <RichTextEditor
        content={
          isRichContentEmpty(remoteContent ?? seedContent)
            ? { type: "doc", content: [{ type: "paragraph" }] }
            : (remoteContent ?? seedContent)
        }
        onFocusChange={(focused) => {
          editorFocusedRef.current = focused;
        }}
        onChange={({ content, plainText }) => {
          setWordCount(countWords(plainText));
          schedule({ content, plainText });
        }}
      />

      <BottomSheet open={menu === "more"} onClose={() => setMenu(null)} title="Doc">
        <SheetOption onSelect={() => setMenu("icon")} leading={<Smile size={18} color={colors.mutedForeground} />}>
          Change icon
        </SheetOption>
        <SheetOption onSelect={() => setMenu("parent")}>
          Parent page: {parentTitle}
        </SheetOption>
        <SheetOption
          onSelect={() => setMenu("delete")}
          leading={<Trash2 size={18} color={colors.destructive} />}
        >
          <Text style={{ color: colors.destructive }}>Delete doc</Text>
        </SheetOption>
      </BottomSheet>

      <BottomSheet open={menu === "icon"} onClose={() => setMenu(null)} title="Icon">
        <View style={styles.icons}>
          {ICON_CHOICES.map((choice) => (
            <Pressable
              key={choice}
              onPress={() => {
                setIcon(choice);
                schedule({ icon: choice });
                setMenu(null);
              }}
              style={[styles.iconPick, choice === icon && styles.iconOn]}
            >
              <Text style={styles.icon}>{choice}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={() => {
            setIcon("");
            schedule({ icon: "" });
            setMenu(null);
          }}
          style={styles.removeIcon}
        >
          <Text style={styles.removeIconText}>Remove icon</Text>
        </Pressable>
      </BottomSheet>

      <BottomSheet open={menu === "parent"} onClose={() => setMenu(null)} title="Parent page">
        <SheetOption
          selected={!doc.parentId}
          onSelect={() => {
            schedule({ parentId: null });
            setMenu(null);
          }}
        >
          Top level
        </SheetOption>
        {parents.map((p) => (
          <SheetOption
            key={p.id}
            selected={doc.parentId === p.id}
            onSelect={() => {
              schedule({ parentId: p.id });
              setMenu(null);
            }}
          >
            {p.title || "Untitled"}
          </SheetOption>
        ))}
      </BottomSheet>

      <BottomSheet open={menu === "delete"} onClose={() => setMenu(null)} title="Delete this doc?">
        <Text style={styles.warn}>The doc and all of its subpages will be removed.</Text>
        <Pressable
          onPress={() =>
            Alert.alert("Delete doc", "This cannot be undone.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => remove.mutate(docId, { onSuccess: () => router.replace("/(app)/(tabs)/docs") }),
              },
            ])
          }
          style={styles.delete}
        >
          <Trash2 size={16} color={colors.destructive} />
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 20, paddingTop: 16 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: { fontSize: 26, lineHeight: 32 },
  title: { flex: 1, color: colors.foreground, fontSize: 24, fontWeight: "600", paddingTop: 6 },
  words: { color: colors.mutedForeground, fontSize: 12, paddingHorizontal: 20, marginTop: 8, marginBottom: 8 },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 4 },
  iconPick: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  iconOn: { backgroundColor: colors.accent },
  removeIcon: {
    marginTop: 12,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  removeIconText: { color: colors.foreground, fontWeight: "500" },
  warn: { color: colors.mutedForeground, fontSize: 14, paddingHorizontal: 4, paddingBottom: 12 },
  delete: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, paddingVertical: 16 },
  deleteText: { color: colors.destructive, fontWeight: "600" },
});
