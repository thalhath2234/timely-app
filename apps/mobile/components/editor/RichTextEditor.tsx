import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Dimensions,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import {
  AtSign,
  Bold,
  CheckSquare,
  Code,
  Code2,
  FileText,
  FolderKanban,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Info,
  Italic,
  Link2,
  List,
  ListCollapse,
  Columns2,
  MonitorPlay,
  Bookmark as BookmarkIcon,
  ListOrdered,
  ListTodo,
  Minus,
  Plus,
  Sheet as SheetIcon,
  Radical,
  Sparkles,
  SquareSigma,
  Superscript,
  Tags,
  Workflow,
  Box,
  Map as MapIcon,
  Strikethrough,
  Table2,
  Trash2,
  Type,
} from "lucide-react-native";
import type { DocContent, MentionEntityType } from "../../lib/types";
import { useDecisionFeedback, useDecisionsStatusQuery, useMentionItems, useSearchQuery } from "../../lib/hooks";
import { matchMention, type MentionMatch, type MentionTarget } from "../../lib/api/decisions";
import { mentionChoices } from "../../lib/docEditorJev";
import { colors, createThemedStyleSheet, editorThemeVars, getThemeMode, resolvedAccentHex } from "../../lib/theme";
import BottomSheet from "../ui/BottomSheet";
import { Field, PrimaryButton } from "../ui/primitives";
import { useKeyboardAccessory } from "../ui/SheetHost";
import { buildEditorHtml } from "./editorHtml";
import { getApiUrlSync } from "../../lib/api/client";
import { getLinkPreview, uploadDocFile } from "../../lib/api/docs";
import { sharePdfFromHtml } from "../../lib/api/portability";
import { isEmbedUrl } from "@timely/contract/markdown";
import { useToastStore } from "../../lib/toast";
import TimelyLogo from "../ui/TimelyLogo";
import FindBar from "./FindBar";
import BlockSheet, { type BlockInfo } from "./BlockSheet";

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
  { title: "Toggle", description: "A title that folds the blocks under it", cmd: "toggle", keywords: ["fold", "collapse", "details", "expand", "accordion"] },
  { title: "Columns", description: "Blocks side by side (stacked on a phone)", cmd: "columns", keywords: ["columns", "side", "layout", "split"] },
  { title: "Code block", description: "Monospaced code", cmd: "code", shortcut: "```", keywords: ["pre"] },
  { title: "Image", description: "Add a photo from this device", cmd: "imagePick", keywords: ["image", "picture", "photo", "upload", "img"] },
  { title: "Embed", description: "A YouTube, Vimeo, Loom, Spotify, Figma or CodePen link", cmd: "embedPrompt", keywords: ["video", "youtube", "vimeo", "loom", "spotify", "figma", "codepen"] },
  { title: "Bookmark", description: "A link card with the page's title", cmd: "bookmarkPrompt", keywords: ["link", "card", "preview", "url", "web"] },
  { title: "Diagram", description: "Mermaid flowchart or other diagram", cmd: "diagram", keywords: ["mermaid", "flowchart", "chart", "graph"] },
  { title: "Callout", description: "Note, tip, warning or caution box", cmd: "callout", shortcut: ">", keywords: ["note", "tip", "warning", "caution", "important", "alert", "quote", "blockquote"] },
  { title: "Formula", description: "Inline math, like $E = mc^2$", cmd: "math", keywords: ["math", "latex", "tex", "inline"] },
  { title: "Equation", description: "A displayed formula on its own line", cmd: "mathBlock", keywords: ["math", "latex", "tex", "block"] },
  { title: "Footnote", description: "A numbered note at the end of the page", cmd: "footnote", keywords: ["reference", "citation", "note"] },
  { title: "Properties", description: "Key: value lines at the top (frontmatter)", cmd: "frontmatter", keywords: ["frontmatter", "yaml", "metadata", "tags"] },
  { title: "Map", description: "Draw GeoJSON or TopoJSON shapes", cmd: "map", keywords: ["geojson", "topojson", "geo", "location"] },
  { title: "3D model", description: "Show an ASCII STL model", cmd: "stl", keywords: ["stl", "3d", "model", "mesh"] },
  { title: "Table", description: "Insert a 3×3 table", cmd: "table", keywords: ["grid"] },
  { title: "Divider", description: "Line — type - then space", cmd: "hr", shortcut: "-", keywords: ["hr", "rule"] },
  { title: "Link", description: "Add a URL to the selected text", cmd: "linkPrompt", shortcut: "[]", keywords: ["url", "href", "anchor"] },
  { title: "Mention", description: "Reference a doc, sheet, task or project", cmd: "mentionChar", shortcut: "@", keywords: ["@", "mention"] },
  { title: "Page", description: "Create a nested subpage", cmd: "page", keywords: ["subpage", "child", "nested"] },
];

