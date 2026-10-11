import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ChevronRight,
  Code2,
  CopyPlus,
  Download,
  FileInput,
  FileOutput,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Info,
  List,
  ListCollapse,
  ListOrdered,
  Plus,
  Repeat2,
  Trash2,
  Type,
} from "lucide-react-native";
import { pageChoices } from "@timely/contract/documents";
import type { DocContent } from "../../lib/types";
import { createDoc, getDoc, getDocs, updateDoc } from "../../lib/api/docs";
import { shareImage } from "../../lib/api/portability";
import { resolveDocContent } from "../../lib/markdown";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { fileHref } from "../../lib/fileRoutes";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import { Field } from "../ui/primitives";

/** What the editor page reports about the caret's block (editorHtml.ts blockInfo). */
export type BlockInfo = {
  kind: string;
  level: number;
  textual: boolean;
  canUp: boolean;
  canDown: boolean;
  topLevel: boolean;
  images: { src: string; alt: string }[];
  node: unknown;
  text: string;
};

const NAMES: Record<string, string> = {
  paragraph: "Text",
  bulletList: "Bulleted list",
  orderedList: "Numbered list",
  taskList: "To-do list",
  listItem: "List item",
  taskItem: "To-do",
  codeBlock: "Code",
  callout: "Callout",
  details: "Toggle",
  columns: "Columns",
  table: "Table",
  horizontalRule: "Divider",
  embed: "Embed",
  bookmark: "Bookmark",
  footnote: "Footnote",
  mathBlock: "Equation",
};

function blockName(block: BlockInfo) {
  if (block.kind === "heading") return `Heading ${block.level}`;
  if (block.images.length > 0 && !block.text.trim()) return "Image";
  return NAMES[block.kind] ?? "Block";
}

/** The editor commands that turn the caret's block into another kind. */
const TURN_INTO = [
  { label: "Text", Icon: Type, cmd: "paragraph", level: 0 },
  { label: "Heading 1", Icon: Heading1, cmd: "h1", level: 1 },
  { label: "Heading 2", Icon: Heading2, cmd: "h2", level: 2 },
  { label: "Heading 3", Icon: Heading3, cmd: "h3", level: 3 },
  { label: "Bulleted list", Icon: List, cmd: "bullet" },
  { label: "Numbered list", Icon: ListOrdered, cmd: "ordered" },
  { label: "To-do list", Icon: CheckSquare, cmd: "task" },
  { label: "Toggle", Icon: ListCollapse, cmd: "toggle" },
  { label: "Callout", Icon: Info, cmd: "callout" },
  { label: "Code block", Icon: Code2, cmd: "code" },
];

type Step = "menu" | "turn" | "copy" | "move";

/**
 * The Block menu from the editor toolbar: turn the caret's block into another
 * kind, duplicate, move, copy or move it to another page, save its images, or
 * delete it.
 */
