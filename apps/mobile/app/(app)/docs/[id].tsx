import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { contextChip } from "../../../lib/chat/context";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Archive, Download, FileText, FolderUp, History, Link2, MoreHorizontal, Smile, Star, TextSearch, Trash2, Upload } from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import ConfirmSheet from "../../../components/ui/ConfirmSheet";
import EmptyState from "../../../components/ui/EmptyState";
import RichTextEditor from "../../../components/editor/RichTextEditor";
import { useCreateDoc, useDeleteDoc, useDocBacklinksQuery, useDocQuery, useDocWatch, useDocsQuery, useUpdateDoc, useWorkspacesQuery } from "../../../lib/hooks";
import { saveStatusLabel, useAutosave, useUnsavedLeaveGuard } from "../../../lib/autosave";
import { showUndoToast } from "../../../lib/toast";
import { fromMarkdown, resolveDocContent } from "../../../lib/markdown";
import { isRichContentEmpty } from "../../../lib/richText";
import type { UpdateDocPayload } from "../../../lib/api/docs";
import type { DocContent } from "../../../lib/types";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { shareExport } from "../../../lib/api/portability";
import { getDocVersion, getDocVersions, restoreDocVersion, type DocVersion } from "../../../lib/api/docs";
import { DOC_VERSION_REASONS } from "@timely/contract/documents";
import RichDoc from "../../../components/docs/RichDoc";
import { PrimaryButton } from "../../../components/ui/primitives";
import { useQueryClient } from "@tanstack/react-query";