const FORMAT_TOOLS = [
  { label: "Block", Icon: GripVertical, cmd: "blockMenu" },
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
  { label: "Inline code", Icon: Code, cmd: "inlineCode" },
  { label: "Toggle", Icon: ListCollapse, cmd: "toggle" },
  { label: "Columns", Icon: Columns2, cmd: "columns" },
  { label: "Code block", Icon: Code2, cmd: "code" },
  { label: "Callout", Icon: Info, cmd: "callout" },
  { label: "Image", Icon: ImageIcon, cmd: "imagePick" },
  { label: "Embed", Icon: MonitorPlay, cmd: "embedPrompt" },
  { label: "Bookmark", Icon: BookmarkIcon, cmd: "bookmarkPrompt" },
  { label: "Diagram", Icon: Workflow, cmd: "diagram" },
  { label: "Equation", Icon: SquareSigma, cmd: "mathBlock" },
  { label: "Formula", Icon: Radical, cmd: "math" },
  { label: "Footnote", Icon: Superscript, cmd: "footnote" },
  { label: "Map", Icon: MapIcon, cmd: "map" },
  { label: "3D model", Icon: Box, cmd: "stl" },
  { label: "Properties", Icon: Tags, cmd: "frontmatter" },
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

// The editor page is loaded from inline HTML under this base URL. Anything
// else that tries to load in the WebView (a clicked link, a redirect) would
// get the native bridge, so it is opened in the browser or dropped instead.
const EDITOR_ORIGIN = "https://localhost";

function isEditorUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url === "about:blank") return true;
  try {
    return new URL(url).origin === EDITOR_ORIGIN;
  } catch {
    return false;
  }
}

function onShouldStartLoad(request: ShouldStartLoadRequest): boolean {
  if (isEditorUrl(request.url)) return true;
  // Embedded players (YouTube, Spotify...) load in iframes; they cannot
  // navigate the editor itself.
  if (request.isTopFrame === false && /^https:/i.test(request.url)) return true;
  if (/^(https?|mailto):/i.test(request.url)) void Linking.openURL(request.url).catch(() => undefined);
  return false;
}

