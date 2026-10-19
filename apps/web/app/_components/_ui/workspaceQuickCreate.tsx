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
import { controlClass } from "@/app/_components/_ui/field";
import { buttonClass } from "@/app/_components/_ui/button";
import { PropertyChip } from "@/app/_components/_ui/propertyChip";
import { ListRow } from "@/app/_components/_ui/groupedList";
import { cn } from "@/app/utils/cn";

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

/**
 * "+ New label" chip that opens a chip-shaped composer in the same row:
 * colour dot, name, Add and close. Enter adds, Escape closes.
 */
export function CreateLabelInline({
  workspaceId,
  onCreated,
  variant = "chip",
}: {
  workspaceId?: string;
  onCreated?: (label: Label) => void;
  /** "row": a "+ New label" row of a grouped card (`ListGroup`). */
  variant?: "chip" | "row";
}) {
  const createLabel = useCreateLabel();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setName("");
    setColor(DEFAULT_COLOR);
    setError(null);
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

    setError(null);
    try {
      const label = await createLabel.mutateAsync({
        workspaceId,
        name: trimmed,
        color,
      });
      close();
      onCreated?.(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create label.");
    }
  };

  if (!open) {
    if (variant === "row") {
      return workspaceId ? (
        <ListRow
          tone="add"
          label="New label"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        />
      ) : null;
    }
    return (
      <PropertyChip
        empty
        icon={<Plus />}
        disabled={!workspaceId}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        New label
      </PropertyChip>
    );
  }

  return (
    <span className={cn("inline-flex flex-col gap-1", variant === "row" && "flex px-2.5 py-1.5")}>
      <span className="inline-flex h-8 items-center gap-1 rounded-[10px] border border-input bg-card pl-1 pr-1 shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        <ColorPicker variant="dot" value={color} onChange={setColor} aria-label="New label colour" />
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            stopEnterSubmit(event);
            if (event.key === "Enter") void submit();
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
          placeholder="Label name"
          aria-label="Label name"
          disabled={!workspaceId || createLabel.isPending}
          className="w-36 min-w-0 bg-transparent text-[13px] font-medium text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground"
        />
        <button
          type="button"
          disabled={!workspaceId || !name.trim() || createLabel.isPending}
          onClick={() => void submit()}
          className={buttonClass({ variant: "soft", size: "sm", className: "h-6 rounded-[8px] px-2" })}
        >
          {createLabel.isPending ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          aria-label="Cancel new label"
          onClick={close}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </span>
      {error && <span className="px-1 text-[11px] text-destructive">{error}</span>}
    </span>
  );
}

export function CreateCustomFieldInline({
  workspaceId,
  onCreated,
  variant = "chip",
}: {
  workspaceId?: string;
  onCreated?: (field: CustomField) => void;
  /** "row": a "+ New field" row of a grouped card (`ListGroup`). */
  variant?: "chip" | "row";
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
    if (variant === "row") {
      return workspaceId ? (
        <ListRow
          tone="add"
          label="New field"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        />
      ) : null;
    }
    return (
      <PropertyChip
        empty
        icon={<Plus />}
        disabled={!workspaceId}
        className="mt-1 ml-1.5 self-start"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        New custom field
      </PropertyChip>
    );
  }

  return (
    <div className={cn(variant === "row" ? "m-2" : "mt-2", "rounded-lg border border-border bg-background/60 p-2")}>
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
          className={controlClass("md", "w-full")}
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
                  variant="dot"
                  aria-label={`Option ${index + 1} colour`}
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
                  className={controlClass("md", "min-w-0 flex-1")}
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
            className={buttonClass({ variant: "secondary", size: "sm" })}
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
