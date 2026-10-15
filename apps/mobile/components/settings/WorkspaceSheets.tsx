import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { Trash2 } from "lucide-react-native";
import BottomSheet from "../ui/BottomSheet";
import ConfirmSheet, { type ConfirmRequest } from "../ui/ConfirmSheet";
import { Button, Field, PrimaryButton, Select } from "../ui/primitives";
import { ColourField } from "../ui/ColourSheet";
import { colorForIndex } from "../../lib/entityColor";
import {
  FIELD_TYPES,
  OptionList,
  cleanedOptions,
  needsOptions,
  type OptionDraft,
} from "../ui/CustomFieldBuilder";
import { ColorDot, ListGroup, ListRow } from "./SettingsList";
import { useToastStore } from "../../lib/toast";
import type { CustomField, CustomFieldType } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";

function failed(error: unknown, fallback: string) {
  useToastStore.getState().show(error instanceof Error ? error.message : fallback);
}

/**
 * A sheet with one text field and its button in the footer: rename a
 * workspace, name a new workspace or project.
 */
export function NameSheet({
  open,
  onClose,
  title,
  subtitle,
  label,
  initial = "",
  placeholder,
  submitLabel,
  onSubmit,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  label: string;
  initial?: string;
  placeholder?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  /** Extra content under the field (a hint). */
  children?: ReactNode;
}) {
  const [name, setName] = useState(initial);
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  if (open && !seeded) {
    setSeeded(true);
    setName(initial);
  }
  if (!open && seeded) setSeeded(false);
  const trimmed = name.trim();
  const submit = async () => {
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (error) {
      failed(error, "Could not save");
    } finally {
      setSaving(false);
    }
  };
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={<PrimaryButton label={submitLabel} loading={saving} disabled={!trimmed || trimmed === initial.trim()} onPress={() => void submit()} />}
    >
      <View style={styles.form}>
        <Field label={label} value={name} onChangeText={setName} placeholder={placeholder} autoCapitalize="words" autoFocus />
        {children}
      </View>
    </BottomSheet>
  );
}

type NamedColorItem = { id: string; name: string; color: string; isDefault?: boolean };

/**
 * Manage a workspace's statuses or labels in one sheet: the list, "+ New",
 * and an edit page per item (name, colour, delete) with Save in the footer.
 */
export function NamedColorSheet({
  open,
  onClose,
  noun,
  title,
  subtitle,
  items,
  top,
  hint,
  onCreate,
  onUpdate,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  /** "status" or "label", for button and confirm copy. */
  noun: string;
  title: string;
  subtitle?: string;
  items: NamedColorItem[];
  /** Suggestions shown above the list (cleanup, starter labels). */
  top?: (confirm: (request: ConfirmRequest) => void) => ReactNode;
  hint?: string;
  onCreate: (data: { name: string; color: string }) => Promise<void>;
  onUpdate: (id: string, data: { name: string; color: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<NamedColorItem | "new" | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(colorForIndex(0));
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);

  const openItem = (item: NamedColorItem | "new") => {
    setEditing(item);
    setName(item === "new" ? "" : item.name);
    setColor(item === "new" ? colorForIndex(items.length) : item.color || colorForIndex(0));
  };
  const trimmed = name.trim();
  const save = async () => {
    if (!trimmed || !editing || saving) return;
    setSaving(true);
    try {
      if (editing === "new") await onCreate({ name: trimmed, color });
      else await onUpdate(editing.id, { name: trimmed, color });
      setEditing(null);
    } catch (error) {
      failed(error, `Could not save the ${noun}`);
    } finally {
      setSaving(false);
    }
  };
  const current = editing && editing !== "new" ? editing : null;

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        setEditing(null);
        onClose();
      }}
      title={title}
      subtitle={subtitle}
    >
      <View style={styles.list}>
        {top?.(setConfirm)}
        <ListGroup>
          {items.map((item) => (
            <ListRow
              key={item.id}
              testID={`${noun}-row`}
              title={item.name}
              leading={<ColorDot color={item.color} />}
              trailing={item.isDefault ? "Default" : undefined}
              onPress={() => openItem(item)}
            />
          ))}
          <ListRow key="__new" tone="add" title={`New ${noun}`} onPress={() => openItem("new")} testID={`${noun}-new`} />
        </ListGroup>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <BottomSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={current ? `Edit ${noun}` : `New ${noun}`}
        footer={
          <PrimaryButton
            label={current ? `Save ${noun}` : `Add ${noun}`}
            loading={saving}
            disabled={!trimmed}
            onPress={() => void save()}
          />
        }
      >
        <View style={styles.form}>
          <Field label="Name" value={name} onChangeText={setName} placeholder={`${Noun} name`} autoCapitalize="words" />
          <ColourField value={color} onChange={setColor} subtitle={trimmed || undefined} />
          {current ? (
            <View style={styles.deleteRow}>
              <Button
                label={`Delete ${noun}`}
                variant="destructive-ghost"
                size="sm"
                icon={<Trash2 size={16} color={colors.destructive} />}
                onPress={() =>
                  setConfirm({
                    title: `Delete “${current.name}”?`,
                    message: noun === "status"
                      ? "Tasks and projects with this status lose it. This cannot be undone."
                      : "It comes off every task that has it. This cannot be undone.",
                    onConfirm: async () => {
                      try {
                        await onDelete(current.id);
                        setEditing(null);
                      } catch (error) {
                        failed(error, `Could not delete the ${noun}`);
                      }
                    },
                  })
                }
              />
            </View>
          ) : null}
        </View>
      </BottomSheet>
      <ConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ""}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        onConfirm={() => confirm?.onConfirm()}
      />
    </BottomSheet>
  );
}