export default function BlockSheet({
  block,
  run,
  onClose,
}: {
  block: BlockInfo | null;
  run: (cmd: string, payload?: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("menu");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const { id: currentId } = useLocalSearchParams<{ id?: string }>();
  const transferring = step === "copy" || step === "move";
  const docs = useQuery({ queryKey: ["docs"], queryFn: getDocs, enabled: transferring });

  // Pages nest as in the docs list; this page stays so its subpages keep their place.
  const matches = useMemo(() => pageChoices(docs.data ?? [], query), [docs.data, query]);

  const close = () => {
    onClose();
    setStep("menu");
    setQuery("");
    setBusy(false);
  };
  const act = (action: string) => {
    run("blockAction", { action });
    close();
  };

  /** Adds the block at the end of a page (or a new one); a move then removes it here. */
  async function transfer(target: { id?: string; title: string }) {
    if (!block || busy) return;
    setBusy(true);
    const mode = step;
    try {
      let createdId: string | null = null;
      if (target.id) {
        const fresh = await getDoc(target.id);
        const content = resolveDocContent(fresh.content, fresh.plainText);
        const existing = (content.content ?? []) as { type?: string; content?: unknown[] }[];
        const kept = existing.length === 1 && existing[0].type === "paragraph" && !existing[0].content?.length ? [] : existing;
        await updateDoc(target.id, {
          content: { ...content, type: "doc", content: [...kept, block.node] } as DocContent,
          plainText: [fresh.plainText, block.text].filter(Boolean).join("\n\n"),
        });
      } else {
        const created = await createDoc({ title: target.title, content: { type: "doc", content: [block.node] } as DocContent, plainText: block.text });
        createdId = created.id;
      }
      void queryClient.invalidateQueries({ queryKey: ["docs"] });
      if (mode === "move") run("blockAction", { action: "delete" });
      close();
      if (createdId) {
        // A new page opens right away, to carry on from the block.
        useToastStore.getState().show(`${mode === "move" ? "Moved" : "Copied"} to the new page`);
        router.push(fileHref(createdId));
        return;
      }
      useToastStore.getState().show(`${mode === "move" ? "Moved" : "Copied"} to ${target.title || "Untitled"}`);
    } catch (error) {
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not add the block to that page");
      setBusy(false);
    }
  }

  const icon = (Icon: typeof Type, color: string = colors.mutedForeground) => <Icon size={18} color={color} />;
  const title = !block ? "Block" : step === "turn" ? "Turn into" : step === "copy" ? "Copy to page" : step === "move" ? "Move to page" : blockName(block);

  return (
    <BottomSheet open={block !== null} onClose={close} title={title}>
      {!block ? null : step === "turn" ? (
        TURN_INTO.map((item) => (
          <SheetOption
            key={item.cmd}
            selected={item.level !== undefined && (block.kind === "heading" ? block.level === item.level : item.level === 0 && block.kind === "paragraph")}
            leading={icon(item.Icon)}
            onSelect={() => {
              // Lists and wrappers start from a plain paragraph.
              if (block.kind === "heading" && item.level === undefined) run("paragraph");
              run(item.cmd);
              run("blockDone");
              close();
            }}
          >
            {item.label}
          </SheetOption>
        ))
      ) : transferring ? (
        <View>
          <Field value={query} onChangeText={setQuery} placeholder="Search pages" autoCapitalize="none" />
          <View style={{ height: 8 }} />
          {matches.map(({ doc, depth, path }) => {
            const here = doc.id === currentId;
            return (
              <View key={doc.id} style={{ paddingLeft: depth * 18, opacity: here ? 0.5 : 1 }}>
                <SheetOption
                  leading={doc.icon ? <Text style={styles.emoji}>{doc.icon}</Text> : icon(FileText)}
                  onSelect={() => {
                    if (!here) void transfer({ id: doc.id, title: doc.title });
                  }}
                >
                  <Text style={styles.label} numberOfLines={1}>
                    {doc.title || "Untitled"}
                    {here ? <Text style={styles.hint}> (this page)</Text> : null}
                  </Text>
                  {query.trim() && path.length > 0 ? (
                    <Text style={styles.hint} numberOfLines={1}>
                      {path.join(" / ")}
                    </Text>
                  ) : null}
                </SheetOption>
              </View>
            );
          })}
          {docs.isSuccess && matches.length === 0 ? <Text style={styles.empty}>No pages match.</Text> : null}
          <SheetOption leading={icon(Plus)} onSelect={() => void transfer({ title: query.trim() || "Untitled" })}>
            {query.trim() ? `New page “${query.trim()}”` : "New page"}
          </SheetOption>
        </View>
      ) : (
        <>
          {block.textual ? (
            <SheetOption leading={icon(Repeat2)} onSelect={() => setStep("turn")}>
              <View style={styles.row}>
                <Text style={styles.label}>Turn into</Text>
                <ChevronRight size={18} color={colors.mutedForeground} />
              </View>
            </SheetOption>
          ) : null}
          {block.images.length > 0 ? (
            <SheetOption
              leading={icon(Download)}
              onSelect={() => {
                run("blockDone");
                close();
                void (async () => {
                  for (const image of block.images) {
                    await shareImage(image.src, image.alt).catch((error) =>
                      useToastStore.getState().show(error instanceof Error ? error.message : "Could not save the image"),
                    );
                  }
                })();
              }}
            >
              {block.images.length === 1 ? "Save image" : `Save ${block.images.length} images`}
            </SheetOption>
          ) : null}
          <SheetOption leading={icon(CopyPlus)} onSelect={() => act("duplicate")}>
            Duplicate
          </SheetOption>
          {block.topLevel ? (
            <>
              <SheetOption leading={icon(FileOutput)} onSelect={() => setStep("copy")}>
                Copy to page…
              </SheetOption>
              <SheetOption leading={icon(FileInput)} onSelect={() => setStep("move")}>
                Move to page…
              </SheetOption>
            </>
          ) : null}
          {block.canUp ? (
            <SheetOption leading={icon(ArrowUp)} onSelect={() => act("up")}>
              Move up
            </SheetOption>
          ) : null}
          {block.canDown ? (
            <SheetOption leading={icon(ArrowDown)} onSelect={() => act("down")}>
              Move down
            </SheetOption>
          ) : null}
          <SheetOption leading={icon(Trash2, colors.destructive)} onSelect={() => act("delete")}>
            <Text style={[styles.label, { color: colors.destructive }]}>Delete</Text>
          </SheetOption>
        </>
      )}
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "600" },
  emoji: { width: 18, textAlign: "center", fontSize: 15 },
  hint: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  empty: { color: colors.mutedForeground, fontSize: 14, paddingVertical: 10, paddingHorizontal: 4 },
}));
