import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Dimensions,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import {
  AtSign,
  Bold,
  CheckSquare,
  Code,
  Code2,
  Columns2,
  Combine,
  FileText,
  FolderKanban,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Plus,
  Quote,
  Rows2,
  Sheet as SheetIcon,
  Split,
  Strikethrough,
  Table2,
  Trash2,
  Type,
} from "lucide-react-native";
import type { DocContent, MentionEntityType } from "../../lib/types";
import { useMentionItems, useSearchQuery } from "../../lib/hooks";
import { colors, createThemedStyleSheet, editorThemeVars, getThemeMode, resolvedAccentHex } from "../../lib/theme";
import BottomSheet from "../ui/BottomSheet";
import { Field, PrimaryButton } from "../ui/primitives";
import { useKeyboardAccessory } from "../ui/SheetHost";
import { buildEditorHtml } from "./editorHtml";

type Picker = { kind: "slash" | "mention"; query: string; from: number; to: number } | null;

const SLASH: {
  title: string;
  description: string;
  cmd: string;
  shortcut?: string;
  keywords: string[];
}[] = [
  { title: "Text", description: "Plain paragraph", cmd: "paragraph", keywords: ["paragraph", "plain"] },
  { title: "Heading 1", description: "Large section heading", cmd: "h1", shortcut: "#", keywords: ["h1", "title"] },
  { title: "Heading 2", description: "Medium section heading", cmd: "h2", shortcut: "##", keywords: ["h2"] },
  { title: "Heading 3", description: "Small section heading", cmd: "h3", shortcut: "###", keywords: ["h3"] },
  { title: "Bulleted list", description: "Simple bulleted list", cmd: "bullet", shortcut: ".", keywords: ["ul", "bullet", "-"] },
  { title: "Numbered list", description: "List with ordering", cmd: "ordered", shortcut: "1.", keywords: ["ol", "number"] },
  { title: "To-do list", description: "Track tasks with checkboxes", cmd: "task", shortcut: "[]", keywords: ["todo", "check"] },
  { title: "Quote", description: "Capture a quotation", cmd: "quote", shortcut: ">", keywords: ["blockquote"] },
  { title: "Code block", description: "Monospaced code", cmd: "code", shortcut: "```", keywords: ["pre"] },
  { title: "Table", description: "Insert a 3×3 table", cmd: "table", keywords: ["grid"] },
  { title: "Divider", description: "Line — type - then space", cmd: "hr", shortcut: "-", keywords: ["hr", "rule"] },
  { title: "Link", description: "Add a URL to the selected text", cmd: "linkPrompt", shortcut: "[]", keywords: ["url", "href", "anchor"] },
  { title: "Mention", description: "Reference a doc, sheet, task or project", cmd: "mentionChar", shortcut: "@", keywords: ["@", "mention"] },
  { title: "Page", description: "Create a nested subpage", cmd: "page", keywords: ["subpage", "child", "nested"] },
];

const FORMAT_TOOLS = [
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
  { label: "Inline code", Icon: Code, cmd: "inlineCode" },
  { label: "Code block", Icon: Code2, cmd: "code" },
  { label: "Link", Icon: Link2, cmd: "linkPrompt" },
  { label: "Table", Icon: Table2, cmd: "table" },
  { label: "Divider", Icon: Minus, cmd: "hr" },
  { label: "Mention", Icon: AtSign, cmd: "mentionChar" },
];

const TABLE_TOOLS = [
  { label: "Add column before", caption: "⟨Col", Icon: Plus, cmd: "addColBefore" },
  { label: "Add column after", caption: "Col⟩", Icon: Plus, cmd: "addColAfter" },
  { label: "Delete column", caption: "−Col", Icon: Minus, cmd: "deleteCol" },
  { label: "Add row before", caption: "⟨Row", Icon: Plus, cmd: "addRowBefore" },
  { label: "Add row after", caption: "Row⟩", Icon: Plus, cmd: "addRowAfter" },
  { label: "Delete row", caption: "−Row", Icon: Minus, cmd: "deleteRow" },
  { label: "Header row", caption: "H-row", Icon: Rows2, cmd: "headerRow" },
  { label: "Header column", caption: "H-col", Icon: Columns2, cmd: "headerCol" },
  { label: "Merge cells", caption: "Merge", Icon: Combine, cmd: "merge" },
  { label: "Split cell", caption: "Split", Icon: Split, cmd: "split" },
  { label: "Delete table", caption: "Delete", Icon: Trash2, cmd: "deleteTable" },
];

const MENTION_ICONS = {
  doc: FileText,
  sheet: SheetIcon,
  task: ListTodo,
  project: FolderKanban,
} as const;

