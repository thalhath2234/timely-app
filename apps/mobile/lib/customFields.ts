import type { CustomField, CustomFieldValueInput, TaskCustomFieldValue } from "./types";

export function emptyCustomFieldDrafts(fields: CustomField[] = []): CustomFieldValueInput[] {
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
    let stringValue = match?.stringValue ?? "";
    if (!stringValue && match?.boolValue != null) stringValue = match.boolValue ? "true" : "false";
    return {
      id: field.id,
      type: field.type,
      stringValue,
      optionsValue: (match?.optionValue ?? []).map((option) => ({ id: option.id })),
    };
  });
}

export function findCustomFieldDraft(drafts: CustomFieldValueInput[], fieldId: string) {
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

export function filledCustomFieldValues(drafts: CustomFieldValueInput[]): CustomFieldValueInput[] {
  return drafts.filter((draft) => {
    if (draft.type === "select" || draft.type === "multi_select") {
      return (draft.optionsValue ?? []).length > 0;
    }
    if (draft.type === "boolean") {
      return draft.stringValue === "true" || draft.stringValue === "false";
    }
    return Boolean(draft.stringValue?.trim());
  });
}
