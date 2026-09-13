"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import ColorPicker from "@/app/_components/_ui/colorPicker";
import Select from "@/app/_components/_ui/select";
import {
  CustomField,
  CustomFieldType,
  Label,
} from "@/app/_types/types";
import {
  useCreateCustomField,
  useCreateLabel,
} from "@/app/utils/hooks/workspaces";

const DEFAULT_COLOR = "#889096";

const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "url", label: "URL" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi select" },
];

function needsOptions(type: CustomFieldType) {
  return type === "select" || type === "multi_select";
}

type OptionDraft = { value: string; color: string };

function stopEnterSubmit(event: React.KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
  }
}

export function CreateLabelInline({
  workspaceId,
  onCreated,
}: {
  workspaceId?: string;
  onCreated?: (label: Label) => void;
}) {
  const createLabel = useCreateLabel();
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (!workspaceId) {
      setError("Select a workspace first.");
      return;
    }
    if (!trimmed) {
      setError("Name is required.");
      return;
    }

    setError(null);
    try {
      const label = await createLabel.mutateAsync({
        workspaceId,
        name: trimmed,
        color,
      });
      setName("");
      setColor(DEFAULT_COLOR);
      onCreated?.(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create label.");
    }
  };

  return (
    <div className="mt-2 px-1">
      <div className="flex items-center gap-1.5">
        <ColorPicker
          value={color}
          onChange={setColor}
          aria-label="New label color"
        />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            stopEnterSubmit(event);
            if (event.key === "Enter") void submit();
          }}
          placeholder="New label"
          disabled={!workspaceId || createLabel.isPending}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          title="Create label"
          disabled={!workspaceId || createLabel.isPending}
          onClick={() => void submit()}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

export function CreateCustomFieldInline({
  workspaceId,
  onCreated,
}: {
  workspaceId?: string;
  onCreated?: (field: CustomField) => void;
}) {
  const createCustomField = useCreateCustomField();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState<OptionDraft[]>([
    { value: "", color: DEFAULT_COLOR },
  ]);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setType("text");
    setOptions([{ value: "", color: DEFAULT_COLOR }]);
    setError(null);
    setOpen(false);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!workspaceId) {
      setError("Select a workspace first.");
      return;
    }
    if (!trimmed) {
      setError("Name is required.");
      return;
    }

    const cleaned = options
      .map((option) => ({
        value: option.value.trim(),
        color: option.color || DEFAULT_COLOR,
      }))
      .filter((option) => option.value.length > 0);

    if (needsOptions(type) && cleaned.length === 0) {
      setError("Add at least one option.");
      return;
    }

    setError(null);
    try {
      const field = await createCustomField.mutateAsync({
        workspaceId,
        name: trimmed,
        type,
        options: needsOptions(type) ? cleaned : undefined,
      });
      reset();
      onCreated?.(field);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create custom field.",
      );
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        disabled={!workspaceId}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="mt-2 inline-flex cursor-pointer items-center gap-1 px-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        New custom field
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-border bg-background/60 p-2">
      <div className="flex flex-col gap-2">
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            stopEnterSubmit(event);
            if (event.key === "Enter" && !needsOptions(type)) void submit();
          }}
          placeholder="Field name"
          className="w-full rounded-md border border-border bg-input/30 px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/40"
        />
        <Select
          size="sm"
          value={type}
          onChange={(next) => setType(next as CustomFieldType)}
          options={FIELD_TYPES}
          aria-label="Field type"
        />
        {needsOptions(type) && (
          <div className="flex flex-col gap-1.5">
            {options.map((option, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <ColorPicker
                  value={option.color}
                  onChange={(color) => {
                    const next = [...options];
                    next[index] = { ...option, color };
                    setOptions(next);
                  }}
                />
                <input
                  value={option.value}
                  onChange={(event) => {
                    const next = [...options];
                    next[index] = { ...option, value: event.target.value };
                    setOptions(next);
                  }}
                  onKeyDown={stopEnterSubmit}
                  placeholder={`Option ${index + 1}`}
                  className="min-w-0 flex-1 rounded-md border border-border bg-input/30 px-2 py-1 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
                />
                <button
                  type="button"
                  aria-label="Remove option"
                  onClick={() =>
                    setOptions(options.filter((_, i) => i !== index))
                  }
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setOptions([...options, { value: "", color: DEFAULT_COLOR }])
              }
              className="self-start text-[11px] text-muted-foreground hover:text-foreground"
            >
              + Add option
            </button>
          </div>
        )}
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={reset}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={createCustomField.isPending}
            onClick={() => void submit()}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground hover:bg-accent disabled:opacity-60"
          >
            <Plus className="size-3" />
            {createCustomField.isPending ? "Adding..." : "Add field"}
          </button>
        </div>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
    </div>
  );
}
