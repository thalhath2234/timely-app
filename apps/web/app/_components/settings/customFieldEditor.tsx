"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import ColorPicker from "@/app/_components/_ui/colorPicker";
import Select from "@/app/_components/_ui/select";
import {
  CustomField,
  CustomFieldType,
} from "@/app/_types/types";

const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "url", label: "URL" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi select" },
];

const DEFAULT_OPTION_COLOR = "#889096";

type OptionDraft = { value: string; color: string };

type CustomFieldEditorProps = {
  fields: CustomField[];
  onCreate: (payload: {
    name: string;
    type: CustomFieldType;
    options?: OptionDraft[];
  }) => Promise<void>;
  onUpdate: (
    id: string,
    payload: {
      name: string;
      type: CustomFieldType;
      options?: OptionDraft[];
    },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

function needsOptions(type: CustomFieldType) {
  return type === "select" || type === "multi_select";
}

export default function CustomFieldEditor({
  fields,
  onCreate,
  onUpdate,
  onDelete,
}: CustomFieldEditorProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState<OptionDraft[]>([
    { value: "", color: DEFAULT_OPTION_COLOR },
  ]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<CustomFieldType>("text");
  const [editOptions, setEditOptions] = useState<OptionDraft[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (field: CustomField) => {
    setEditingId(field.id);
    setEditName(field.name);
    setEditType(field.type);
    setEditOptions(
      field.options?.options?.length
        ? field.options.options.map((option) => ({
            value: option.value,
            color: option.color || DEFAULT_OPTION_COLOR,
          }))
        : [{ value: "", color: DEFAULT_OPTION_COLOR }],
    );
    setError(null);
  };

  const cleanedOptions = (drafts: OptionDraft[]) =>
    drafts
      .map((option) => ({
        value: option.value.trim(),
        color: option.color || DEFAULT_OPTION_COLOR,
      }))
      .filter((option) => option.value.length > 0);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Field name is required.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        type,
        options: needsOptions(type) ? cleanedOptions(options) : undefined,
      });
      setName("");
      setType("text");
      setOptions([{ value: "", color: DEFAULT_OPTION_COLOR }]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create custom field.",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) {
      setError("Field name is required.");
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      await onUpdate(id, {
        name: editName.trim(),
        type: editType,
        options: needsOptions(editType)
          ? cleanedOptions(editOptions)
          : undefined,
      });
      setEditingId(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update custom field.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await onDelete(id);
      if (editingId === id) setEditingId(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete custom field.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium text-foreground">Custom fields</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Extra fields available when creating tasks and projects in this
          workspace.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {fields.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            No custom fields yet.
          </p>
        ) : (
          fields.map((field) => {
            const editing = editingId === field.id;
            return (
              <div
                key={field.id}
                className="rounded-lg border border-border bg-muted/20 p-3"
              >
                {editing ? (
                  <div className="flex flex-col gap-2">
                    <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
                      <input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        className="rounded-lg border border-border bg-input/30 px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/40"
                      />
                      <Select
                        size="sm"
                        value={editType}
                        onChange={(next) =>
                          setEditType(next as CustomFieldType)
                        }
                        options={FIELD_TYPES}
                      />
                    </div>
                    {needsOptions(editType) && (
                      <OptionList
                        options={editOptions}
                        onChange={setEditOptions}
                      />
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyId === field.id}
                        onClick={() => handleUpdate(field.id)}
                        className="cursor-pointer rounded-lg bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="cursor-pointer rounded-lg bg-secondary px-2 py-1.5 text-xs text-secondary-foreground hover:bg-accent"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {field.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {FIELD_TYPES.find((item) => item.value === field.type)
                          ?.label ?? field.type}
                        {needsOptions(field.type) &&
                          field.options?.options?.length
                          ? ` · ${field.options.options.length} options`
                          : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Edit ${field.name}`}
                      onClick={() => startEdit(field)}
                      className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${field.name}`}
                      disabled={busyId === field.id}
                      onClick={() => handleDelete(field.id)}
                      className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-60"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-xs font-medium text-foreground">
          Add custom field
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Field name"
            className="rounded-lg border border-border bg-input/30 px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/40"
          />
          <Select
            size="sm"
            value={type}
            onChange={(next) => setType(next as CustomFieldType)}
            options={FIELD_TYPES}
          />
        </div>
        {needsOptions(type) && (
          <div className="mt-2">
            <OptionList options={options} onChange={setOptions} />
          </div>
        )}
        <button
          type="button"
          disabled={creating}
          onClick={handleCreate}
          className="mt-3 inline-flex cursor-pointer items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-accent disabled:opacity-60"
        >
          <Plus className="size-3.5" />
          Add field
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}

function OptionList({
  options,
  onChange,
}: {
  options: OptionDraft[];
  onChange: (next: OptionDraft[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted-foreground">Options</p>
      {options.map((option, index) => (
        <div key={index} className="flex items-center gap-2">
          <ColorPicker
            value={option.color}
            onChange={(color) => {
              const next = [...options];
              next[index] = { ...option, color };
              onChange(next);
            }}
          />
          <input
            value={option.value}
            onChange={(event) => {
              const next = [...options];
              next[index] = { ...option, value: event.target.value };
              onChange(next);
            }}
            placeholder={`Option ${index + 1}`}
            className="min-w-0 flex-1 rounded-lg border border-border bg-input/30 px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/40"
          />
          <button
            type="button"
            aria-label="Remove option"
            onClick={() => onChange(options.filter((_, i) => i !== index))}
            className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([...options, { value: "", color: DEFAULT_OPTION_COLOR }])
        }
        className="self-start text-xs text-muted-foreground hover:text-foreground"
      >
        + Add option
      </button>
    </div>
  );
}
