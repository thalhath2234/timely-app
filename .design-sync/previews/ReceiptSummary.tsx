import type React from "react";
import { useEffect, useRef } from "react";
import { ReceiptSummary } from "@timely/ui";

const receipt = {
  merchant: "Blue Bottle Coffee",
  date: "2024-05-14",
  currency: "USD",
  category: "Meals",
  subtotal: "23.50",
  tax: "2.09",
  tip: "4.00",
  discount: "",
  total: "29.59",
  taxIncluded: false,
  items: [
    { description: "Oat latte", quantity: "2", unitPrice: "5.75", amount: "11.50", category: "Meals" },
    { description: "Avocado toast", quantity: "1", unitPrice: "9.00", amount: "9.00", category: "Meals" },
    { description: "Bottled water", quantity: "1", unitPrice: "3.00", amount: "3.00", category: "Meals" },
  ],
  issues: [],
};

/** ReceiptSummary is a <details>; open it so the line items show. */
function Opened({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("details")?.setAttribute("open", "");
  }, []);
  return <div ref={ref} className="p-4" style={{ width: 440 }}>{children}</div>;
}

export const Expanded = () => (
  <Opened>
    <ReceiptSummary receipt={receipt} />
  </Opened>
);

export const Collapsed = () => (
  <div className="p-4" style={{ width: 440 }}>
    <ReceiptSummary receipt={receipt} />
  </div>
);

export const NeedsReview = () => (
  <Opened>
    <ReceiptSummary
      receipt={{
        ...receipt,
        merchant: "",
        date: "",
        total: "",
        currency: "EUR",
        items: [
          { description: "Printer paper A4", quantity: "1", unitPrice: "", amount: "6.40", category: "Office" },
          { description: "", quantity: "1", unitPrice: "", amount: "", category: "" },
        ],
        issues: ["Total is unreadable"],
      }}
    />
  </Opened>
);