export default function RichTextEditor({
  content,
  onChange,
  onFocusChange,
  onSelectionChange,
  onCreateSubpage,
  onWikiLink,
  placeholder = "Start writing. Type '/' for blocks, '@' to mention…",
  syncKey = 0,
  compact = false,
  findOpen = false,
  onFindClose,
  pdfRequest,
  linkDocId,
  propertyRequest,
}: {
  content: DocContent;
  onChange: (value: { content: DocContent; plainText: string }) => void;
  onFocusChange?: (focused: boolean) => void;
  onSelectionChange?: (text: string) => void;
  onCreateSubpage?: () => Promise<{ id: string; title?: string | null } | null>;
  /** A tapped [[wiki link]]; the target is the page title it names. */
  onWikiLink?: (target: string) => void;
  placeholder?: string;
  /** Increment when remote content should replace the local draft. */
  syncKey?: number;
  compact?: boolean;
  /** Shows the find and replace bar over the editor. */
  findOpen?: boolean;
  onFindClose?: () => void;
  /** Set to a new object to export the doc as a PDF and share it. */
  pdfRequest?: { title: string } | null;
  /** Turns on "Link to an item" for selected text (smart suggestions only);
   * the doc's id keeps the doc itself out of the matches. */
  linkDocId?: string;
  /** Set to a new object to set one doc property (from a suggestion). */
  propertyRequest?: { key: string; value: string } | null;
}) {
  const [findResult, setFindResult] = useState({ current: -1, count: 0 });
  const [blockMenu, setBlockMenu] = useState<BlockInfo | null>(null);
  const pdfTitleRef = useRef("");
  const webRef = useRef<WebView>(null);
  const themeKey = `${getThemeMode()}:${resolvedAccentHex()}`;
  const html = useMemo(() => buildEditorHtml(content, placeholder, editorThemeVars(), getApiUrlSync()), [themeKey]);
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
  const [linkKind, setLinkKind] = useState<"link" | "embed" | "bookmark">("link");
  const [mathEdit, setMathEdit] = useState<{ pos: number; latex: string } | null>(null);
  const onWikiLinkRef = useRef(onWikiLink);
  onWikiLinkRef.current = onWikiLink;
  const [linkRange, setLinkRange] = useState<{ from: number; to: number } | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [barHeight, setBarHeight] = useState(56);
  const [focused, setFocused] = useState(false);
  const mentionItems = useMentionItems();
  const remoteMentions = useSearchQuery(picker?.kind === "mention" ? picker.query : "");
  const linkOn = useDecisionsStatusQuery(Boolean(linkDocId)).data?.available === true && Boolean(linkDocId);
  const feedback = useDecisionFeedback();
  const [hasSelection, setHasSelection] = useState(false);
  const [linkPick, setLinkPick] = useState<{ from: number; to: number; text: string; result: MentionMatch | null } | null>(null);

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
    if (!ready || !pdfRequest) return;
    pdfTitleRef.current = pdfRequest.title;
    run("exportHtml", { title: pdfRequest.title });
  }, [pdfRequest, ready, run]);

  useEffect(() => {
    if (!ready || !propertyRequest) return;
    run("setProperty", propertyRequest);
  }, [propertyRequest, ready, run]);

  useEffect(() => {
    if (!ready) return;
    run("setChrome", { bottomPad: focused && keyboardHeight > 8 ? 12 : barHeight + 32 });
  }, [ready, barHeight, focused, keyboardHeight, run]);

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
    // Only the editor page itself may drive the document.
    if (!isEditorUrl(event.nativeEvent.url)) return;
    try {
      const msg = JSON.parse(event.nativeEvent.data) as {
        type: string;
        content?: DocContent;
        plainText?: string;
        query?: string;
        from?: number;
        to?: number;
        inTable?: boolean;
        selectedText?: string;
        active?: EditorActive;
        pos?: number;
        latex?: string;
        target?: string;
        href?: string;
        current?: number;
        count?: number;
        html?: string;
        block?: BlockInfo | null;
        text?: string;
        ok?: boolean;
      };
      if (msg.type === "linkSelection") {
        if (!msg.ok || typeof msg.from !== "number" || typeof msg.to !== "number") {
          useToastStore.getState().show("Select a phrase within one line to link it to an item");
        } else {
          void findLinkTargets({ from: msg.from, to: msg.to, text: msg.text ?? "" });
        }
      }
      if (msg.type === "linkStale") useToastStore.getState().show("The text changed. Select the phrase again.");
      if (msg.type === "exportHtml" && msg.html) {
        const name = `${(pdfTitleRef.current || "Untitled").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Untitled"}.pdf`;
        void sharePdfFromHtml(name, msg.html).catch((error) =>
          useToastStore.getState().show(error instanceof Error ? error.message : "Could not make the PDF"),
        );
      }
      if (msg.type === "blockInfo") {
        if (msg.block) setBlockMenu(msg.block);
        else useToastStore.getState().show("Tap a block first");
      }
      if (msg.type === "find") setFindResult({ current: msg.current ?? -1, count: msg.count ?? 0 });
      if (msg.type === "openLink" && msg.href && /^https?:/i.test(msg.href)) void Linking.openURL(msg.href).catch(() => undefined);
      if (msg.type === "mathEdit" && typeof msg.pos === "number") {
        setMathEdit({ pos: msg.pos, latex: msg.latex ?? "" });
      }
      if (msg.type === "wikilink") onWikiLinkRef.current?.(msg.target ?? "");
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
        onSelectionChange?.(msg.selectedText || "");
        setHasSelection(Boolean(msg.selectedText?.trim()));
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

  function openLinkPrompt(range?: { from: number; to: number } | null, kind: "link" | "embed" | "bookmark" = "link") {
    setLinkKind(kind);
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
    if (item.cmd === "embedPrompt" || item.cmd === "bookmarkPrompt") {
      if (range) run("deleteRange", range);
      openLinkPrompt(null, item.cmd === "embedPrompt" ? "embed" : "bookmark");
      return;
    }
    if (item.cmd === "imagePick") {
      if (range) run("deleteRange", range);
      void pickImages();
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

  /** Picks photos, uploads them and puts them at the caret. Photos are
   * saved as JPEG first, so HEIC pictures from iPhones work too. */
  async function pickImages() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });
    if (result.canceled) return;
    useToastStore.getState().show(result.assets.length === 1 ? "Uploading photo…" : `Uploading ${result.assets.length} photos…`);
    const images: { src: string; alt: string }[] = [];
    for (const asset of result.assets) {
      try {
        const image = ImageManipulator.ImageManipulator.manipulate(asset.uri);
        if (asset.width * asset.height > 20_000_000) {
          const factor = Math.sqrt(20_000_000 / (asset.width * asset.height));
          image.resize({ width: Math.floor(asset.width * factor), height: Math.floor(asset.height * factor) });
        }
        const rendered = await image.renderAsync();
        const saved = await rendered.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.9 });
        const file = await uploadDocFile(saved.uri);
        images.push({ src: file.url, alt: asset.fileName?.replace(/\.[^.]+$/, "") || "Photo" });
      } catch (error) {
        useToastStore.getState().show(error instanceof Error ? error.message : "Could not upload the photo");
      }
    }
    if (images.length) run("image", { images });
  }

  /** Adds an embed or bookmark for the link typed in the link sheet. */
  async function addLinkBlock(kind: "embed" | "bookmark", href: string) {
    if (!/^https?:\/\/\S+$/i.test(href)) {
      useToastStore.getState().show("Paste a full link that starts with https://");
      return;
    }
    if (kind === "embed") {
      if (!isEmbedUrl(href)) {
        useToastStore.getState().show("That link cannot be embedded. Use YouTube, Vimeo, Loom, Spotify, Figma or CodePen, or add it as a bookmark.");
        return;
      }
      setLinkOpen(false);
      run("linkBlock", { node: { type: "embed", attrs: { src: href } } });
      return;
    }
    setLinkOpen(false);
    const preview = await getLinkPreview(href).catch(() => ({ title: "", description: "" }));
    run("linkBlock", { node: { type: "bookmark", attrs: { url: href, title: preview.title, description: preview.description } } });
  }

  /** Asks which item the selected phrase means; the sheet shows while it loads. */
  async function findLinkTargets(range: { from: number; to: number; text: string }) {
    setLinkPick({ ...range, result: null });
    let result: MentionMatch;
    try {
      result = await matchMention(range.text.trim(), linkDocId);
    } catch {
      result = { available: true, options: [] };
    }
    // A later selection replaces this one; its answer wins.
    setLinkPick((current) => (current && current.from === range.from && current.to === range.to && current.text === range.text ? { ...current, result } : current));
  }

  function pickLinkTarget(target: MentionTarget) {
    if (!linkPick) return;
    run("linkMention", {
      from: linkPick.from,
      to: linkPick.to,
      text: linkPick.text,
      attrs: { id: target.id, label: target.title, entityType: target.kind, appearance: "mention" },
    });
    const result = linkPick.result;
    if (result?.logId) feedback.mutate({ logId: result.logId, accepted: result.match?.id === target.id });
    setLinkPick(null);
  }

  function applyFormat(cmd: string) {
    if (cmd === "blockMenu") {
      run("blockInfo");
      return;
    }
    if (cmd === "embedPrompt" || cmd === "bookmarkPrompt") {
      openLinkPrompt(null, cmd === "embedPrompt" ? "embed" : "bookmark");
      return;
    }
    if (cmd === "imagePick") {
      void pickImages();
      return;
    }
    if (cmd === "callout" && active.callout) {
      run("liftCallout");
      return;
    }
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
        {linkOn && hasSelection ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Link selection to an item"
            onPress={() => run("linkSelection")}
            style={styles.linkTool}
          >
            <AtSign size={16} color={colors.primary} />
            <Text style={styles.linkToolText}>Link to an item</Text>
          </Pressable>
        ) : null}
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
    <View style={[styles.wrap, compact && styles.compact, compact && floatBar && styles.compactFloating]}>
      {findOpen && ready ? <FindBar run={run} result={findResult} onClose={() => onFindClose?.()} /> : null}
      <View style={[styles.webWrap, compact && styles.compactWeb]}>
        <WebView
          key={themeKey}
          ref={webRef}
          source={{ html, baseUrl: "https://localhost" }}
          originWhitelist={[EDITOR_ORIGIN]}
          onShouldStartLoadWithRequest={onShouldStartLoad}
          javaScriptEnabled
          domStorageEnabled
          hideKeyboardAccessoryView
          keyboardDisplayRequiresUserAction={false}
          setSupportMultipleWindows={false}
          // The page is https://localhost; doc images come from the server,
          // which is often plain http on a home network.
          mixedContentMode="compatibility"
          nestedScrollEnabled
          style={styles.web}
          onMessage={onMessage}
          onError={() => setFailed(true)}
          onHttpError={() => setFailed(true)}
        />
        {!ready ? (
          <View pointerEvents="none" style={styles.overlay}>
            {failed ? (
              <Text style={styles.empty}>
                Could not load the editor. Check that the emulator can reach the internet.
              </Text>
            ) : (
              <TimelyLogo size={36} animated />
            )}
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

      <BottomSheet open={linkOpen} onClose={() => setLinkOpen(false)} title={linkKind === "embed" ? "Embed" : linkKind === "bookmark" ? "Bookmark" : "Link"}>
        <Field
          value={linkHref}
          onChangeText={setLinkHref}
          placeholder="https://"
          autoCapitalize="none"
          keyboardType="url"
        />
        <View style={{ height: 12 }} />
        <PrimaryButton
          label={linkKind === "embed" ? "Embed" : linkKind === "bookmark" ? "Add bookmark" : "Apply link"}
          onPress={() => {
            const href = linkHref.trim();
            if (!href) return;
            if (linkKind !== "link") {
              void addLinkBlock(linkKind, href);
              return;
            }
            run("setLink", { ...(linkRange ?? {}), href, label: href.replace(/^https?:\/\//, "") });
            setLinkOpen(false);
            setLinkRange(null);
          }}
        />
        {linkKind === "link" && active.link ? (
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

      <BottomSheet open={linkPick !== null} onClose={() => setLinkPick(null)} title="Link to">
        {linkPick && !linkPick.result ? (
          <Text style={styles.empty}>Finding a match…</Text>
        ) : (
          (() => {
            const rows = mentionChoices(linkPick?.result);
            if (!rows.length) return <Text style={styles.empty}>Nothing in your work matches that phrase.</Text>;
            const hasBest = rows[0].best;
            return rows.map(({ target, best }, index) => {
              const Icon = MENTION_ICONS[target.kind] ?? FileText;
              return (
                <View key={`${target.kind}:${target.id}`}>
                  {best ? <Text style={styles.pickerTitle}>Best match</Text> : null}
                  {!best && index === (hasBest ? 1 : 0) ? <Text style={styles.pickerTitle}>{hasBest ? "Or" : "Closest items"}</Text> : null}
                  <Pressable accessibilityRole="button" onPress={() => pickLinkTarget(target)} style={styles.pickerRow}>
                    {best ? <Sparkles size={16} color={colors.primary} /> : <Icon size={16} color={colors.mutedForeground} />}
                    <View style={styles.pickerCopy}>
                      <Text style={styles.itemTitle} numberOfLines={1}>{target.title || "Untitled"}</Text>
                    </View>
                    <Text style={styles.kind}>{MENTION_LABELS[target.kind]}</Text>
                  </Pressable>
                </View>
              );
            });
          })()
        )}
      </BottomSheet>

      <BlockSheet
        block={blockMenu}
        run={run}
        onClose={() => {
          setBlockMenu(null);
          run("blockDone");
        }}
      />

      <BottomSheet open={mathEdit !== null} onClose={() => closeMath(true)} title="Formula">
        <Field
          value={mathEdit?.latex ?? ""}
          onChangeText={(latex) => setMathEdit((current) => (current ? { ...current, latex } : current))}
          placeholder="TeX, e.g. E = mc^2"
          autoCapitalize="none"
        />
        <View style={{ height: 12 }} />
        <PrimaryButton label="Apply formula" onPress={() => closeMath(false)} />
        <Pressable onPress={() => closeMath(true)} style={{ paddingVertical: 14, alignItems: "center" }}>
          <Text style={{ color: colors.destructive, fontWeight: "600" }}>{mathEdit?.latex ? "Cancel" : "Remove"}</Text>
        </Pressable>
      </BottomSheet>
    </View>
  );

  /** Writes the formula back (an empty one removes the node). */
  function closeMath(cancel: boolean) {
    const edit = mathEdit;
    setMathEdit(null);
    if (!edit) return;
    // Cancelling a brand-new, still empty formula removes it.
    if (cancel && edit.latex.trim()) return;
    run("setMath", { pos: edit.pos, latex: cancel ? "" : edit.latex });
  }
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: { flex: 1, minHeight: 280 },
  compact: { flex: 0, minHeight: 220, maxHeight: 280, borderRadius: 16, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  compactFloating: { minHeight: 140, maxHeight: 180 },
  webWrap: { flex: 1, minHeight: 160 },
  compactWeb: { minHeight: 140, maxHeight: 180 },
  toolOn: { backgroundColor: colors.accent },
  linkTool: { height: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.accent },
  linkToolText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: "center", alignItems: "center", backgroundColor: colors.card },
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
