import { useAssistant } from "../../lib/chat/runtime";
import { useState } from "react";
import { receiptReviewProblems } from "../../lib/chat/receiptReview";
import { CalendarDays, ChevronDown, ChevronUp } from "lucide-react-native";
import DateTimeSheet from "../ui/DateTimeSheet";
import AnimatedPressable from "../ui/AnimatedPressable";
import { toDateInputValue } from "../../lib/format";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { Switch, Text, View } from "react-native";
import type {
  Chat,
  ReceiptDraft,
  ReceiptDestination,
} from "../../lib/chat/types";
import {
  useSheetQuery,
  useSheetsQuery,
  useWorkspacesQuery,
} from "../../lib/hooks";
import { Field, Select } from "../ui/primitives";
import {
  receiptDestination,
  receiptTabId,
  receiptTabs,
} from "./receiptDestination";
import ImagePreview from "./ImagePreview";
import { Action, styles } from "./shared";
export default function ReceiptReview({
  chat,
  pending,
  act,
  onDirty,
  onImage,
}: {
  chat: Chat;
  pending: boolean;
  act: (action: string, body?: unknown) => void;
  onDirty: () => void;
  onImage: (uri: string) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [today] = useState(() => toDateInputValue(new Date()));
  const review = chat.imageReview!;
  const assistant = useAssistant();
  const signature = JSON.stringify([review.receipt, review.destination]);
  const saved = assistant.cache.receiptEdits[chat.id];
  const edit =
    saved?.signature === signature
      ? saved
      : {
          signature,
          draft: { ...review.receipt!, date: review.receipt!.date || today },
          destination: review.destination,
          reviewed: false,
          dirty: false,
        };
  const draft = { ...edit.draft, date: edit.draft.date || today };
  const chosen = edit.destination;
  const reviewed = edit.reviewed;
  function saveEdit(patch: Partial<typeof edit>) {
    onDirty();
    assistant.updateCache((cache) => ({
      ...cache,
      receiptEdits: {
        ...cache.receiptEdits,
        [chat.id]: { ...edit, ...patch, dirty: true },
      },
    }));
  }
  const sheetsQuery = useSheetsQuery();
  const sheets = sheetsQuery.data ?? [];
  const spaces = useWorkspacesQuery().data ?? [];
  const base = chosen ?? receiptDestination(chat.context, sheets);
  const sheetQuery = useSheetQuery(base.sheetId);
  const sheet = sheetQuery.data;
  const destination = {
    ...base,
    expenseTabId: base.expenseTabId || receiptTabId(chat.context, sheet),
  };
  const parsedDate = draft.date ? new Date(`${draft.date}T00:00:00`) : null;
  const pickerDate =
    parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;
  const problems = receiptReviewProblems(draft);
  const destinationLoading =
    sheetsQuery.isLoading || (!!base.sheetId && sheetQuery.isLoading);
  const destinationError =
    sheetsQuery.error || (base.sheetId && sheetQuery.error);
  const needsAcknowledgement = !!draft.issues?.length && !reviewed;
  const disabled = pending || ["queued", "running"].includes(chat.status);
  function update(patch: Partial<ReceiptDraft>) {
    saveEdit({ draft: { ...draft, ...patch } });
  }
  function dest(patch: Partial<ReceiptDestination>) {
    saveEdit({ destination: { ...destination, ...patch } });
  }
  return (
    <View style={{ gap: 16 }}>
      <Text style={[styles.text, { fontWeight: "700", fontSize: 22 }]}>
        Check your receipt
      </Text>
      <Text style={styles.muted}>1. Check details → 2. Confirm and save</Text>
      <Text style={styles.muted}>
        Check the total and items, then choose where to save. Tap an item to
        correct it.
      </Text>
      {(chat.images ?? [])
        .filter((image) => review.imageIds.includes(image.id))
        .map((image) => (
          <View
            key={image.id}
            style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <ImagePreview image={image} onOpen={onImage} />
            <Text style={styles.muted}>
              Tap the photo to view the original receipt.
            </Text>
          </View>
        ))}
      <View
        pointerEvents={disabled ? "none" : "auto"}
        style={[{ gap: 16 }, disabled && { opacity: 0.5 }]}
      >
        {!!draft.issues?.length && (
          <View style={styles.stack}>
            <Text style={styles.text}>Needs your review</Text>
            {draft.issues.map((issue, i) => (
              <Text key={i} style={styles.muted}>
                • {issue}
              </Text>
            ))}
            <Toggle
              label="I checked the image and corrected these uncertainties"
              value={reviewed}
              change={(value) => {
                saveEdit({ reviewed: value });
              }}
            />
          </View>
        )}
        {(
          [
            ["merchant", "Merchant *"],
            ["date", "Receipt date *"],
            ["currency", "Currency *"],
            ["total", "Receipt total *"],
          ] as const
        ).map(([key, label]) => (
          <View key={key} style={styles.stack}>
            <Text style={styles.muted}>{label}</Text>
            {key === "date" ? (
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel="Receipt date"
                accessibilityState={{ disabled, expanded: datePickerOpen }}
                disabled={disabled}
                onPress={() => setDatePickerOpen(true)}
                style={dateStyles.trigger}
              >
                <Text style={styles.text}>{draft.date}</Text>
                <CalendarDays size={18} color={colors.mutedForeground} />
              </AnimatedPressable>
            ) : (
              <Field
                value={draft[key] ?? ""}
                placeholder={label}
                onChangeText={(value) =>
                  update({
                    [key]: key === "currency" ? value.toUpperCase() : value,
                  })
                }
              />
            )}
          </View>
        ))}
        <Action
          label={
            detailsOpen
              ? "Hide tax and other details"
              : "Tax, discounts and other details"
          }
          onPress={() => setDetailsOpen(!detailsOpen)}
        />
        {detailsOpen && (
          <View style={dateStyles.card}>
            {(
              [
                ["category", "Category"],
                ["subtotal", "Subtotal"],
                ["tax", "Tax"],
                ["tip", "Tip"],
                ["discount", "Discount"],
              ] as const
            ).map(([key, label]) => (
              <View key={key} style={styles.stack}>
                <Text style={styles.muted}>{label}</Text>
                <Field
                  value={draft[key] ?? ""}
                  placeholder={label}
                  onChangeText={(value) => update({ [key]: value })}
                />
              </View>
            ))}
            <Toggle
              label="Tax is already included in item prices"
              value={draft.taxIncluded}
              change={(value) => update({ taxIncluded: value })}
            />
            <Toggle
              label="Discount is already included in item amounts and subtotal"
              value={draft.discountIncluded ?? false}
              change={(value) => update({ discountIncluded: value })}
            />
          </View>
        )}
        <Text style={[styles.text, { fontWeight: "700" }]}>
          Individual items ({draft.items.length})
        </Text>
        {!draft.items.length && (
          <Text style={styles.muted}>
            No individual items were extracted. One summary item will use the
            merchant and full receipt total. Tax, tips and discounts are already
            included in that total.
          </Text>
        )}
        {draft.items.map((item, i) => (
          <View key={i} style={dateStyles.card}>
            <AnimatedPressable
              accessibilityRole="button"
              accessibilityLabel={`Edit item ${i + 1}: ${item.description || "Missing name"}`}
              accessibilityState={{ expanded: editingItem === i }}
              onPress={() => setEditingItem(editingItem === i ? null : i)}
              style={dateStyles.itemRow}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.text}>
                  {item.description || "Missing item name"}
                </Text>
                <Text style={styles.muted}>
                  {item.quantity ? `${item.quantity} × ` : ""}
                  {item.unitPrice || ""}
                  {item.category ? ` · ${item.category}` : ""}
                </Text>
              </View>
              <Text style={[styles.text, { fontWeight: "700" }]}>
                {draft.currency} {item.amount || "—"}
              </Text>
              {editingItem === i ? (
                <ChevronUp size={18} color={colors.mutedForeground} />
              ) : (
                <ChevronDown size={18} color={colors.mutedForeground} />
              )}
            </AnimatedPressable>
            {editingItem === i && (
              <>
                {(
                  [
                    ["description", "Description *"],
                    ["quantity", "Quantity"],
                    ["unitPrice", "Unit price"],
                    ["amount", "Amount *"],
                    ["category", "Category"],
                  ] as const
                ).map(([key, label]) => (
                  <View key={key} style={{ marginTop: 8 }}>
                    <Text style={styles.muted}>{label}</Text>
                    <Field
                      value={item[key] ?? ""}
                      placeholder={label}
                      onChangeText={(value) =>
                        update({
                          items: draft.items.map((row, index) =>
                            index === i ? { ...row, [key]: value } : row,
                          ),
                        })
                      }
                    />
                  </View>
                ))}
                <Action
                  label={`Remove item ${i + 1}`}
                  onPress={() => {
                    update({
                      items: draft.items.filter((_, index) => index !== i),
                    });
                    setEditingItem(null);
                  }}
                />
              </>
            )}
          </View>
        ))}
        <Action
          label="Add missing item"
          disabled={draft.items.length >= 300}
          onPress={() => {
            setEditingItem(draft.items.length);
            update({
              items: [
                ...draft.items,
                {
                  description: "",
                  quantity: "",
                  unitPrice: "",
                  amount: "",
                  category: "",
                },
              ],
            });
          }}
        />
        <Text style={styles.muted}>
          Amounts, tax, tips and discounts must reconcile with the total. Blank
          optional fields stay unknown. Currencies are never converted or
          combined.
        </Text>
        {!!review.duplicates?.length && (
          <View style={styles.stack}>
            <Text style={styles.text}>Possible duplicate receipt</Text>
            <Action
              label="Skip this receipt"
              onPress={() => act("/images/discard")}
            />
            <Action
              label={
                destination.duplicateAction === "add"
                  ? "Add anyway ✓"
                  : "Add anyway"
              }
              onPress={() =>
                dest({ duplicateAction: "add", duplicateRowId: "" })
              }
            />
            <Select
              placeholder="Update an existing receipt"
              value={
                destination.duplicateAction === "update"
                  ? destination.duplicateRowId
                  : ""
              }
              options={(review.duplicates ?? []).map((match) => ({
                value: match.rowId,
                label: `${match.sheetTitle} · ${match.date} · ${match.currency} ${match.total} · ${match.itemMatch === "same" ? "same items" : match.itemMatch === "different" ? "items differ" : ""}`,
              }))}
              onChange={(id) => {
                const match = review.duplicates?.find(
                  (item) => item.rowId === id,
                );
                if (match)
                  dest({
                    sheetId: match.sheetId,
                    expenseTabId: match.tabId,
                    duplicateAction: "update",
                    duplicateRowId: match.rowId,
                  });
              }}
            />
          </View>
        )}
        <Text style={[styles.text, { fontWeight: "700" }]}>Save to</Text>
        <Select
          placeholder="Expense sheet"
          value={destination.sheetId}
          options={[
            { value: "", label: "Create a new expense sheet" },
            ...sheets
              .filter((s) => !s.archivedAt)
              .map((s) => ({ value: s.id, label: s.title })),
          ]}
          onChange={(id) =>
            dest({
              sheetId: id,
              expenseTabId: "",
              duplicateAction: "",
              duplicateRowId: "",
            })
          }
        />
        {destination.sheetId ? (
          <Select
            placeholder="Expense summary tab"
            value={destination.expenseTabId}
            options={receiptTabs(sheet).map((tab) => ({
              value: tab.id,
              label: tab.name,
            }))}
            onChange={(id) => dest({ expenseTabId: id })}
          />
        ) : (
          <>
            <Select
              placeholder="Workspace"
              value={destination.workspaceId}
              options={spaces.map((space) => ({
                value: space.id,
                label: space.name,
              }))}
              onChange={(id) => dest({ workspaceId: id })}
            />
            <Field
              placeholder="New sheet name"
              value={destination.title}
              onChangeText={(title) => dest({ title })}
            />
          </>
        )}
        <Text style={styles.muted}>
          The receipt and its items will be saved together. Existing receipts in
          this sheet stay in place.
        </Text>
      </View>
      <DateTimeSheet
        open={datePickerOpen && !disabled}
        mode="date"
        title="Receipt date"
        value={pickerDate}
        clearable={false}
        onClose={() => setDatePickerOpen(false)}
        onChange={(date) => {
          if (date) update({ date: toDateInputValue(date) });
        }}
      />
      {destinationLoading && (
        <Text style={styles.muted}>Loading expense sheets…</Text>
      )}
      {!!destinationError && (
        <View style={styles.stack}>
          <Text style={styles.muted}>
            Couldn't load your expense sheets. Try again before continuing.
          </Text>
          <Action
            label="Reload expense sheets"
            onPress={() => {
              void sheetsQuery.refetch();
              if (base.sheetId) void sheetQuery.refetch();
            }}
          />
        </View>
      )}
      {!!problems.length && (
        <View style={dateStyles.card}>
          <Text style={[styles.text, { fontWeight: "700" }]}>
            Before continuing
          </Text>
          {problems.map((problem) => (
            <Text key={problem} style={styles.muted}>
              {problem}
            </Text>
          ))}
        </View>
      )}
      {needsAcknowledgement && (
        <Text style={styles.muted}>
          Confirm the highlighted uncertainties above to continue.
        </Text>
      )}
      <Action
        label={pending ? "Preparing preview…" : "Continue to save"}
        primary
        disabled={
          disabled ||
          destinationLoading ||
          !!destinationError ||
          problems.length > 0 ||
          needsAcknowledgement
        }
        onPress={() =>
          act("/receipt", {
            revision: chat.revision,
            receipt: draft,
            destination,
            reviewedIssues: reviewed,
          })
        }
      />
      <Text style={styles.muted}>
        Nothing is saved until you confirm on the next screen. Photos are
        removed after saving, discarding, or 24 hours.
      </Text>
      <Action
        label="Discard receipt"
        disabled={pending}
        onPress={() => act("/images/discard")}
      />
    </View>
  );
}
export function ReceiptSaveSummary({
  receipt,
  destination,
}: {
  receipt: ReceiptDraft;
  destination: ReceiptDestination;
}) {
  const sheets = useSheetsQuery().data ?? [];
  const sheet = useSheetQuery(destination.sheetId).data;
  const title =
    sheet?.title ||
    sheets.find((item) => item.id === destination.sheetId)?.title ||
    "Selected expense sheet";
  const tab = sheet?.tabs?.find(
    (item) => item.id === destination.expenseTabId,
  )?.name;
  return (
    <View style={dateStyles.card}>
      <Text style={[styles.text, { fontWeight: "700" }]}>Ready to save</Text>
      <Text
        style={[
          styles.text,
          { fontSize: 30, lineHeight: 36, fontWeight: "800" },
        ]}
      >
        {receipt.currency} {receipt.total}
      </Text>
      <Text style={styles.text}>
        {receipt.merchant} · {receipt.date}
      </Text>
      <Text style={styles.muted}>
        {receipt.items.length || 1} items ·{" "}
        {destination.duplicateAction === "update"
          ? "Updates the matching receipt"
          : "Adds one receipt"}
      </Text>
      <Text style={styles.text}>
        {destination.sheetId
          ? `${title}${tab ? ` · ${tab}` : ""}`
          : `Create “${destination.title || "Expenses"}”`}
      </Text>
      <Text style={styles.muted}>Nothing has been saved yet.</Text>
    </View>
  );
}

function Toggle({
  label,
  value,
  change,
}: {
  label: string;
  value: boolean;
  change: (value: boolean) => void;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Switch accessibilityLabel={label} value={value} onValueChange={change} />
      <Text style={[styles.muted, { flex: 1 }]}>{label}</Text>
    </View>
  );
}

const dateStyles = createThemedStyleSheet(() => ({
  card: {
    padding: 16,
    gap: 12,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
  },
  trigger: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.input,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
}));