const ICON_CHOICES = ["📄", "📝", "📌", "📊", "🗂️", "💡", "🚀", "🎯", "🐛", "🧪", "📚", "🔧", "🔥", "✅", "⭐", "🧠"];

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function countDescendants(docs: { id: string; parentId: string | null }[], id: string): number {
  const children = docs.filter((doc) => doc.parentId === id);
  return children.reduce((total, child) => total + 1 + countDescendants(docs, child.id), 0);
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
  const createDoc = useCreateDoc();
  const remove = useDeleteDoc();
  const backlinks = useDocBacklinksQuery(docId).data ?? [];
  const queryClient = useQueryClient();
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [version, setVersion] = useState<DocVersion | null>(null);
  const [restoring, setRestoring] = useState(false);

  const [remoteEpoch, setRemoteEpoch] = useState(0);
  const [remoteContent, setRemoteContent] = useState<DocContent | null>(null);
  const [editorSync, setEditorSync] = useState(0);
  const lastSavedAtRef = useRef<string | null>(doc?.updatedAt ?? null);
  const editorFocusedRef = useRef(false);

  const seedContent = useMemo(
    () => (doc ? resolveDocContent(doc.content, doc.plainText) : { type: "doc", content: [] }),
    [doc?.id],
  );

  const [assistantText, setAssistantText] = useState(doc?.plainText ?? "");
  const [selectedText, setSelectedText] = useState("");
  const [title, setTitle] = useState(doc?.title ?? "");
  const [icon, setIcon] = useState(doc?.icon ?? "");
  const [favorite, setFavorite] = useState(Boolean(doc?.isFavorite));
  const [wordCount, setWordCount] = useState(() => countWords(doc?.plainText ?? ""));
  type Menu = "icon" | "parent" | "delete" | "backlinks" | "history" | "version";
  const [menu, setMenu] = useState<"more" | Menu | null>(null);
  const [nextMenu, setNextMenu] = useState<Menu | null>(null);

  const [findOpen, setFindOpen] = useState(false);

  function openAfterMore(next: Menu) {
    setNextMenu(next);
    setMenu(null);
  }

  const { schedule, flush, status, hasUnsavedChanges } = useAutosave<UpdateDocPayload>(async (patch) => {
    const saved = await updateDoc.mutateAsync({ id: docId, data: patch });
    lastSavedAtRef.current = saved.updatedAt;
    return saved;
  });
  const unsavedLeave = useUnsavedLeaveGuard(hasUnsavedChanges);

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
    setEditorSync((value) => value + 1);
  }, [remoteEpoch, doc?.title, doc?.icon, doc?.isFavorite, doc?.plainText, doc?.content]);

  useAssistantScreen(doc ? [
    contextChip("object", title || "Document", `docs/${docId}`),
    contextChip("workspace", "Workspace", doc.workspaceId),
    ...(doc.projectId ? [contextChip("project", "Project", doc.projectId)] : []),
    ...(selectedText ? [contextChip("selection", "Selected text", selectedText)] : []),
    ...(hasUnsavedChanges() ? [contextChip("draft", "Unsaved document", { title, plainText: assistantText })] : []),
  ] : []);
  if (!doc) return null;

  const workspace = spaces.find((w) => w.id === doc.workspaceId);
  const descendantCount = countDescendants(docs, doc.id);
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
            {status === "error" ? (
              <Pressable onPress={() => void flush()} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
                <Text style={{ color: colors.primary, fontWeight: "600" }}>Retry</Text>
              </Pressable>
            ) : null}
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
        <Pressable
          accessibilityLabel="Change icon"
          onPress={() => setMenu("icon")}
          hitSlop={12}
          style={styles.iconBtn}
        >
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
      <View style={styles.metaRow}>
        <Text style={styles.words}>
          {wordCount} {wordCount === 1 ? "word" : "words"}
        </Text>
        {backlinks.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => setMenu("backlinks")} hitSlop={8} style={styles.backlinkChip}>
            <Link2 size={12} color={colors.primary} />
            <Text style={styles.backlinkText}>
              Linked from {backlinks.length} {backlinks.length === 1 ? "page" : "pages"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <RichTextEditor
        content={
          isRichContentEmpty(remoteContent ?? seedContent)
            ? { type: "doc", content: [{ type: "paragraph" }] }
            : (remoteContent ?? seedContent)
        }
        onSelectionChange={setSelectedText}
        findOpen={findOpen}
        onFindClose={() => setFindOpen(false)}
        onFocusChange={(focused) => {
          editorFocusedRef.current = focused;
        }}
        onChange={({ content, plainText }) => {
          setAssistantText(plainText);
          setWordCount(countWords(plainText));
          schedule({ content, plainText });
        }}
        onWikiLink={(target) => {
          // [[Page]] names a doc by title; open it when there is one.
          const wanted = target.split("#")[0].trim().toLowerCase();
          const hit = docs.find((d) => (d.title || "").trim().toLowerCase() === wanted);
          if (hit) router.push(`/(app)/docs/${hit.id}`);
          else Alert.alert("No page yet", `There is no page named "${target.split("#")[0].trim()}".`);
        }}
        onCreateSubpage={async () => {
          const page = await createDoc.mutateAsync({
            title: "Untitled",
            parentId: docId,
            workspaceId: doc.workspaceId,
          });
          return { id: page.id, title: page.title || "Untitled" };
        }}
        syncKey={editorSync}
      />

      <BottomSheet
        open={menu === "more"}
        onClose={() => setMenu(null)}
        onClosed={() => {
          if (nextMenu) {
            setMenu(nextMenu);
            setNextMenu(null);
          }
        }}
        title="Doc"
      >
        <SheetOption onSelect={() => { setMenu(null); void shareExport(`/docs/${doc.id}/export?format=markdown`, `${doc.title || "untitled"}.md`, "text/markdown"); }} leading={<Download size={18} color={colors.mutedForeground} />}>
          Export Markdown
        </SheetOption>
        <SheetOption
          onSelect={() => {
            setMenu(null);
            void (async () => {
              try {
                const picked = await DocumentPicker.getDocumentAsync({
                  type: ["text/markdown", "text/plain", "text/*"],
                  copyToCacheDirectory: true,
                });
                if (picked.canceled || !picked.assets?.[0]) return;
                const source = await (await fetch(picked.assets[0].uri)).text();
                const parsed = fromMarkdown(source);
                setWordCount(countWords(parsed.plainText));
                setRemoteContent(parsed.content);
                setEditorSync((value) => value + 1);
                schedule({ content: parsed.content, plainText: parsed.plainText });
              } catch (error) {
                Alert.alert("Could not import", error instanceof Error ? error.message : "Try a .md file.");
              }
            })();
          }}
          leading={<Upload size={18} color={colors.mutedForeground} />}
        >
          Import Markdown
        </SheetOption>
        <SheetOption
          onSelect={() => {
            setMenu(null);
            setFindOpen(true);
          }}
          leading={<TextSearch size={18} color={colors.mutedForeground} />}
        >
          Find and replace
        </SheetOption>
        <SheetOption
          onSelect={() => {
            setVersions(null);
            void getDocVersions(docId).then(setVersions, () => setVersions([]));
            openAfterMore("history");
          }}
          leading={<History size={18} color={colors.mutedForeground} />}
        >
          Version history
        </SheetOption>
        <SheetOption onSelect={() => openAfterMore("backlinks")} leading={<Link2 size={18} color={colors.mutedForeground} />}>
          {`Backlinks (${backlinks.length})`}
        </SheetOption>
        <SheetOption onSelect={() => openAfterMore("icon")} leading={<Smile size={18} color={colors.mutedForeground} />}>
          Change icon
        </SheetOption>
        <SheetOption onSelect={() => openAfterMore("parent")} leading={<FolderUp size={18} color={colors.mutedForeground} />}>
          {`Parent page: ${parentTitle}`}
        </SheetOption>
        <SheetOption
          onSelect={() => {
            const next = !doc.archivedAt;
            schedule({ archived: next });
            showUndoToast(next ? "Archived" : "Unarchived", () => schedule({ archived: !next }));
            setMenu(null);
          }}
          leading={<Archive size={18} color={colors.mutedForeground} />}
        >
          {doc.archivedAt ? "Unarchive" : "Archive"}
        </SheetOption>
        <SheetOption
          onSelect={() => openAfterMore("delete")}
          leading={<Trash2 size={18} color={colors.destructive} />}
        >
          <Text style={{ color: colors.destructive }}>Delete doc</Text>
        </SheetOption>
      </BottomSheet>

      <BottomSheet
        open={menu === "history"}
        onClose={() => setMenu(null)}
        onClosed={() => {
          if (nextMenu) {
            setMenu(nextMenu);
            setNextMenu(null);
          }
        }}
        title="Version history"
      >
        {versions === null ? (
          <Text style={styles.sheetEmpty}>Loading…</Text>
        ) : versions.length === 0 ? (
          <Text style={styles.sheetEmpty}>
            No earlier versions yet. Timely saves one when you start editing again after a pause, every hour while you keep editing, and before the assistant changes this doc.
          </Text>
        ) : (
          versions.map((item) => {
            const edited = new Date(item.editedAt);
            return (
              <SheetOption
                key={item.id}
                onSelect={() => {
                  setVersion(null);
                  void getDocVersion(docId, item.id).then(setVersion, () => setMenu(null));
                  setNextMenu("version");
                  setMenu(null);
                }}
                leading={<History size={18} color={colors.mutedForeground} />}
              >
                <View>
                  <Text style={styles.linkTitle}>
                    {edited.toLocaleDateString(undefined, { month: "short", day: "numeric" })},{" "}
                    {edited.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </Text>
                  <Text style={styles.linkSnippet}>
                    {DOC_VERSION_REASONS[item.reason] ?? "Saved"} · {item.words} {item.words === 1 ? "word" : "words"}
                  </Text>
                </View>
              </SheetOption>
            );
          })
        )}
      </BottomSheet>

      <BottomSheet
        open={menu === "version"}
        onClose={() => setMenu(null)}
        title={version ? version.title || "Untitled" : "Version"}
        footer={
          <PrimaryButton
            label={restoring ? "Restoring…" : "Restore this version"}
            disabled={!version || restoring}
            onPress={() => {
              if (!version) return;
              setRestoring(true);
              void (async () => {
                try {
                  // Save any typing first so it lands in the history too.
                  await flush();
                  const restored = await restoreDocVersion(docId, version.id);
                  lastSavedAtRef.current = restored.updatedAt;
                  queryClient.setQueryData(["docs", docId], restored);
                  setTitle(restored.title);
                  setWordCount(countWords(restored.plainText));
                  setRemoteContent(resolveDocContent(restored.content, restored.plainText));
                  setEditorSync((value) => value + 1);
                  showUndoToast("Version restored. The doc as it was is in the history too.");
                  setMenu(null);
                } catch (error) {
                  Alert.alert("Could not restore", error instanceof Error ? error.message : "Try again.");
                } finally {
                  setRestoring(false);
                }
              })();
            }}
          />
        }
      >
        {version?.content ? <RichDoc content={version.content} /> : <Text style={styles.sheetEmpty}>Loading…</Text>}
      </BottomSheet>

      <BottomSheet open={menu === "backlinks"} onClose={() => setMenu(null)} title="Linked from">
        {backlinks.length === 0 ? (
          <Text style={styles.sheetEmpty}>No other pages link here yet. Mention this page with @ or write [[{title || "Untitled"}]] in another doc.</Text>
        ) : (
          backlinks.map((link) => (
            <SheetOption
              key={link.id}
              onSelect={() => {
                setMenu(null);
                router.push(`/(app)/docs/${link.id}`);
              }}
              leading={link.icon ? <Text>{link.icon}</Text> : <FileText size={18} color={colors.mutedForeground} />}
            >
              <View>
                <Text style={styles.linkTitle}>{link.title || "Untitled"}</Text>
                {link.snippets[0] ? <Text numberOfLines={2} style={styles.linkSnippet}>{link.snippets[0]}</Text> : null}
              </View>
            </SheetOption>
          ))
        )}
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
              hitSlop={6}
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

      <ConfirmSheet
        open={menu === "delete"}
        onClose={() => setMenu(null)}
        title="Delete this doc?"
        message={
          descendantCount > 0
            ? `This doc and ${descendantCount} subpage${descendantCount === 1 ? "" : "s"} will be removed.`
            : "This doc will be removed."
        }
        onConfirm={() => remove.mutate(docId, { onSuccess: () => router.replace("/(app)/(tabs)/docs") })}
      />
      <ConfirmSheet
        open={unsavedLeave.confirmingLeave}
        onClose={unsavedLeave.stay}
        title="Unsaved changes"
        message="Leave this page without finishing the save?"
        confirmLabel="Leave"
        cancelLabel="Stay"
        onConfirm={unsavedLeave.leave}
      />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 20, paddingTop: 16 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: { fontSize: 26, lineHeight: 32, textAlign: "center" },
  title: { flex: 1, color: colors.foreground, fontSize: 24, fontWeight: "600", paddingTop: 6 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, marginTop: 8, marginBottom: 8 },
  words: { color: colors.mutedForeground, fontSize: 12 },
  backlinkChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  backlinkText: { color: colors.primary, fontSize: 12, fontWeight: "600" },
  sheetEmpty: { color: colors.mutedForeground, fontSize: 14, padding: 12 },
  linkTitle: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  linkSnippet: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 4 },
  iconPick: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
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
}));