export function fieldMeta(field: CustomField) {
  const typeLabel = FIELD_TYPES.find((item) => item.value === field.type)?.label ?? field.type;
  if (!needsOptions(field.type)) return typeLabel;
  const count = field.options?.options?.length ?? 0;
  return `${typeLabel} · ${count} option${count === 1 ? "" : "s"}`;
}

/**
 * Manage a workspace's custom fields: the list, "+ New field", and a page per
 * field (name, type, option values, delete) with Save in the footer.
 */
export function CustomFieldsSheet({
  open,
  onClose,
  subtitle,
  fields,
  top,
  onCreate,
  onUpdate,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  subtitle?: string;
  fields: CustomField[];
  top?: (confirm: (request: ConfirmRequest) => void) => ReactNode;
  onCreate: (data: { name: string; type: CustomFieldType; options?: OptionDraft[] }) => Promise<void>;
  onUpdate: (id: string, data: { name: string; type: CustomFieldType; options?: OptionDraft[] }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<CustomField | "new" | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldType>("select");
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const openField = (field: CustomField | "new") => {
    setEditing(field);
    setError(null);
    if (field === "new") {
      setName("");
      setType("select");
      setOptions([{ value: "", color: colorForIndex(0) }]);
      return;
    }
    setName(field.name);
    setType(field.type);
    setOptions(
      field.options?.options?.length
        ? field.options.options.map((option) => ({ id: option.id, value: option.value, color: option.color || colorForIndex(0) }))
        : [{ value: "", color: colorForIndex(0) }],
    );
  };
  const current = editing && editing !== "new" ? editing : null;
  const trimmed = name.trim();

  const save = async () => {
    if (!trimmed || !editing || saving) return;
    const cleaned = cleanedOptions(options);
    if (needsOptions(type) && cleaned.length === 0) {
      setError("Add at least one option value.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const data = { name: trimmed, type, options: needsOptions(type) ? cleaned : undefined };
      if (editing === "new") await onCreate(data);
      else await onUpdate(editing.id, data);
      setEditing(null);
    } catch (cause) {
      failed(cause, "Could not save the field");
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        setEditing(null);
        onClose();
      }}
      title="Custom fields"
      subtitle={subtitle}
    >
      <View style={styles.list}>
        {top?.(setConfirm)}
        <ListGroup>
          {fields.map((field) => (
            <ListRow key={field.id} testID="field-row" title={field.name} trailing={fieldMeta(field)} onPress={() => openField(field)} />
          ))}
          <ListRow key="__new" tone="add" title="New field" onPress={() => openField("new")} testID="field-new" />
        </ListGroup>
        <Text style={styles.hint}>Fields show on every task and project in this workspace.</Text>
      </View>
      <BottomSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={current ? "Edit field" : "New field"}
        footer={<PrimaryButton label={current ? "Save field" : "Add field"} loading={saving} disabled={!trimmed} onPress={() => void save()} />}
      >
        <View style={styles.form}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="Field name" autoCapitalize="words" />
          <Select label="Type" value={type} onChange={(next) => setType(next as CustomFieldType)} options={FIELD_TYPES} />
          {needsOptions(type) ? <OptionList options={options} onChange={setOptions} /> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {current ? (
            <View style={styles.deleteRow}>
              <Button
                label="Delete field"
                variant="destructive-ghost"
                size="sm"
                icon={<Trash2 size={16} color={colors.destructive} />}
                onPress={() =>
                  setConfirm({
                    title: `Delete “${current.name}”?`,
                    message: "Its values come off every task and project. This cannot be undone.",
                    onConfirm: async () => {
                      try {
                        await onDelete(current.id);
                        setEditing(null);
                      } catch (cause) {
                        failed(cause, "Could not delete the field");
                      }
                    },
                  })
                }
              />
            </View>
          ) : null}
        </View>
      </BottomSheet>
      <ConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ""}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        onConfirm={() => confirm?.onConfirm()}
      />
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  list: { gap: 10, paddingBottom: 4 },
  form: { gap: 14, paddingBottom: 4 },
  hint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
  error: { color: colors.destructive, fontSize: 13 },
  deleteRow: { alignItems: "flex-start", marginLeft: -12 },
}));
