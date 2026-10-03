import { Conversation, TimelyProvider } from "@timely/ui";

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

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const inADay = () => new Date(Date.now() + 24 * 3_600_000).toISOString();

const receiptChat = {
  id: "chat_receipt",
  title: "Coffee with the research participants",
  status: "approval",
  phase: "review",
  webSearch: false,
  provider: "claude",
  model: "sonnet",
  context: [{ kind: "workspace", label: "Design Studio", value: "ws_studio" }],
  messages: [
    {
      id: "m_rc_1",
      role: "user",
      kind: "",
      content: "Log this to expenses - coffee with two interview participants.",
      createdAt: at(12),
      imageIds: ["img_bb_receipt"],
    },
    {
      id: "m_rc_2",
      role: "assistant",
      kind: "",
      content: "I read the receipt from **Blue Bottle Coffee** - three items, $23.12 including a $3.00 tip. Check the details below before anything is saved.",
      createdAt: at(10),
    },
  ],
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
    receipt: {
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
      items: [
        { description: "Cold brew", quantity: "2", unitPrice: "5.50", amount: "11.00", category: "Meals" },
        { description: "Almond croissant", quantity: "1", unitPrice: "4.25", amount: "4.25", category: "Meals" },
        { description: "Granola cup", quantity: "1", unitPrice: "3.25", amount: "3.25", category: "Meals" },
      ],
      issues: [],
    },
  },
  createdAt: at(12),
  updatedAt: at(10),
};

// The receipt chat isn't in the sample workspace: it's seeded into the cell's
// own query cache. Two additive routes (ids no other cell uses) serve its photo
// and its 5s poll - the nested provider's table is the sample table plus these,
// so the page-wide table swap is harmless to the other cells.
const API = {
  "GET /chats/chat_receipt": receiptChat,
  "GET /chats/images/img_bb_receipt": () => receiptImage(),
};

const Page = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-col bg-background" style={{ width: 860, height: 660 }}>
    {children}
  </div>
);

const noop = () => {};

export const AwaitingApproval = () => (
  <Page>
    <Conversation id="chat_review_prep" onCreated={noop} onNew={noop} onToggleHistory={noop} />
  </Page>
);

export const ChangesApplied = () => (
  <Page>
    <Conversation id="chat_plan_day" onCreated={noop} onNew={noop} onToggleHistory={noop} />
  </Page>
);

export const NewChat = () => (
  <Page>
    <Conversation onCreated={noop} onNew={noop} onToggleHistory={noop} />
  </Page>
);

export const OverlayInContext = () => (
  <div
    className="flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
    style={{ width: 760, height: 660 }}
  >
    <Conversation
      id="chat_research_themes"
      variant="overlay"
      onCreated={noop}
      onNew={noop}
      onOpenFull={noop}
      onClose={noop}
    />
  </div>
);

export const ReceiptInReview = () => (
  <TimelyProvider animations={false} api={API} seed={[[["chat", "chat_receipt"], receiptChat]]}>
    <Page>
      <Conversation id="chat_receipt" onCreated={noop} onNew={noop} onToggleHistory={noop} />
    </Page>
  </TimelyProvider>
);