const MENTION_LABELS: Record<MentionEntityType, string> = {
  doc: "Doc",
  sheet: "Sheet",
  task: "Task",
  project: "Project",
};

function filterMentions<T extends { label: string; hint?: string }>(items: T[], query: string) {
  const search = query.trim().toLowerCase();
  if (!search) return items.slice(0, 8);
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    const index = label.indexOf(search);
    if (index === 0) scored.push({ item, score: 0 });
    else if (index > 0) scored.push({ item, score: 1 });
    else if (item.hint?.toLowerCase().includes(search)) scored.push({ item, score: 2 });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, 8).map((entry) => entry.item);
}

type EditorActive = Record<string, boolean>;

function keyboardCover(coords?: { height: number; screenY: number } | null) {
  if (!coords) return 0;
  const screenH = Dimensions.get("screen").height;
  return Math.max(coords.height, Math.round(screenH - coords.screenY), 0);
}

function readKeyboardCover() {
  const metrics = Keyboard.metrics?.();
  if (metrics) return keyboardCover(metrics);
  return 0;
}

export default function RichTextEditor({
  content,
  onChange,
  onFocusChange,
  onCreateSubpage,
  placeholder = "Start writing. Type '/' for blocks, '@' to mention…",
  syncKey = 0,
  compact = false,
}: {
  content: DocContent;
  onChange: (value: { content: DocContent; plainText: string }) => void;
  onFocusChange?: (focused: boolean) => void;
  onCreateSubpage?: () => Promise<{ id: string; title?: string | null } | null>;
  placeholder?: string;
  /** Increment when remote content should replace the local draft. */
  syncKey?: number;
  compact?: boolean;
}) {
  const webRef = useRef<WebView>(null);
  const themeKey = `${getThemeMode()}:${resolvedAccentHex()}`;
  const html = useMemo(() => buildEditorHtml(content, placeholder, editorThemeVars()), [themeKey]);
  const focusedRef = useRef(false);
  const appliedRef = useRef(JSON.stringify(content));
  const contentRef = useRef(content);
  contentRef.current = content;
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [inTable, setInTable] = useState(false);
  const [active, setActive] = useState<EditorActive>({});
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("https://");
  const [linkRange, setLinkRange] = useState<{ from: number; to: number } | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [barHeight, setBarHeight] = useState(56);
  const [focused, setFocused] = useState(false);
  const mentionItems = useMentionItems();
  const remoteMentions = useSearchQuery(picker?.kind === "mention" ? picker.query : "");

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = (event: { endCoordinates: { height: number; screenY: number } }) => {
      setKeyboardHeight(keyboardCover(event.endCoordinates));
    };
    const show = Keyboard.addListener(showEvent, onShow);
    const change = Keyboard.addListener("keyboardDidChangeFrame", onShow);
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    setKeyboardHeight(readKeyboardCover());
    return () => {
      show.remove();
      change.remove();
      hide.remove();
    };
  }, []);

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

  useEffect(() => {
    if (!ready) return;
    run("setChrome", { bottomPad: barHeight + 32 });
  }, [ready, barHeight, run]);

  const applyRemoteIfIdle = useCallback(() => {
    if (!ready) return;
    const serialized = JSON.stringify(contentRef.current);
    if (serialized === appliedRef.current) return;
    appliedRef.current = serialized;
    const js = `window.__timely && window.__timely.set(${JSON.stringify(contentRef.current)}); true;`;
    webRef.current?.injectJavaScript(js);
  }, [ready]);

  useEffect(() => {
    applyRemoteIfIdle();
  }, [applyRemoteIfIdle, syncKey]);

  function onMessage(event: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as {
        type: string;
        content?: DocContent;
        plainText?: string;
        query?: string;
        from?: number;
        to?: number;
        inTable?: boolean;
        active?: EditorActive;
      };
      if (msg.type === "change" && msg.content) {
        appliedRef.current = JSON.stringify(msg.content);
        onChange({ content: msg.content, plainText: msg.plainText ?? "" });
      }
      if (msg.type === "focus") {
        focusedRef.current = true;
        setFocused(true);
        const cover = readKeyboardCover();
        if (cover > 0) setKeyboardHeight(cover);
        onFocusChangeRef.current?.(true);
      }
      if (msg.type === "blur") {
        focusedRef.current = false;
        setFocused(false);
        onFocusChangeRef.current?.(false);
      }
      if (msg.type === "slash" || msg.type === "mention") {
        setPicker({ kind: msg.type, query: msg.query ?? "", from: msg.from ?? 0, to: msg.to ?? 0 });
      }
      if (msg.type === "selection") {
        setInTable(Boolean(msg.inTable));
        if (msg.active) setActive(msg.active);
      }
      if (msg.type === "ready") setReady(true);
      if (msg.type === "hidePickers") setPicker(null);
    } catch {
      // ignore
    }
  }

  const slashItems = SLASH.filter((item) => {
    if (item.cmd === "page" && !onCreateSubpage) return false;
    const q = (picker?.kind === "slash" ? picker.query : "").toLowerCase();
    if (!q) return true;
    return item.title.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q));
  });

  const localMentions = filterMentions(mentionItems, picker?.kind === "mention" ? picker.query : "");
  const remoteHits = (remoteMentions.data ?? [])
    .filter((hit) => ["task", "doc", "sheet", "project"].includes(hit.kind))
    .map((hit) => ({
      id: hit.id,
      label: hit.title,
      entityType: (["task", "doc", "sheet", "project"].includes(hit.kind) ? hit.kind : "doc") as MentionEntityType,
      hint: hit.snippet,
    }));
  const mentionHits = (() => {
    const seen = new Set(localMentions.map((item) => `${item.entityType}:${item.id}`));
    const extra = remoteHits.filter((item) => !seen.has(`${item.entityType}:${item.id}`));
    return [...localMentions, ...extra].slice(0, 8);
  })();

  const safeBottom = 8;
  const floatBar = focused && keyboardHeight > 8;

  function openLinkPrompt(range?: { from: number; to: number } | null) {
    setLinkRange(range ?? null);
    setLinkHref("https://");
    setLinkOpen(true);
  }

  async function applySlash(item: (typeof SLASH)[number]) {
    const range = picker ? { from: picker.from, to: picker.to } : undefined;
    setPicker(null);
    if (item.cmd === "linkPrompt") {
      openLinkPrompt(range ?? null);
      return;
    }
    if (item.cmd === "page") {
      if (!onCreateSubpage) return;
      const page = await onCreateSubpage();
      if (!page) return;
      run("mention", {
        ...(range ?? {}),
        attrs: {
          id: page.id,
          label: page.title || "Untitled",
          entityType: "doc",
          appearance: "page",
        },
      });
      return;
    }
    run(item.cmd, range ?? {});
  }

  function applyFormat(cmd: string) {
    if (cmd === "linkPrompt") {
      if (active.link) {
        run("unsetLink");
        return;
      }
      openLinkPrompt(null);
      return;
    }
    run(cmd);
  }

  const dock = (
    <View
      onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
      style={[styles.dock, { paddingBottom: floatBar ? 0 : safeBottom }]}
    >
      {inTable ? (
        <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={styles.bar} style={styles.tableBar}>
          {TABLE_TOOLS.map((btn) => (
            <Pressable key={btn.label} accessibilityLabel={btn.label} onPress={() => run(btn.cmd)} style={styles.tableTool}>
              <btn.Icon size={16} color={btn.cmd === "deleteTable" ? colors.destructive : colors.foreground} />
              <Text style={[styles.tableCaption, btn.cmd === "deleteTable" && { color: colors.destructive }]}>
                {btn.caption}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={styles.bar} style={styles.barWrap}>
        {FORMAT_TOOLS.map((btn) => {
          const on =
            btn.cmd === "linkPrompt"
              ? Boolean(active.link)
              : btn.cmd === "code"
                ? Boolean(active.codeBlock)
                : Boolean(active[btn.cmd]);
          return (
            <Pressable
              key={btn.label}
              accessibilityLabel={btn.label}
              accessibilityState={{ selected: on }}
              onPress={() => applyFormat(btn.cmd)}
              style={[styles.tool, on && styles.toolOn]}
            >
              <btn.Icon size={18} color={on ? colors.accentForeground : colors.foreground} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  useKeyboardAccessory(floatBar, keyboardHeight, () => dock);

  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <View style={[styles.webWrap, compact && styles.compactWeb]}>
        <WebView
          key={themeKey}
          ref={webRef}
          source={{ html, baseUrl: "https://localhost" }}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          hideKeyboardAccessoryView
          keyboardDisplayRequiresUserAction={false}
          setSupportMultipleWindows={false}
          nestedScrollEnabled
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
      </View>

      {picker ? (
        <View pointerEvents="box-none" style={[styles.pickerDock, { bottom: barHeight + 8 }]}>
          <View style={styles.pickerCard}>
            {picker.kind === "mention" ? (
              <Text style={styles.pickerTitle}>
                {picker.query ? `Search “${picker.query}”` : "Search docs, sheets, tasks, projects"}
              </Text>
            ) : (
              <Text style={styles.pickerTitle}>Insert block</Text>
            )}
            <ScrollView keyboardShouldPersistTaps="always" style={styles.pickerList} nestedScrollEnabled>
              {picker.kind === "slash" ? (
                slashItems.length === 0 ? (
                  <Text style={styles.empty}>No blocks found</Text>
                ) : (
                  slashItems.map((item) => (
                    <Pressable
                      key={item.cmd}
                      onPress={() => {
                        void applySlash(item);
                      }}
                      style={styles.pickerRow}
                    >
                      <Type size={16} color={colors.mutedForeground} />
                      <View style={styles.pickerCopy}>
                        <Text style={styles.itemTitle}>{item.title}</Text>
                        <Text style={styles.itemMeta}>{item.description}</Text>
                      </View>
                      {item.shortcut ? <Text style={styles.shortcut}>{item.shortcut}</Text> : null}
                    </Pressable>
                  ))
                )
              ) : mentionHits.length === 0 ? (
                <Text style={styles.empty}>{picker.query ? "No matches" : "Nothing to mention yet"}</Text>
              ) : (
                mentionHits.map((hit) => {
                  const Icon = MENTION_ICONS[hit.entityType] ?? FileText;
                  return (
                    <Pressable
                      key={`${hit.entityType}-${hit.id}`}
                      onPress={() => {
                        run("mention", {
                          ...(picker.from >= 0 ? { from: picker.from, to: picker.to } : {}),
                          attrs: {
                            id: hit.id,
                            label: hit.label,
                            entityType: hit.entityType,
                          },
                        });
                        setPicker(null);
                      }}
                      style={styles.pickerRow}
                    >
                      <Icon size={16} color={colors.mutedForeground} />
                      <View style={styles.pickerCopy}>
                        <Text style={styles.itemTitle}>{hit.label || "Untitled"}</Text>
                        {hit.hint ? <Text style={styles.itemMeta}>{hit.hint}</Text> : null}
                      </View>
                      <Text style={styles.kind}>{MENTION_LABELS[hit.entityType]}</Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      ) : null}

      {floatBar ? null : dock}

      <BottomSheet open={linkOpen} onClose={() => setLinkOpen(false)} title="Link">
        <Field
          value={linkHref}
          onChangeText={setLinkHref}
          placeholder="https://"
          autoCapitalize="none"
          keyboardType="url"
        />
        <View style={{ height: 12 }} />
        <PrimaryButton
          label="Apply link"
          onPress={() => {
            const href = linkHref.trim();
            if (!href) return;
            run("setLink", { ...(linkRange ?? {}), href, label: href.replace(/^https?:\/\//, "") });
            setLinkOpen(false);
            setLinkRange(null);
          }}
        />
        {active.link ? (
          <Pressable
            onPress={() => {
              run("unsetLink");
              setLinkOpen(false);
            }}
            style={{ paddingVertical: 14, alignItems: "center" }}
          >
            <Text style={{ color: colors.destructive, fontWeight: "600" }}>Remove link</Text>
          </Pressable>
        ) : null}
      </BottomSheet>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: { flex: 1, minHeight: 280 },
  compact: { flex: 0, minHeight: 220, maxHeight: 280, borderRadius: 16, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  webWrap: { flex: 1, minHeight: 160 },
  compactWeb: { minHeight: 140, maxHeight: 180 },
  toolOn: { backgroundColor: colors.accent },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: "center", padding: 24 },
  web: { flex: 1, backgroundColor: colors.background },
  dock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    ...Platform.select({
      android: { elevation: 24 },
      default: {},
    }),
  },
  tableBar: {
    maxHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.popover,
  },
  barWrap: { maxHeight: 52, backgroundColor: colors.card },
  bar: { alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 6 },
  tool: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tableTool: {
    height: 40,
    minWidth: 44,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  tableCaption: { color: colors.mutedForeground, fontSize: 10, fontWeight: "600" },
  pickerDock: {
    position: "absolute",
    left: 8,
    right: 8,
    zIndex: 20,
    maxHeight: 280,
  },
  pickerCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.popover,
    overflow: "hidden",
    maxHeight: 280,
  },
  pickerTitle: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  pickerList: { maxHeight: 240 },
  pickerRow: {
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pickerCopy: { flex: 1, minWidth: 0 },
  itemTitle: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  itemMeta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  shortcut: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    backgroundColor: colors.muted,
    overflow: "hidden",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  kind: { color: colors.mutedForeground, fontSize: 10, fontWeight: "600", letterSpacing: 0.6 },
  empty: { color: colors.mutedForeground, padding: 12, fontSize: 14 },
}));
