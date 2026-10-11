"use client";
import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Plus,
  ReceiptText,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  Chat,
  ReceiptDraft,
  ReceiptDestination,
} from "@/app/utils/api/chat";
import { useSheets, useSheet } from "@/app/utils/hooks/sheets";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { ImagePreview } from "./imageAttachments";
import DatePicker from "@/app/_components/_ui/datePicker";
import {
  receiptDestination,
  receiptTabId,
  receiptTabs,
} from "./receiptDestination";
const fieldClass =
  "w-full min-w-0 rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60";
export function ReceiptSummary({ receipt }: { receipt: ReceiptDraft }) {
  return (
    <details className="mt-3 rounded-xl border border-border bg-muted/20 p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {receipt.merchant || "Receipt"} · {receipt.currency}{" "}
        {receipt.total || "Unknown total"} · {receipt.items.length} items
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        {receipt.date || "Date needs review"}
      </p>
      <ul className="mt-2 space-y-1">
        {receipt.items.map((item, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span>{item.description || "Unreadable item"}</span>
            <span className="tabular-nums">{item.amount || "?"}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
export default function ReceiptReview({
  chat,
  pending,
  act,
  onDirty,
}: {
  chat: Chat;
  pending: boolean;
  onDirty: () => void;
  act: (action: string, body?: unknown) => void;
}) {
  const review = chat.imageReview!;
  const [draft, setDraft] = useState<ReceiptDraft>(() =>
    structuredClone(review.receipt!),
  );
  const [chosenDestination, setChosenDestination] = useState<
    ReceiptDestination | undefined
  >(review.destination);
  const [reviewed, setReviewed] = useState(false);
  const { data: sheets = [] } = useSheets();
  const { data: workspaces = [] } = useWorkspaces();
  const suggested = receiptDestination(
    chat.context,
    sheets,
    review.suggestedDestination,
  );
  const baseDestination = chosenDestination || suggested;
  const { data: sheet } = useSheet(baseDestination.sheetId || undefined);
  const destination = {
    ...baseDestination,
    expenseTabId:
      baseDestination.expenseTabId || receiptTabId(chat.context, sheet),
  };
  function setDestination(
    update: (current: ReceiptDestination) => ReceiptDestination,
  ) {
    setChosenDestination(update(destination));
  }
  const busy = pending || ["queued", "running"].includes(chat.status);
  const images = (chat.images || []).filter((i) =>
    review.imageIds.includes(i.id),
  );
  function field(key: keyof ReceiptDraft, value: string | boolean) {
    setDraft((d) => ({ ...d, [key]: value }));
  }
  const duplicate = review.duplicates || [];
  return (
    <section
      onChange={onDirty}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) onDirty();
      }}
      aria-label="Receipt review"
      className="mt-6 overflow-hidden rounded-2xl border border-border bg-muted/15"
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <div className="rounded-xl bg-primary/10 p-2 text-primary">
          <ReceiptText className="size-5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold">Review your receipt</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Review extracted details in the original currency. Nothing saved to
            your sheet yet.
          </p>
        </div>
      </div>
      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
        <div className="space-y-3">
          {images.map((image) => (
            <ImagePreview key={image.id} image={image} large />
          ))}
          <p className="text-xs leading-5 text-muted-foreground">
            Images are removed after Apply, on discard, or 24 hours after
            upload. Extracted details stay.
          </p>
        </div>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          {!!draft.issues?.length && (
            <div
              role="note"
              className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
            >
              <p className="flex items-center gap-2 font-medium">
                <AlertCircle className="size-4" />
                Needs your review
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
                {draft.issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
              <label className="mt-3 flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                I checked the image and corrected these uncertainties.
              </label>
            </div>
          )}
          {!!review.hints?.length && (
            <div
              role="note"
              className="flex gap-2 rounded-xl border border-border bg-background/60 p-3 text-xs"
              data-testid="receipt-hints"
            >
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <div className="min-w-0 space-y-1">
                <p className="font-medium">Smart suggestions</p>
                {review.hints.map((hint) => (
                  <p key={hint} className="text-muted-foreground">
                    {hint}
                  </p>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["merchant", "Merchant"],
                ["date", "Date"],
                ["currency", "Currency"],
                ["category", "Category"],
                ["subtotal", "Subtotal"],
                ["tax", "Tax"],
                ["tip", "Tip"],
                ["discount", "Discount"],
                ["total", "Receipt total"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="space-y-1 text-xs text-muted-foreground"
              >
                <span>
                  {label}
                  {["merchant", "date", "currency", "total"].includes(key) &&
                    " *"}
                </span>
                {key === "date" ? (
                  <DatePicker
                    value={draft.date || ""}
                    onChange={(value) => field("date", value)}
                    placeholder="Unknown / not printed"
                    aria-label={label}
                    className="bg-background py-2"
                  />
                ) : (
                  <input
                    aria-label={label}
                    className={fieldClass}
                    value={draft[key] || ""}
                    onChange={(e) =>
                      field(
                        key,
                        key === "currency"
                          ? e.target.value.toUpperCase()
                          : e.target.value,
                      )
                    }
                    placeholder={
                      key === "currency"
                        ? "JPY, USD…"
                        : key === "total"
                          ? "Required"
                          : "Unknown / not printed"
                    }
                    maxLength={key === "merchant" ? 300 : 200}
                  />
                )}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.taxIncluded}
              onChange={(e) => field("taxIncluded", e.target.checked)}
            />
            Tax is already included in item prices
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.discountIncluded ?? false}
              onChange={(e) => field("discountIncluded", e.target.checked)}
            />
            Discount is already included in item amounts and subtotal
          </label>
        </fieldset>
      </div>
      <fieldset
        disabled={busy}
        className="min-w-0 space-y-4 border-t border-border p-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            Individual items{" "}
            <span className="text-muted-foreground">
              ({draft.items.length})
            </span>
          </h3>
          <button
            type="button"
            disabled={draft.items.length >= 300}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                items: [
                  ...d.items,
                  {
                    description: "",
                    quantity: "",
                    unitPrice: "",
                    amount: "",
                    category: "",
                  },
                ],
              }))
            }
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs hover:bg-muted"
          >
            <Plus className="size-3" />
            Add missing item
          </button>
        </div>
        {draft.items.length === 0 && (
          <p
            role="status"
            className="rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground"
          >
            No individual items were extracted. We’ll save one summary item
            using the merchant name and receipt total:{" "}
            {draft.merchant || "Merchant needed"}
            {" · "}
            {draft.currency} {draft.total || "Total needed"}. Tax, tips and
            discounts are already covered by that total. You can add individual
            items above if available.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-1 text-left text-xs">
            <thead>
              <tr>
                {[
                  "Item *",
                  "Quantity",
                  "Unit price",
                  "Amount *",
                  "Category",
                  "",
                ].map((label, i) => (
                  <th
                    key={i}
                    className="px-1 font-medium text-muted-foreground"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {draft.items.map((item, i) => (
                <tr key={i}>
                  {(
                    [
                      "description",
                      "quantity",
                      "unitPrice",
                      "amount",
                      "category",
                    ] as const
                  ).map((key) => (
                    <td key={key}>
                      <input
                        aria-label={`Item ${i + 1} ${key}`}
                        className={fieldClass}
                        value={item[key] || ""}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            items: d.items.map((x, j) =>
                              j === i ? { ...x, [key]: e.target.value } : x,
                            ),
                          }))
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      aria-label={`Remove item ${i + 1}`}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          items: d.items.filter((_, j) => j !== i),
                        }))
                      }
                      className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Item amounts, tax, tips and discounts must reconcile with the total.
          Blank optional fields stay unknown. Currencies are never converted or
          combined.
        </p>
        {!!duplicate.length && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <h3 className="text-sm font-medium">Possible duplicate receipt</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              A receipt with this merchant, date, currency and total already
              exists.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => act("/images/discard")}
                className="rounded-full border border-border px-3 py-1.5 text-xs"
              >
                Skip this receipt
              </button>
              <button
                type="button"
                onClick={() =>
                  setDestination((d) => ({
                    ...d,
                    duplicateAction: "add",
                    duplicateRowId: "",
                  }))
                }
                aria-pressed={destination.duplicateAction === "add"}
                className="rounded-full border border-border px-3 py-1.5 text-xs aria-pressed:bg-primary/10"
              >
                Add anyway
              </button>
            </div>
            <label className="mt-3 block space-y-1 text-xs">
              Or update an existing receipt
              <select
                aria-label="Update existing receipt"
                className={fieldClass}
                value={
                  destination.duplicateAction === "update"
                    ? destination.duplicateRowId
                    : ""
                }
                onChange={(e) => {
                  const match = duplicate.find(
                    (x) => x.rowId === e.target.value,
                  );
                  if (match)
                    setDestination((d) => ({
                      ...d,
                      sheetId: match.sheetId,
                      expenseTabId: match.tabId,
                      duplicateAction: "update",
                      duplicateRowId: match.rowId,
                    }));
                }}
              >
                <option value="">Choose a matching entry…</option>
                {duplicate.map((x) => (
                  <option key={x.rowId} value={x.rowId}>
                    {x.sheetTitle} · {x.date} · {x.currency} {x.total}
                    {x.itemMatch === "same"
                      ? " · same items"
                      : x.itemMatch === "different"
                        ? " · items differ"
                        : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            Expense sheet
            <select
              aria-label="Expense sheet"
              className={fieldClass}
              value={destination.sheetId}
              onChange={(e) =>
                setDestination((d) => ({
                  ...d,
                  sheetId: e.target.value,
                  expenseTabId: "",
                  duplicateAction: "",
                  duplicateRowId: "",
                }))
              }
            >
              <option value="">Create a new expense sheet</option>
              {sheets
                .filter((x) => !x.archivedAt)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
            </select>
          </label>
          {destination.sheetId ? (
            <label className="space-y-1 text-xs text-muted-foreground">
              Expense summary tab
              <select
                aria-label="Expense summary tab"
                className={fieldClass}
                value={destination.expenseTabId}
                onChange={(e) =>
                  setDestination((d) => ({
                    ...d,
                    expenseTabId: e.target.value,
                  }))
                }
              >
                {!destination.expenseTabId && (
                  <option value="">Choose summary tab…</option>
                )}
                {receiptTabs(sheet).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="space-y-1 text-xs text-muted-foreground">
                Workspace
                <select
                  aria-label="Receipt workspace"
                  className={fieldClass}
                  value={destination.workspaceId}
                  onChange={(e) =>
                    setDestination((d) => ({
                      ...d,
                      workspaceId: e.target.value,
                    }))
                  }
                >
                  <option value="">Choose workspace…</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                New sheet name
                <input
                  aria-label="New expense sheet name"
                  className={fieldClass}
                  value={destination.title}
                  onChange={(e) =>
                    setDestination((d) => ({ ...d, title: e.target.value }))
                  }
                />
              </label>
            </>
          )}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          One receipt summary goes in the expense tab. Every purchased item goes
          in Items, linked by a receipt ID. Missing columns or tabs will appear
          in the proposal.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => act("/images/discard")}
            className="rounded-full px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
          >
            Discard receipt
          </button>
          <button
            type="button"
            onClick={() =>
              act("/receipt", {
                revision: chat.revision,
                receipt: draft,
                destination,
                reviewedIssues: reviewed,
              })
            }
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Review sheet changes
            <ArrowRight className="size-4" />
          </button>
        </div>
      </fieldset>
    </section>
  );
}
