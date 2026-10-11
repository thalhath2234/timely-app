import { docTypePhrase } from "@timely/contract/documents";
import { useState } from "react";
import { Text, View } from "react-native";
import { Sparkles, X } from "lucide-react-native";
import { contentFromTemplate, templateVars } from "@timely/contract/templates";
import AnimatedPressable from "../ui/AnimatedPressable";
import ConfirmSheet from "../ui/ConfirmSheet";
import { getDoc } from "../../lib/api/docs";
import { SectionLabel } from "../ui/primitives";
import { useCreateTask, useDecisionFeedback, useDocHintsQuery, useUpdateDoc } from "../../lib/hooks";
import { showUndoToast, useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import type { Doc, DocContent } from "../../lib/types";

type Row = { key: string; text: string; label?: string; run?: () => void; manual?: boolean };

/** Smart suggestions for a doc on the phone, as on the web: a template for a
 * near-empty page, the project or page it may belong under, its type and
 * property values (set in the doc's Properties block), lines that read like
 * tasks, and whether it looks out of date. Renders nothing while suggestions
 * are off. */
export default function DocHintsCard({
  doc,
  version,
  nearEmpty = false,
  isEmpty,
  onSetProperty,
  onApplyContent,
}: {
  doc: Doc;
  version: string;
  /** A template is only offered while the page is still near-empty. */
  nearEmpty?: boolean;
  /** Whether the page holds nothing at all; otherwise using a template asks first. */
  isEmpty?: () => boolean;
  /** Sets one property in the open editor; type and property rows need it. */
  onSetProperty?: (key: string, value: string) => void;
  /** Replaces the page's content; the template row needs it. */
  onApplyContent?: (content: DocContent, plainText: string) => void;
}) {
  const { data } = useDocHintsQuery(doc.id, version, !doc.isTemplate && !doc.archivedAt);
  const updateDoc = useUpdateDoc();
  const createTask = useCreateTask();
  const feedback = useDecisionFeedback();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(false);
  const [confirmTemplate, setConfirmTemplate] = useState(false);
  if (!data?.available) return null;
  const hide = (key: string) => setHidden((prev) => new Set(prev).add(key));
  const accept = () => {
    if (data.logId && !sent) {
      setSent(true);
      feedback.mutate({ logId: data.logId, accepted: true });
    }
  };

  const rows: Row[] = [];
  const template = nearEmpty && onApplyContent ? data.template : undefined;
  const applyTemplate = async () => {
    if (!template || !onApplyContent) return;
    try {
      const source = await getDoc(template.id);
      const { content, plainText } = contentFromTemplate(
        { id: source.id, title: source.title, icon: source.icon || "📄", content: source.content },
        templateVars(new Date(), doc.title || source.title),
      );
      onApplyContent(content as DocContent, plainText);
      accept();
      hide("template");
    } catch {
      useToastStore.getState().show("Could not open that template");
    }
  };
  if (template) {
    rows.push({
      key: "template",
      text: `Start from the “${template.title}” template?`,
      label: "Use template",
      manual: true,
      // Few words can still mean an image or a table is there.
      run: () => (isEmpty?.() === false ? setConfirmTemplate(true) : void applyTemplate()),
    });
  }
  const project = data.project;
  if (project && !doc.projectId) {
    rows.push({
      key: "project",
      text: `Looks like part of the “${project.title}” project.`,
      label: "Add",
      run: () => {
        updateDoc.mutate({ id: doc.id, data: { projectId: project.id } });
        showUndoToast(`Added to ${project.title}`, () => updateDoc.mutate({ id: doc.id, data: { projectId: null } }));
      },
    });
  }
  const parent = data.parent;
  if (parent && !doc.parentId) {
    rows.push({
      key: "parent",
      text: `Could live under “${parent.title}”.`,
      label: "Move",
      run: () => {
        updateDoc.mutate({ id: doc.id, data: { parentId: parent.id } });
        showUndoToast(`Moved under ${parent.title}`, () => updateDoc.mutate({ id: doc.id, data: { parentId: null } }));
      },
    });
  }
  if (onSetProperty && data.docType) {
    const docType = data.docType;
    rows.push({ key: "type", text: `Reads like ${docTypePhrase(docType)}.`, label: "Set type", run: () => onSetProperty("type", docType) });
  }
  if (onSetProperty) {
    for (const p of data.properties ?? []) {
      rows.push({
        key: `prop:${p.key}`,
        text: `Set ${p.key} to “${p.value}”, as in your other docs?`,
        label: "Set",
        run: () => onSetProperty(p.key, p.value),
      });
    }
  }
  for (const line of data.work ?? []) {
    rows.push({
      key: `work:${line}`,
      text: `“${line}” reads like a task.`,
      label: "Create task",
      run: () =>
        void createTask
          .mutateAsync({ name: line, kind: "task", duration: 30, workspaceId: doc.workspaceId, projectId: doc.projectId ?? undefined })
          .then(() => useToastStore.getState().show(`Task added: ${line}`))
          .catch(() => useToastStore.getState().show("Could not add the task")),
    });
  }
  if (data.outdated) rows.push({ key: "outdated", text: "This doc may be out of date. It has not been edited in a while and talks about plans or dates that have likely passed." });
  const shown = rows.filter((row) => !hidden.has(row.key));
  if (!shown.length && !confirmTemplate) return null;

  return (
    <View style={styles.card} testID="doc-hints">
      <View style={styles.header}>
        <Sparkles size={16} color={colors.primary} />
        <SectionLabel compact>Suggestions</SectionLabel>
      </View>
      {shown.map((row) => (
        <View key={row.key} style={styles.row}>
          <Text style={[styles.text, { flex: 1 }]}>{row.text}</Text>
          {row.run ? (
            <AnimatedPressable
              accessibilityRole="button"
              onPress={() => {
                row.run!();
                if (row.manual) return;
                accept();
                hide(row.key);
              }}
              style={styles.button}
            >
              <Text style={styles.buttonText}>{row.label}</Text>
            </AnimatedPressable>
          ) : null}
          <AnimatedPressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => hide(row.key)} style={styles.dismiss} hitSlop={8}>
            <X size={14} color={colors.mutedForeground} />
          </AnimatedPressable>
        </View>
      ))}
      <ConfirmSheet
        open={confirmTemplate}
        onClose={() => setConfirmTemplate(false)}
        title={`Replace this page with “${template?.title ?? ""}”?`}
        message="What the page holds now is replaced. Version history keeps the current copy."
        confirmLabel="Replace"
        onConfirm={() => void applyTemplate()}
      />
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: { gap: 8, marginHorizontal: 16, marginBottom: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  text: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  button: { minHeight: 32, borderRadius: 10, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary },
  buttonText: { color: colors.foreground, fontSize: 12, fontWeight: "700" },
  dismiss: { padding: 4 },
}));
