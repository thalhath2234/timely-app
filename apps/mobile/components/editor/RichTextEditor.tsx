import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import {
  AtSign,
  Bold,
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table2,
  Type,
} from "lucide-react-native";
import type { DocContent, MentionEntityType } from "../../lib/types";
import { useSearchQuery } from "../../lib/hooks";
import { colors } from "../../lib/theme";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import { buildEditorHtml } from "./editorHtml";

type Picker = { kind: "slash" | "mention"; query: string; from: number; to: number } | null;

const SLASH: { title: string; description: string; cmd: string; keywords: string[] }[] = [
  { title: "Text", description: "Plain paragraph", cmd: "paragraph", keywords: ["paragraph", "plain"] },
  { title: "Heading 1", description: "Large section heading", cmd: "h1", keywords: ["h1", "title"] },
  { title: "Heading 2", description: "Medium section heading", cmd: "h2", keywords: ["h2"] },
  { title: "Heading 3", description: "Small section heading", cmd: "h3", keywords: ["h3"] },
  { title: "Bulleted list", description: "Simple bulleted list", cmd: "bullet", keywords: ["ul", "bullet"] },
  { title: "Numbered list", description: "List with ordering", cmd: "ordered", keywords: ["ol", "number"] },
  { title: "To-do list", description: "Track tasks with checkboxes", cmd: "task", keywords: ["todo", "check"] },
  { title: "Quote", description: "Capture a quotation", cmd: "quote", keywords: ["blockquote"] },
  { title: "Code block", description: "Monospaced code", cmd: "code", keywords: ["pre"] },
  { title: "Table", description: "Insert a 3×3 table", cmd: "table", keywords: ["grid"] },
  { title: "Divider", description: "Visually separate sections", cmd: "hr", keywords: ["hr", "rule"] },
  { title: "Mention", description: "Reference a doc, sheet, task or project", cmd: "mentionChar", keywords: ["@", "mention"] },
];

export default function RichTextEditor({
  content,
  onChange,
  placeholder = "Start writing. Type '/' for blocks, '@' to mention…",
}: {
  content: DocContent;
  onChange: (value: { content: DocContent; plainText: string }) => void;
  placeholder?: string;
}) {
  const webRef = useRef<WebView>(null);
  const html = useMemo(() => buildEditorHtml(content, placeholder), []);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const mentions = useSearchQuery(picker?.kind === "mention" ? picker.query : "");

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!ready) setFailed(true);
    }, 12000);
    return () => clearTimeout(timer);
  }, [ready]);

  const run = useCallback((name: string, payload: Record<string, unknown> = {}) => {
    const js = `window.__timely && window.__timely.cmd(${JSON.stringify(name)}, ${JSON.stringify(payload)}); true;`;
    webRef.current?.injectJavaScript(js);
  }, []);

  function onMessage(event: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as {
        type: string;
        content?: DocContent;
        plainText?: string;
        query?: string;
        from?: number;
        to?: number;
      };
      if (msg.type === "change" && msg.content) {
        onChange({ content: msg.content, plainText: msg.plainText ?? "" });
      }
      if (msg.type === "slash" || msg.type === "mention") {
        setPicker({ kind: msg.type, query: msg.query ?? "", from: msg.from ?? 0, to: msg.to ?? 0 });
      }
      if (msg.type === "ready") setReady(true);
      if (msg.type === "hidePickers") setPicker(null);
    } catch {
      // ignore
    }
  }

  const slashItems = SLASH.filter((item) => {
    const q = (picker?.kind === "slash" ? picker.query : "").toLowerCase();
    if (!q) return true;
    return item.title.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q));
  });

  const mentionHits = (mentions.data ?? []).filter((hit) =>
    ["task", "doc", "sheet", "project"].includes(hit.kind),
  );

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        source={{ html, baseUrl: "https://localhost" }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        setSupportMultipleWindows={false}
        style={styles.web}
        onMessage={onMessage}
        onError={() => setFailed(true)}
        onHttpError={() => setFailed(true)}
      />
      {!ready ? (
        <View pointerEvents="none" style={styles.overlay}>
          <Text style={styles.empty}>
            {failed
              ? "Could not load the editor. Check that the emulator can reach the internet."
              : "Loading editor…"}
          </Text>
        </View>
      ) : null}
      <ScrollView horizontal keyboardShouldPersistTaps="handled" contentContainerStyle={styles.bar} style={styles.barWrap}>
        {[
          { label: "Bold", Icon: Bold, cmd: "bold" },
          { label: "Italic", Icon: Italic, cmd: "italic" },
          { label: "Strike", Icon: Strikethrough, cmd: "strike" },
          { label: "Highlight", Icon: Highlighter, cmd: "highlight" },
          { label: "H1", Icon: Heading1, cmd: "h1" },
          { label: "H2", Icon: Heading2, cmd: "h2" },
          { label: "H3", Icon: Heading3, cmd: "h3" },
          { label: "List", Icon: List, cmd: "bullet" },
          { label: "Numbered", Icon: ListOrdered, cmd: "ordered" },
          { label: "Todo", Icon: CheckSquare, cmd: "task" },
          { label: "Quote", Icon: Quote, cmd: "quote" },
          { label: "Code", Icon: Code2, cmd: "code" },
          { label: "Table", Icon: Table2, cmd: "table" },
          { label: "Divider", Icon: Minus, cmd: "hr" },
          { label: "Mention", Icon: AtSign, cmd: "mentionChar" },
        ].map((btn) => (
          <Pressable key={btn.label} accessibilityLabel={btn.label} onPress={() => run(btn.cmd)} style={styles.tool}>
            <btn.Icon size={18} color={colors.foreground} />
          </Pressable>
        ))}
      </ScrollView>

      <BottomSheet open={picker?.kind === "slash"} onClose={() => setPicker(null)} title="Insert block">
        {slashItems.map((item) => (
          <SheetOption
            key={item.cmd}
            onSelect={() => {
              if (picker) run(item.cmd, { from: picker.from, to: picker.to });
              setPicker(null);
            }}
            leading={<Type size={16} color={colors.mutedForeground} />}
          >
            {item.title}
          </SheetOption>
        ))}
      </BottomSheet>

      <BottomSheet open={picker?.kind === "mention"} onClose={() => setPicker(null)} title="Mention">
        {mentionHits.length === 0 ? (
          <Text style={styles.empty}>{picker?.query ? "No matches" : "Type to search tasks, docs, sheets, projects"}</Text>
        ) : (
          mentionHits.map((hit) => (
            <SheetOption
              key={`${hit.kind}-${hit.id}`}
              onSelect={() => {
                if (!picker) return;
                run("mention", {
                  from: picker.from,
                  to: picker.to,
                  attrs: {
                    id: hit.id,
                    label: hit.title,
                    entityType: (["task", "doc", "sheet", "project"].includes(hit.kind) ? hit.kind : "doc") as MentionEntityType,
                  },
                });
                setPicker(null);
              }              }
            >
              {`${hit.title} · ${hit.kind}`}
            </SheetOption>
          ))
        )}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 280 },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: "center", padding: 24 },
  web: { flex: 1, backgroundColor: colors.background },
  barWrap: { maxHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.card },
  bar: { alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 6 },
  tool: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  itemTitle: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  itemMeta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  empty: { color: colors.mutedForeground, padding: 12, fontSize: 14 },
});
