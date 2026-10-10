import { useEffect, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { FileText, LayoutTemplate, Sheet as SheetIcon, Sparkles } from "lucide-react-native";
import { availableTemplates, contentFromTemplate, templateVars } from "@timely/contract/templates";
import BottomSheet from "../ui/BottomSheet";
import AnimatedPressable from "../ui/AnimatedPressable";
import { Field, PropertyRow } from "../ui/primitives";
import { useCreateDoc, useCreateSheet, useDecisionsStatusQuery, useDocsQuery, useSheetTemplatesQuery } from "../../lib/hooks";
import { getDocTemplateSuggestion, getSheetTemplateSuggestion, sendDecisionFeedback } from "../../lib/api/decisions";
import {
  docTemplateChoices,
  docTitleFromTemplate,
  sheetTemplateChoices,
  suggestionKept,
  suggestionTitle,
  withSuggestion,
  type TemplateChoice,
} from "../../lib/fileTemplates";
import { fileHref } from "../../lib/fileRoutes";
import { colors, createThemedStyleSheet } from "../../lib/theme";

export type FileKind = "doc" | "sheet";

type Suggestion = { kind: FileKind; title: string; templateId?: string; logId?: string };

/** The template a new doc's or sheet's name calls for (smart suggestions).
 * Asked a moment after typing stops; nothing is asked while suggestions are
 * off or there is no template to offer. */
function useTemplateSuggestion(kind: FileKind, title: string, enabled: boolean) {
  const status = useDecisionsStatusQuery(enabled);
  const active = enabled && status.data?.available === true;
  const asked = suggestionTitle(title);
  const [fetched, setFetched] = useState<Suggestion>();
  useEffect(() => {
    if (!active || !asked) return;
    let stale = false;
    const timer = setTimeout(() => {
      const request = kind === "doc" ? getDocTemplateSuggestion(asked) : getSheetTemplateSuggestion(asked);
      request
        .then((next) => {
          if (!stale) setFetched(next.available ? { kind, title: asked, templateId: next.templateId, logId: next.logId } : undefined);
        })
        .catch(() => {});
    }, 600);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [active, asked, kind]);
  // The last answer stays while the person keeps typing, until a newer one.
  return active && asked && fetched?.kind === kind ? fetched : undefined;
}

/** What the new doc or sheet picker offers: the templates as rows, and the
 * one the typed name calls for, first. */
export function useNewFileTemplates(kind: FileKind, title: string, enabled: boolean) {
  const docsQ = useDocsQuery();
  const sheetTemplatesQ = useSheetTemplatesQuery();
  const docTemplates = useMemo(() => availableTemplates(docsQ.data ?? []), [docsQ.data]);
  const choices = useMemo<TemplateChoice[]>(() => {
    if (kind === "sheet") return sheetTemplateChoices(sheetTemplatesQ.data ?? []);
    const plain = new Map((docsQ.data ?? []).map((doc) => [doc.id, doc.plainText ?? ""]));
    return docTemplateChoices(docTemplates, plain);
  }, [kind, docTemplates, docsQ.data, sheetTemplatesQ.data]);
  const suggestion = useTemplateSuggestion(kind, title, enabled && choices.length > 0);
  const { suggested, rest } = withSuggestion(choices, suggestion?.templateId);
  return {
    kind,
    choices,
    suggested,
    rest,
    logId: suggestion?.logId,
    docTemplates,
    loadError: kind === "sheet" && sheetTemplatesQ.isError ? () => void sheetTemplatesQ.refetch() : undefined,
  };
}

export type NewFileTemplates = ReturnType<typeof useNewFileTemplates>;

/** Creates a doc or sheet, blank or from a template, and reports whether a
 * suggested template was kept. Returns the new file's id. */
export function useCreateFromTemplate() {
  const createDoc = useCreateDoc();
  const createSheet = useCreateSheet();
  async function create(
    templates: NewFileTemplates,
    input: { title: string; templateId?: string; workspaceId?: string },
  ): Promise<string> {
    const typed = input.title.trim();
    let id: string;
    if (templates.kind === "doc") {
      const template = input.templateId ? templates.docTemplates.find((t) => t.id === input.templateId) : undefined;
      if (template) {
        const title = docTitleFromTemplate(template, typed);
        const { content, plainText } = contentFromTemplate(template, templateVars(new Date(), title));
        id = (await createDoc.mutateAsync({ title, icon: template.icon, content, plainText, workspaceId: input.workspaceId })).id;
      } else {
        id = (await createDoc.mutateAsync({ title: typed || "Untitled", workspaceId: input.workspaceId })).id;
      }
    } else if (input.templateId) {
      id = (await createSheet.mutateAsync({ templateId: input.templateId, title: typed || undefined, workspaceId: input.workspaceId })).id;
    } else {
      id = (await createSheet.mutateAsync({ title: typed || "Untitled", workspaceId: input.workspaceId })).id;
    }
    const kept = suggestionKept(templates.suggested?.id, input.templateId);
    if (templates.logId && kept !== undefined) void sendDecisionFeedback(templates.logId, kept).catch(() => {});
    return id;
  }
  return { create, pending: createDoc.isPending || createSheet.isPending };
}

function ChoiceIcon({ choice, kind }: { choice?: TemplateChoice; kind: FileKind }) {
  if (choice?.icon) return <Text style={styles.emoji}>{choice.icon}</Text>;
  const Glyph = !choice ? (kind === "doc" ? FileText : SheetIcon) : LayoutTemplate;
  return (
    <View style={styles.glyph}>
      <Glyph size={16} color={colors.mutedForeground} />
    </View>
  );
}

function ChoiceRow({
  kind,
  choice,
  suggested,
  selected,
  disabled,
  onPress,
}: {
  kind: FileKind;
  choice?: TemplateChoice;
  suggested?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const name = choice ? choice.name : kind === "doc" ? "Blank doc" : "Blank sheet";
  const description = choice ? choice.description : kind === "doc" ? "An empty page" : "An empty grid";
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={suggested ? `Suggested: ${name}` : name}
      accessibilityState={{ selected: Boolean(selected), disabled: Boolean(disabled) }}
      testID={suggested ? "template-suggested" : choice ? `template-${choice.id}` : "template-blank"}
      disabled={disabled}
      onPress={onPress}
      style={[styles.row, suggested && styles.rowSuggested, selected && styles.rowSelected]}
    >
      <ChoiceIcon choice={choice} kind={kind} />
      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {name}
          </Text>
          {suggested ? (
            <View style={styles.badge}>
              <Sparkles size={10} color={colors.primary} />
              <Text style={styles.badgeText}>Suggested</Text>
            </View>
          ) : choice?.mine && kind === "doc" ? (
            <Text style={styles.yours}>Yours</Text>
          ) : null}
        </View>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {description}
        </Text>
      </View>
    </AnimatedPressable>
  );
}

/** Blank first (after the suggestion, when there is one), then every
 * template with its icon, name and one line about what it holds. */
export function TemplateRows({
  templates,
  selectedId,
  disabled,
  onPick,
}: {
  templates: NewFileTemplates;
  /** "" is Blank; undefined marks nothing as picked. */
  selectedId?: string;
  disabled?: boolean;
  onPick: (templateId: string) => void;
}) {
  const { kind, suggested, rest } = templates;
  return (
    <View style={styles.rows}>
      {suggested ? (
        <ChoiceRow kind={kind} choice={suggested} suggested selected={selectedId === suggested.id} disabled={disabled} onPress={() => onPick(suggested.id)} />
      ) : null}
      <ChoiceRow kind={kind} selected={selectedId === ""} disabled={disabled} onPress={() => onPick("")} />
      {rest.length ? <Text style={styles.section}>Templates</Text> : null}
      {rest.map((choice) => (
        <ChoiceRow key={choice.id} kind={kind} choice={choice} selected={selectedId === choice.id} disabled={disabled} onPress={() => onPick(choice.id)} />
      ))}
      {templates.loadError ? (
        <Text style={styles.error} onPress={templates.loadError}>
          Could not load templates. Tap to retry.
        </Text>
      ) : null}
      <Text style={styles.footnote}>
        {kind === "doc"
          ? "Turn any page into a template from its menu. Text like {{date}} is filled in."
          : "Save any sheet as a template from its menu."}
      </Text>
    </View>
  );
}

/** The Files tab's new doc or sheet sheet: an optional name, then one tap
 * on Blank or a template creates the file and opens it. */
export function NewFileSheet({
  kind,
  open,
  onClose,
  workspaceId,
}: {
  kind: FileKind;
  open: boolean;
  onClose: () => void;
  workspaceId?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const templates = useNewFileTemplates(kind, title, open);
  const { create, pending } = useCreateFromTemplate();

  async function pick(templateId: string) {
    try {
      const id = await create(templates, { title, templateId: templateId || undefined, workspaceId });
      onClose();
      router.push(fileHref(id));
    } catch (error) {
      Alert.alert(kind === "doc" ? "Could not create the doc" : "Could not create the sheet", error instanceof Error ? error.message : "Try again.");
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} onClosed={() => setTitle("")} title={kind === "doc" ? "New doc" : "New sheet"}>
      <View style={styles.nameField}>
        <Field
          testID="new-file-name"
          value={title}
          onChangeText={setTitle}
          autoCapitalize="sentences"
          placeholder={kind === "doc" ? "Doc name (optional)" : "Sheet name (optional)"}
        />
      </View>
      <TemplateRows templates={templates} disabled={pending} onPick={(id) => void pick(id)} />
    </BottomSheet>
  );
}

/** The Template row of the quick add form, for a doc or a sheet: opens the
 * picker, and offers the template the name calls for with one tap. */
export function TemplateField({
  templates,
  value,
  onChange,
}: {
  templates: NewFileTemplates;
  value: string;
  onChange: (templateId: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const { kind, choices, suggested } = templates;
  const current = choices.find((choice) => choice.id === value);
  if (!choices.length) return null;
  return (
    <>
      <PropertyRow
        icon={<LayoutTemplate size={16} color={colors.mutedForeground} />}
        label="Template"
        value={current?.name ?? (kind === "doc" ? "Blank doc" : "Blank sheet")}
        onPress={() => setPicking(true)}
      />
      {suggested && value !== suggested.id ? (
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={`Use the suggested template ${suggested.name}`}
          testID="template-suggestion"
          onPress={() => onChange(suggested.id)}
          style={styles.inlineSuggestion}
        >
          <Sparkles size={14} color={colors.primary} />
          <Text numberOfLines={1} style={styles.inlineText}>
            Suggested: <Text style={styles.inlineName}>{suggested.name}</Text>
          </Text>
          <Text style={styles.inlineAction}>Use</Text>
        </AnimatedPressable>
      ) : null}
      <BottomSheet open={picking} onClose={() => setPicking(false)} title="Template">
        <TemplateRows
          templates={templates}
          selectedId={value}
          onPick={(id) => {
            onChange(id);
            setPicking(false);
          }}
        />
      </BottomSheet>
    </>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  nameField: { marginBottom: 10 },
  rows: { gap: 2 },
  row: { minHeight: 52, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "transparent" },
  rowSuggested: { backgroundColor: colors.accent, borderColor: `${colors.primary}55` },
  rowSelected: { borderColor: colors.primary },
  rowText: { flex: 1, minWidth: 0, gap: 1 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTitle: { flexShrink: 1, color: colors.foreground, fontSize: 15, fontWeight: "600" },
  rowMeta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  emoji: { width: 30, fontSize: 19, textAlign: "center" },
  glyph: { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  badge: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: colors.popover },
  badgeText: { color: colors.primary, fontSize: 10, fontWeight: "800", letterSpacing: 0.3, textTransform: "uppercase" },
  yours: { color: colors.mutedForeground, fontSize: 10, fontWeight: "700", letterSpacing: 0.3, textTransform: "uppercase" },
  section: { color: colors.mutedForeground, fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 8, marginBottom: 2, paddingHorizontal: 10 },
  error: { color: colors.destructive, fontSize: 13, paddingHorizontal: 10, paddingTop: 6 },
  footnote: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, paddingHorizontal: 10, paddingTop: 8 },
  inlineSuggestion: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, marginHorizontal: 8, marginBottom: 6, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: `${colors.primary}55`, backgroundColor: colors.card },
  inlineText: { flex: 1, color: colors.mutedForeground, fontSize: 13 },
  inlineName: { color: colors.foreground, fontWeight: "700" },
  inlineAction: { color: colors.primary, fontSize: 13, fontWeight: "800" },
}));
