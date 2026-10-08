import { Fragment, type ReactNode } from "react";
import { Linking, ScrollView, StyleSheet, Text, View, type TextStyle } from "react-native";
import type { DocContent } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { frontmatterEntries } from "@timely/contract/properties";
import { getApiUrlSync } from "../../lib/api/client";

type Mark = { type?: string; attrs?: Record<string, unknown> };
type Node = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Mark[];
  content?: Node[];
};

export default function RichDoc({ content, onLink }: { content: DocContent | null | undefined; onLink?: (href: string) => void }) {
  const blocks = ((content?.content ?? []) as Node[]).filter(Boolean);
  if (blocks.length === 0) {
    return <Text style={styles.placeholder}>Start writing…</Text>;
  }
  return <View style={styles.wrap}>{blocks.map((node, i) => <Block key={i} node={node} onLink={onLink} />)}</View>;
}

function Block({ node, onLink }: { node: Node; onLink?: (href: string) => void }) {
  switch (node.type) {
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 1) || 1));
      return <Text style={[styles.p, styles[`h${level}` as "h1" | "h2" | "h3"]]}><Inline nodes={node.content} onLink={onLink} /></Text>;
    }
    case "paragraph":
      return (
        <Text style={styles.p}>
          <Inline nodes={node.content} onLink={onLink} />
        </Text>
      );
    case "bulletList":
      return <View style={styles.list}>{(node.content ?? []).map((item, i) => <ListItem key={i} bullet="•" node={item} onLink={onLink} />)}</View>;
    case "orderedList":
      return (
        <View style={styles.list}>
          {(node.content ?? []).map((item, i) => <ListItem key={i} bullet={`${(Number(node.attrs?.start) || 1) + i}.`} node={item} onLink={onLink} />)}
        </View>
      );
    case "taskList":
      return (
        <View style={styles.list}>
          {(node.content ?? []).map((item, i) => (
            <ListItem key={i} bullet={item.attrs?.checked ? "☑" : "☐"} node={item} onLink={onLink} />
          ))}
        </View>
      );
    case "blockquote":
      return (
        <View style={styles.quote}>
          {(node.content ?? []).map((child, i) => <Block key={i} node={child} onLink={onLink} />)}
        </View>
      );
    case "codeBlock":
      return (
        <ScrollView horizontal style={styles.code} contentContainerStyle={styles.codeInner}>
          <Text style={styles.codeText}>{plain(node)}</Text>
        </ScrollView>
      );
    case "horizontalRule":
      return <View style={styles.hr} />;
    case "table":
      return <Table rows={node.content ?? []} />;
    case "callout": {
      const kind = String(node.attrs?.kind || "note");
      const label = kind.charAt(0).toUpperCase() + kind.slice(1);
      const title = node.attrs?.title ? String(node.attrs.title) : "";
      return (
        <View style={[styles.quote, styles.callout]}>
          <Text style={styles.calloutHead}>{title ? `${label}: ${title}` : label}</Text>
          {(node.content ?? []).map((child, i) => <Block key={i} node={child} onLink={onLink} />)}
        </View>
      );
    }
    case "frontmatter":
      return (
        <View style={styles.props}>
          {frontmatterEntries(plain(node)).map(({ key, values }, i) => (
            <View key={`${key}-${i}`} style={styles.propRow}>
              <Text style={styles.propKey}>{key}</Text>
              <View style={styles.propValues}>
                {values.map((value, j) => (
                  <Text key={j} style={styles.propChip}>
                    {value}
                  </Text>
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    case "mathBlock":
      // Read-only text shows the TeX source as code.
      return (
        <ScrollView horizontal style={styles.code} contentContainerStyle={styles.codeInner}>
          <Text style={styles.codeText}>{plain(node)}</Text>
        </ScrollView>
      );
    case "footnote":
      return (
        <View style={styles.li}>
          <Text style={[styles.bullet, styles.mention]}>[{String(node.attrs?.label ?? "")}]</Text>
          <View style={styles.liBody}>{(node.content ?? []).map((child, i) => <Block key={i} node={child} onLink={onLink} />)}</View>
        </View>
      );
    default:
      return (
        <Text style={styles.p}>
          <Inline nodes={node.content ?? [node]} onLink={onLink} />
        </Text>
      );
  }
}

function ListItem({ bullet, node, onLink }: { bullet: string; node: Node; onLink?: (href: string) => void }) {
  return (
    <View style={styles.li}>
      <Text style={styles.bullet}>{bullet}</Text>
      <View style={styles.liBody}>{(node.content ?? []).map((child, i) => <Block key={i} node={child} onLink={onLink} />)}</View>
    </View>
  );
}

function Table({ rows }: { rows: Node[] }) {
  const width = Math.max(1, ...rows.map((row) => (row.content ?? []).length));
  const col = Math.max(96, Math.min(160, Math.floor(320 / Math.min(width, 3))));
  return (
    <ScrollView horizontal style={styles.tableScroll}>
      <View>
        {rows.map((row, r) => (
          <View key={r} style={styles.tr}>
            {Array.from({ length: width }, (_, c) => {
              const cell = row.content?.[c];
              const header = cell?.type === "tableHeader" || r === 0;
              return (
                <View key={c} style={[styles.td, { width: col }, header && styles.th]}>
                  <Text style={[styles.tdText, header && styles.thText]}>{plain(cell)}</Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Inline({ nodes, onLink }: { nodes?: Node[]; onLink?: (href: string) => void }): ReactNode {
  return (
    <>
      {(nodes ?? []).map((node, i) => {
        if (node.type === "hardBreak") return "\n";
        if (node.type === "mention") {
          const label = String(node.attrs?.label ?? "mention");
          const text = node.attrs?.appearance === "page" ? label : `@${label}`;
          return (
            <Text key={i} style={styles.mention}>
              {text}
            </Text>
          );
        }
        if (node.type === "mathInline") {
          return (
            <Text key={i} style={styles.inlineCode}>
              {String(node.attrs?.latex ?? "")}
            </Text>
          );
        }
        if (node.type === "footnoteRef") {
          return (
            <Text key={i} style={styles.mention}>
              [{String(node.attrs?.label ?? "")}]
            </Text>
          );
        }
        if (node.type === "wikiLink") {
          return (
            <Text key={i} style={styles.mention}>
              {String(node.attrs?.alias || node.attrs?.target || "page")}
            </Text>
          );
        }
        if (node.type === "image") {
          // Inline images in read-only text show as a link to the picture.
          const raw = node.attrs?.src;
          // Uploaded doc images are stored as "/files/<id>" on the server.
          const src = typeof raw === "string" && raw.startsWith("/files/") ? getApiUrlSync() + raw : raw;
          return (
            <Text
              key={i}
              style={styles.link}
              onPress={typeof src === "string" ? () => onLink ? onLink(src) : void Linking.openURL(src) : undefined}
            >
              {String(node.attrs?.alt || "Image")}
            </Text>
          );
        }
        if (node.type === "text") {
          const href = node.marks?.find((m) => m.type === "link")?.attrs?.href;
          return (
            <Text
              key={i}
              style={markStyle(node.marks)}
              onPress={typeof href === "string" ? () => onLink ? onLink(href) : void Linking.openURL(href) : undefined}
            >
              {node.text}
            </Text>
          );
        }
        return <Fragment key={i}>{<Inline nodes={node.content} onLink={onLink} />}</Fragment>;
      })}
    </>
  );
}

function markStyle(marks?: Mark[]): TextStyle[] {
  const style: TextStyle[] = [styles.inline];
  for (const mark of marks ?? []) {
    if (mark.type === "bold") style.push(styles.bold);
    if (mark.type === "italic") style.push(styles.italic);
    if (mark.type === "strike") style.push(styles.strike);
    if (mark.type === "code") style.push(styles.inlineCode);
    if (mark.type === "underline") style.push(styles.underline);
    if (mark.type === "highlight") style.push(styles.highlight);
    if (mark.type === "link") style.push(styles.link);
  }
  return style;
}

function plain(node?: Node): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "mention") {
    const label = String(node.attrs?.label ?? "");
    return node.attrs?.appearance === "page" ? label : `@${label}`;
  }
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mathInline") return String(node.attrs?.latex ?? "");
  if (node.type === "wikiLink") return String(node.attrs?.alias || node.attrs?.target || "");
  return (node.content ?? []).map(plain).join("");
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: { gap: 10 },
  placeholder: { color: colors.mutedForeground, fontSize: 16, lineHeight: 24 },
  p: { color: colors.foreground, fontSize: 16, lineHeight: 24 },
  h1: { fontSize: 26, lineHeight: 32, fontWeight: "700", marginTop: 8 },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: "700", marginTop: 6 },
  h3: { fontSize: 18, lineHeight: 24, fontWeight: "600", marginTop: 4 },
  list: { gap: 6 },
  li: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  bullet: { color: colors.mutedForeground, width: 22, fontSize: 16, lineHeight: 24 },
  liBody: { flex: 1, gap: 6 },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    paddingLeft: 12,
    gap: 8,
  },
  callout: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 8, paddingRight: 12 },
  calloutHead: { color: colors.primary, fontWeight: "700", fontSize: 14 },
  code: {
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeInner: { padding: 12 },
  props: { borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, padding: 10, gap: 6 },
  propRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  propKey: { color: colors.mutedForeground, fontSize: 13, lineHeight: 22, minWidth: 64 },
  propValues: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 4 },
  propChip: {
    backgroundColor: colors.accent,
    color: colors.accentForeground,
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 2,
    fontSize: 13,
  },
  codeText: { color: colors.foreground, fontFamily: "monospace", fontSize: 13, lineHeight: 18 },
  hr: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  tableScroll: { marginVertical: 4 },
  tr: { flexDirection: "row" },
  td: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  th: { backgroundColor: colors.muted },
  tdText: { color: colors.foreground, fontSize: 13, lineHeight: 18 },
  thText: { fontWeight: "600" },
  inline: { color: colors.foreground, fontSize: 16, lineHeight: 24 },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through" },
  underline: { textDecorationLine: "underline" },
  highlight: { backgroundColor: colors.accent, color: colors.accentForeground },
  inlineCode: {
    fontFamily: "monospace",
    fontSize: 14,
    backgroundColor: colors.muted,
    color: colors.accentForeground,
  },
  link: { color: colors.primary, textDecorationLine: "underline" },
  mention: { color: colors.primary, fontWeight: "600" },
}));
