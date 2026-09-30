import type { ReceiptDraft } from "./types";

function amount(value: string): bigint | null {
  if (!/^-?\d{1,12}(\.\d{1,4})?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const result = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
  return negative ? -result : result;
}

function displayAmount(value: bigint) {
  const absolute = value < 0n ? -value : value;
  const fraction = String(absolute % 10000n)
    .padStart(4, "0")
    .replace(/0+$/, "");
  return `${value < 0n ? "-" : ""}${absolute / 10000n}${fraction ? `.${fraction}` : ""}`;
}

/** Immediate feedback while editing; the API still validates before saving. */
export function receiptReviewProblems(draft: ReceiptDraft): string[] {
  const problems: string[] = [];
  if (!draft.merchant.trim()) problems.push("Enter the merchant name.");
  const date = new Date(`${draft.date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== draft.date
  )
    problems.push("Choose a valid receipt date.");
  if (!/^[A-Z]{3}$/.test(draft.currency))
    problems.push("Enter a three-letter currency, such as JPY.");
  const total = amount(draft.total);
  if (total === null) problems.push("Enter the receipt total.");
  let sum = 0n;
  let itemsValid = true;
  for (const [index, item] of draft.items.entries()) {
    if (!item.description.trim())
      problems.push(`Enter a name for item ${index + 1}.`);
    for (const key of ["quantity", "unitPrice"] as const) {
      if (item[key] && amount(item[key]) === null)
        problems.push(
          `Check item ${index + 1}'s ${key === "quantity" ? "quantity" : "unit price"}.`,
        );
    }
    const value = amount(item.amount);
    if (value === null) {
      problems.push(`Enter the amount for item ${index + 1}.`);
      itemsValid = false;
    } else sum += value;
  }
  const subtotal = draft.subtotal ? amount(draft.subtotal) : null;
  if (draft.subtotal && subtotal === null) problems.push("Check the subtotal.");
  if (
    draft.items.length &&
    itemsValid &&
    subtotal !== null &&
    sum !== subtotal
  ) {
    problems.push(
      `Items add up to ${draft.currency} ${displayAmount(sum)}; subtotal is ${displayAmount(subtotal)}. Difference: ${displayAmount(subtotal - sum)}. Check for a missing item or fee.`,
    );
  }
  let expected = subtotal ?? sum;
  let adjustmentsValid = true;
  for (const [key, included, sign] of [
    ["tax", draft.taxIncluded, 1n],
    ["tip", false, 1n],
    ["discount", draft.discountIncluded, -1n],
  ] as const) {
    if (!draft[key]) continue;
    const value = amount(draft[key]);
    if (value === null) {
      problems.push(`Check the ${key} amount.`);
      adjustmentsValid = false;
    } else if (!included) expected += value * sign;
  }
  if (
    (draft.items.length || subtotal !== null) &&
    itemsValid &&
    adjustmentsValid &&
    total !== null &&
    expected !== total
  ) {
    problems.push(
      `Items and adjustments come to ${draft.currency} ${displayAmount(expected)}; receipt total is ${displayAmount(total)}. Check the amounts and tax settings.`,
    );
  }
  return problems;
}
