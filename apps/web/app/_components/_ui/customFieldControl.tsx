"use client";

import {
  CalendarDays,
  CircleDot,
  Hash,
  Link2,
  Tags,
  ToggleLeft,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import DatePicker from "@/app/_components/_ui/datePicker";
import Select from "@/app/_components/_ui/select";
import {
  CustomField,
  CustomFieldType,
  CustomFieldValueInput,
  TaskCustomFieldValue,
} from "@/app/_types/types";
import { cn } from "@/app/utils/cn";

export function customFieldIcon(type: CustomFieldType): LucideIcon {
  switch (type) {
    case "number":
      return Hash;
    case "url":
      return Link2;
    case "date":
      return CalendarDays;
    case "boolean":
      return ToggleLeft;
    case "select":
      return CircleDot;
    case "multi_select":
      return Tags;
    default:
      return Type;
  }
}

const inputClass =
  "w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground";

/** A blank draft per workspace field, so fields without a value stay editable. */
export function emptyCustomFieldDrafts(
  fields: CustomField[] = [],
): CustomFieldValueInput[] {
  return fields.map((field) => ({
    id: field.id,
    type: field.type,
    stringValue: "",
    optionsValue: [],
  }));
}

/** Merge saved API values onto one draft per workspace field. */
export function toCustomFieldDrafts(
  fields: CustomField[] = [],
  saved: TaskCustomFieldValue[] = [],
): CustomFieldValueInput[] {
  return fields.map((field) => {
    const match = saved.find((value) => value.customFieldId === field.id);

    return {
      id: field.id,
      type: field.type,
      stringValue: match?.stringValue ?? "",
      optionsValue: (match?.optionValue ?? []).map((option) => ({
        id: option.id,
      })),
    };
  });
}

export function findCustomFieldDraft(
  drafts: CustomFieldValueInput[],
  fieldId: string,
): CustomFieldValueInput | undefined {
  return drafts.find((draft) => draft.id === fieldId);
}

export function withCustomFieldDraft(
  drafts: CustomFieldValueInput[],
  field: CustomField,
  next: Pick<CustomFieldValueInput, "stringValue" | "optionsValue">,
): CustomFieldValueInput[] {
  const entry: CustomFieldValueInput = {
    id: field.id,
    type: field.type,
    stringValue: next.stringValue ?? "",
    optionsValue: next.optionsValue ?? [],
  };

  const index = drafts.findIndex((draft) => draft.id === field.id);
  if (index === -1) return [...drafts, entry];

  const copy = [...drafts];
  copy[index] = entry;
  return copy;
}

type CustomFieldControlProps = {
  field: CustomField;
  value?: CustomFieldValueInput;
  onChange: (next: Pick<CustomFieldValueInput, "stringValue" | "optionsValue">) => void;
};

export default function CustomFieldControl({
  field,
  value,
  onChange,
}: CustomFieldControlProps) {
  const stringValue = value?.stringValue ?? "";
  const selectedIds = (value?.optionsValue ?? []).map((option) => option.id);
  const options = field.options?.options ?? [];

  if (field.type === "select") {
    return (
      <Select
        size="sm"
        value={selectedIds[0] ?? ""}
        onChange={(optionId) =>
          onChange({ optionsValue: optionId ? [{ id: optionId }] : [] })
        }
        placeholder="Empty"
        aria-label={field.name}
        className="border-0 bg-transparent px-0 shadow-none"
        options={[
          { value: "", label: "Empty" },
          ...options.map((option) => ({
            value: option.id,
            label: option.value,
            color: option.color,
          })),
        ]}
      />
    );
  }

  if (field.type === "multi_select") {
    if (options.length === 0) {
      return <span className="text-xs text-muted-foreground">No options</span>;
    }

    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = selectedIds.includes(option.id);

          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() =>
                onChange({
                  optionsValue: (active
                    ? selectedIds.filter((id) => id !== option.id)
                    : [...selectedIds, option.id]
                  ).map((id) => ({ id })),
                })
              }
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors",
                active
                  ? "border-transparent"
                  : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
              style={
                active && option.color
                  ? {
                      backgroundColor: `${option.color}33`,
                      borderColor: `${option.color}88`,
                      color: option.color,
                    }
                  : undefined
              }
            >
              {option.value}
            </button>
          );
        })}
      </div>
    );
  }

  if (field.type === "date") {
    return (
      <DatePicker
        mode="date"
        value={stringValue}
        onChange={(next) => onChange({ stringValue: next })}
        aria-label={field.name}
      />
    );
  }

  if (field.type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={stringValue === "true"}
        aria-label={field.name}
        onChange={(event) =>
          onChange({ stringValue: event.target.checked ? "true" : "false" })
        }
        className="size-4 cursor-pointer rounded border-border accent-primary"
      />
    );
  }

  return (
    <input
      type={field.type === "number" ? "number" : field.type === "url" ? "url" : "text"}
      value={stringValue}
      aria-label={field.name}
      placeholder={field.type === "url" ? "https://" : "Empty"}
      onChange={(event) => onChange({ stringValue: event.target.value })}
      className={inputClass}
    />
  );
}
