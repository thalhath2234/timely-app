import { ReceiptReview, TimelyProvider } from "@timely/ui";
import { useEffect, useRef } from "react";

// A photographed coffee-shop receipt for the receipt-review flow (the sample
// image at GET /chats/images/:id is a planning wall, not a receipt).
const RECEIPT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="560" viewBox="0 0 420 560">
<rect width="420" height="560" fill="#d9d4cb"/>
<g transform="rotate(-2 210 280)">
<rect x="80" y="30" width="260" height="500" fill="#fdfcf8" stroke="#e4e0d6"/>
<g font-family="Courier New, monospace" fill="#2b2b2b" font-size="13">
<text x="210" y="70" text-anchor="middle" font-size="17" font-weight="bold">BLUE BOTTLE COFFEE</text>
<text x="210" y="90" text-anchor="middle">300 Webster St, Oakland</text>
<text x="210" y="108" text-anchor="middle">05/14/2024  10:42 AM</text>
<line x1="100" y1="124" x2="320" y2="124" stroke="#999" stroke-dasharray="4 3"/>
<text x="100" y="150">2 Cold brew</text><text x="320" y="150" text-anchor="end">11.00</text>
<text x="100" y="172">1 Almond croissant</text><text x="320" y="172" text-anchor="end">4.25</text>
<text x="100" y="194">1 Granola cup</text><text x="320" y="194" text-anchor="end">3.25</text>
<line x1="100" y1="212" x2="320" y2="212" stroke="#999" stroke-dasharray="4 3"/>
<text x="100" y="236">Subtotal</text><text x="320" y="236" text-anchor="end">18.50</text>
<text x="100" y="258">Tax 8.75%</text><text x="320" y="258" text-anchor="end">1.62</text>
<text x="100" y="280">Tip</text><text x="320" y="280" text-anchor="end">3.00</text>
<text x="100" y="312" font-weight="bold" font-size="15">TOTAL USD</text><text x="320" y="312" text-anchor="end" font-weight="bold" font-size="15">23.12</text>
<text x="100" y="350">VISA ****4417</text>
<text x="210" y="420" text-anchor="middle">Thank you!</text>
<text x="210" y="440" text-anchor="middle" font-size="11">bluebottlecoffee.com</text>
</g></g></svg>`;
const receiptImage = () => new Blob([RECEIPT_SVG], { type: "image/svg+xml" });

// Every cell passes this same table: installing a provider's routes replaces
// the page-wide table, so all nested providers must agree.
const API = { "GET /chats/images/img_bb_receipt": () => receiptImage() };

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const inADay = () => new Date(Date.now() + 24 * 3_600_000).toISOString();

const items = [
  { description: "Cold brew", quantity: "2", unitPrice: "5.50", amount: "11.00", category: "Meals" },
  { description: "Almond croissant", quantity: "1", unitPrice: "4.25", amount: "4.25", category: "Meals" },
  { description: "Granola cup", quantity: "1", unitPrice: "3.25", amount: "3.25", category: "Meals" },
];

const receipt = {
  merchant: "Blue Bottle Coffee",
  date: "2024-05-14",
  currency: "USD",
  category: "Meals",
  subtotal: "18.50",
  tax: "1.62",
  tip: "3.00",
  discount: "",
  total: "23.12",
  taxIncluded: false,
  discountIncluded: false,
  items,
  issues: [] as string[],
};

function chat(overrides: { receipt?: Partial<typeof receipt>; duplicates?: unknown[]; destination?: unknown; status?: string } = {}) {
  return {
    id: "chat_receipt",
    title: "Coffee with the research participants",
    status: overrides.status ?? "approval",
    phase: "review",
    webSearch: false,
    provider: "claude",
    model: "sonnet",
    context: [{ kind: "workspace", label: "Design Studio", value: "ws_studio" }],
    messages: [],
    plan: [],
    revision: 2,
    unread: false,
    error: "",
    sensitive: true,
    images: [{ id: "img_bb_receipt", name: "blue-bottle-receipt.jpg", expiresAt: inADay() }],
    imageReview: {
      imageIds: ["img_bb_receipt"],
      receiptId: "rcpt_blue_bottle",
      status: "review",
      text: "",
      receipt: { ...receipt, ...overrides.receipt },
      duplicates: overrides.duplicates,
      destination: overrides.destination,
    },
    createdAt: at(12),
    updatedAt: at(10),
  } as any;
}

/** A chat-width scroll frame, scrolled (like the chat itself) to `focus`. */
function Frame({ children, focus }: { children: React.ReactNode; focus?: (root: HTMLElement) => Element | null | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    const timer = setInterval(() => {
      const el = ref.current && focus(ref.current);
      if (!el || !ref.current) return;
      ref.current.scrollTop += el.getBoundingClientRect().top - ref.current.getBoundingClientRect().top - 16;
      clearInterval(timer);
    }, 50);
    return () => clearInterval(timer);
  }, []);
  return (
    <TimelyProvider animations={false} api={API}>
      <div ref={ref} className="bg-background px-6 pb-6" style={{ width: 780, height: 640, overflowY: "auto" }}>
        {children}
      </div>
    </TimelyProvider>
  );
}

const noop = () => {};
const heading = (text: string) => (root: HTMLElement) =>
  Array.from(root.querySelectorAll("h2, h3")).find((h) => h.textContent?.startsWith(text));

export const ExtractedReceipt = () => (
  <Frame>
    <ReceiptReview chat={chat()} pending={false} onDirty={noop} act={noop} />
  </Frame>
);

export const ItemsAndDestination = () => (
  <Frame focus={heading("Individual items")}>
    <ReceiptReview chat={chat()} pending={false} onDirty={noop} act={noop} />
  </Frame>
);

export const NeedsReview = () => (
  <Frame focus={(root) => root.querySelector('[role="note"]')}>
    <ReceiptReview
      chat={chat({
        receipt: {
          date: "",
          tip: "",
          items: [],
          issues: [
            "The date is torn off the bottom of the receipt.",
            "The handwritten tip is hard to read - check it against your card statement.",
          ],
        },
      })}
      pending={false}
      onDirty={noop}
      act={noop}
    />
  </Frame>
);

export const PossibleDuplicate = () => (
  <Frame focus={heading("Possible duplicate")}>
    <ReceiptReview
      chat={chat({
        duplicates: [
          {
            itemMatch: "same",
            sheetId: "sht_tooling_budget",
            sheetTitle: "Design tooling budget",
            tabId: "tab_budget",
            rowId: "row_bb_0514",
            merchant: "Blue Bottle Coffee",
            date: "2024-05-14",
            total: "23.12",
            currency: "USD",
          },
        ],
        destination: {
          sheetId: "sht_tooling_budget",
          workspaceId: "ws_studio",
          title: "Expenses",
          expenseTabId: "tab_budget",
          duplicateAction: "",
          duplicateRowId: "",
        },
      })}
      pending={false}
      onDirty={noop}
      act={noop}
    />
  </Frame>
);

export const Submitting = () => (
  <Frame focus={heading("Individual items")}>
    <ReceiptReview chat={chat({ status: "running" })} pending onDirty={noop} act={noop} />
  </Frame>
);
