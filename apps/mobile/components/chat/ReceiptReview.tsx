import { useAssistant } from "../../lib/chat/runtime";
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
  const review = chat.imageReview!;
  const assistant = useAssistant();
  const signature = JSON.stringify([review.receipt, review.destination]);
  const saved = assistant.cache.receiptEdits[chat.id];
  const edit =
    saved?.signature === signature
      ? saved
      : {
          signature,
          draft: review.receipt!,
          destination: review.destination,
          reviewed: false,
          dirty: false,
        };
  const draft = edit.draft;
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
  const sheets = useSheetsQuery().data ?? [];
  const spaces = useWorkspacesQuery().data ?? [];
  const base = chosen ?? receiptDestination(chat.context, sheets);
  const sheet = useSheetQuery(base.sheetId).data;
  const destination = {
    ...base,
    expenseTabId: base.expenseTabId || receiptTabId(chat.context, sheet),
  };
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
        Review your receipt
      </Text>
      <Text style={styles.muted}>
        Review the original currency and individual items. Nothing has been
        saved to your sheet yet. Images are removed after Apply, discard, or 24
        hours.
      </Text>
      {(chat.images ?? [])
        .filter((image) => review.imageIds.includes(image.id))
        .map((image) => (
          <ImagePreview key={image.id} image={image} large onOpen={onImage} />
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
            ["date", "Date (YYYY-MM-DD) *"],
            ["currency", "Currency *"],
            ["category", "Category"],
            ["subtotal", "Subtotal"],
            ["tax", "Tax"],
            ["tip", "Tip"],
            ["discount", "Discount"],
            ["total", "Receipt total *"],
          ] as const
        ).map(([key, label]) => (
          <View key={key} style={styles.stack}>
            <Text style={styles.muted}>{label}</Text>
            <Field
              value={draft[key] ?? ""}
              placeholder={label}
              onChangeText={(value) =>
                update({
                  [key]: key === "currency" ? value.toUpperCase() : value,
                })
              }
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
          <View key={i} style={styles.indent}>
            <Text style={styles.text}>Item {i + 1}</Text>
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
              onPress={() =>
                update({ items: draft.items.filter((_, index) => index !== i) })
              }
            />
          </View>
        ))}
        <Action
          label="Add missing item"
          disabled={draft.items.length >= 300}
          onPress={() =>
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
            })
          }
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
        <Text style={styles.muted}>Expense sheet</Text>
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
          One receipt summary goes in the expense tab. Purchased items go in
          Items, linked by receipt ID. Missing columns and tabs appear in the
          proposal.
        </Text>
      </View>
      <Action
        label="Review sheet changes"
        primary
        disabled={disabled}
        onPress={() =>
          act("/receipt", {
            revision: chat.revision,
            receipt: draft,
            destination,
            reviewedIssues: reviewed,
          })
        }
      />
      <Action
        label="Discard receipt"
        disabled={pending}
        onPress={() => act("/images/discard")}
      />
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
