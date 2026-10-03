import type {
  Doc,
  DocContent,
  MentionEntityType,
  Sheet,
  SheetCellFormat,
  SheetColumn,
  SheetRow,
  SheetTab,
  SheetTemplate,
} from "@/app/_types/types";
import type { Clock } from "./clock";
import { T } from "./tasks";
import { P_DESIGN_SYSTEM, P_ONBOARDING, USER_ID, WS_PERSONAL, WS_STUDIO } from "./workspace";

// ---- Tiptap (ProseMirror JSON) builders, matching the editor's StarterKit,
// TaskList/TaskItem, Highlight and Mention extensions.

type Inline = Record<string, unknown>;
type Block = Record<string, unknown>;

const text = (value: string, marks?: string[]): Inline =>
  marks?.length ? { type: "text", text: value, marks: marks.map((type) => ({ type })) } : { type: "text", text: value };
const bold = (value: string) => text(value, ["bold"]);
const mention = (id: string, label: string, entityType: MentionEntityType, appearance: "mention" | "page" = "mention"): Inline => ({
  type: "mention",
  attrs: { id, label, entityType, appearance },
});
const inline = (parts: (string | Inline)[]) => parts.map((part) => (typeof part === "string" ? text(part) : part));
const p = (...parts: (string | Inline)[]): Block => ({ type: "paragraph", content: inline(parts) });
const h = (level: 1 | 2 | 3, value: string): Block => ({ type: "heading", attrs: { level }, content: [text(value)] });
const ul = (...items: (string | Inline)[][]): Block => ({
  type: "bulletList",
  content: items.map((parts) => ({ type: "listItem", content: [p(...parts)] })),
});
const ol = (...items: string[]): Block => ({
  type: "orderedList",
  attrs: { start: 1 },
  content: items.map((item) => ({ type: "listItem", content: [p(item)] })),
});
const todo = (...items: [boolean, ...(string | Inline)[]][]): Block => ({
  type: "taskList",
  content: items.map(([checked, ...parts]) => ({ type: "taskItem", attrs: { checked }, content: [p(...parts)] })),
});
const quote = (value: string): Block => ({ type: "blockquote", content: [p(value)] });
const doc = (...blocks: Block[]): DocContent => ({ type: "doc", content: blocks });

/** Plain text the way the app derives it (one line per paragraph/heading). */
export function plainOf(content: DocContent) {
  const lines: string[] = [];
  const walk = (node: { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> }) => {
    if (node.type === "text" && node.text) {
      lines[lines.length - 1] = (lines[lines.length - 1] ?? "") + node.text;
      return;
    }
    if (node.type === "mention") {
      const label = String(node.attrs?.label ?? "");
      lines[lines.length - 1] = (lines[lines.length - 1] ?? "") + (node.attrs?.appearance === "page" ? label : `@${label}`);
      return;
    }
    if (node.type === "paragraph" || node.type === "heading") lines.push("");
    for (const child of node.content ?? []) walk(child as typeof node);
  };
  walk(content);
  return lines.join("\n").trim();
}

export const D = {
  research: "doc_research_synthesis",
  acme: "doc_interview_acme",
  tokens: "doc_token_naming",
  weekly: "doc_weekly_notes",
} as const;

export const S = {
  usability: "sht_usability_tracker",
  budget: "sht_tooling_budget",
} as const;

export function buildDocs(clock: Clock): Doc[] {
  const { iso, ago } = clock;
  const base = { userId: USER_ID, isFavorite: false, archivedAt: null, parentId: null, projectId: null };

  const research = doc(
    h(1, "Research synthesis: new-user interviews"),
    p("Eight sessions with admins who created a workspace in the last 60 days. Notes are linked from ", mention(T.synthesize, "Synthesize interview notes from 8 new-user sessions", "task"), "."),
    h(2, "Themes"),
    ul(
      [bold("Invites feel risky. "), "Admins hesitate to invite before the workspace \"looks finished\"."],
      [bold("Empty states don't teach. "), "Five of eight didn't notice the template gallery."],
      [bold("Naming is a speed bump. "), "Several people stalled for minutes on the workspace name."],
    ),
    quote("\"I didn't want my team's first impression to be an empty board.\" - P4, operations lead"),
    h(2, "Opportunities"),
    ol(
      "Let admins invite from a preview of a filled-in workspace.",
      "Default the workspace name from the company domain, editable later.",
      "Make the first project a template choice, not a blank form.",
    ),
    h(2, "Session notes"),
    p(mention(D.acme, "Interview: Acme Corp workspace admin", "doc", "page")),
  );

  const acme = doc(
    h(1, "Interview: Acme Corp workspace admin"),
    p(bold("Role: "), "IT manager, 40-person logistics company. ", bold("Plan: "), "Team trial."),
    h(2, "Highlights"),
    ul(
      ["Invited 10 people in one go by pasting a column from a spreadsheet."],
      ["Expected roles to be chosen per person, not after the fact."],
      ["Never opened the help center; relied on the checklist."],
    ),
    h(2, "Follow-ups"),
    todo([true, "Send the thank-you gift card"], [false, "Share the clip of the bulk-invite moment with engineering"]),
  );

  const tokens = doc(
    h(1, "Token naming conventions"),
    p("Tokens are named by ", bold("role"), ", then ", bold("scale"), ". Never by the raw value - ", text("space-12", ["code"]), " stops being true the day we change it."),
    h(2, "Spacing"),
    ul(
      ["space-0 through space-7 map to 0, 2, 4, 8, 12, 16, 24, 32px."],
      ["Dense tables may use space-1 for cell padding; nothing else should."],
    ),
    h(2, "Radius"),
    ul(["radius-control: inputs, buttons, chips."], ["radius-surface: cards, popovers, dialogs."], ["radius-pill: avatars and toggles only."]),
    h(2, "Open questions"),
    todo(
      [false, "Do we keep a 6px step for the data grid? (", mention(T.tokens, "Define spacing and radius tokens", "task"), ")"],
      [true, "Agree to drop the 10px value - nobody could say why it exists"],
    ),
  );

  const weekly = doc(
    h(1, "Weekly notes"),
    h(2, "This week"),
    todo(
      [true, "Finish the button audit"],
      [false, "Wireframes for the welcome flow ready for critique"],
      [false, "Draft spacing tokens and review with Dev"],
      [false, "Renew passport before the trip"],
    ),
    h(2, "Notes"),
    p("Priya wants the onboarding direction locked before the stakeholder review. Keep ", mention(P_ONBOARDING, "Onboarding Redesign", "project"), " ahead of the token work if anything slips."),
    p("Budget for research participants is still unconfirmed - asked Sam."),
  );

  const rows: [string, string, DocContent, Partial<Doc>][] = [
    [D.research, "Research synthesis: new-user interviews", research, { icon: "🔍", projectId: P_ONBOARDING, workspaceId: WS_STUDIO, isFavorite: true, order: 0, createdAt: iso(-6, 10, 0), updatedAt: ago(60 * 26) }],
    [D.acme, "Interview: Acme Corp workspace admin", acme, { icon: "🎙️", projectId: P_ONBOARDING, workspaceId: WS_STUDIO, parentId: D.research, order: 0, createdAt: iso(-1, 15, 5), updatedAt: iso(-1, 15, 40) }],
    [D.tokens, "Token naming conventions", tokens, { icon: "🎨", projectId: P_DESIGN_SYSTEM, workspaceId: WS_STUDIO, order: 1, createdAt: iso(-12, 11, 0), updatedAt: ago(60 * 20) }],
    [D.weekly, "Weekly notes", weekly, { icon: "📝", workspaceId: WS_PERSONAL, isFavorite: true, order: 2, createdAt: iso(-4, 8, 30), updatedAt: ago(35) }],
  ];

  return rows.map(([id, title, content, rest]) => ({
    ...base,
    id,
    title,
    icon: null,
    content,
    plainText: plainOf(content),
    workspaceId: WS_STUDIO,
    order: 0,
    createdAt: iso(-5),
    updatedAt: iso(-5),
    ...rest,
  }));
}

// ---- Sheets

const col = (id: string, name: string, type: SheetColumn["type"], width = 140): SheetColumn => ({ id, name, type, width });

function grid(
  prefix: string,
  columns: SheetColumn[],
  data: string[][],
  formats: Record<number, Record<string, SheetCellFormat>> = {},
): SheetRow[] {
  return data.map((values, index) => {
    const cells: Record<string, string> = {};
    columns.forEach((column, c) => {
      cells[column.id] = values[c] ?? "";
    });
    const row: SheetRow = { id: `${prefix}_r${index + 1}`, cells };
    if (formats[index]) row.formats = formats[index];
    return row;
  });
}

function usabilityTabs(clock: Clock): SheetTab[] {
  const { ymd } = clock;
  const sessions = [
    col("c_participant", "Participant", "text", 160),
    col("c_date", "Date", "date", 120),
    col("c_success", "Task success", "number", 120),
    col("c_time", "Time to first project (min)", "number", 200),
    col("c_sus", "SUS score", "number", 110),
    col("c_notes", "Notes", "text", 320),
  ];
  const pct: SheetCellFormat = { numberFormat: "percent", decimals: 0 };
  const total: SheetCellFormat = { bold: true };
  const sessionRows = grid(
    "usab",
    sessions,
    [
      ["P1 - Agency owner", ymd(-9), "0.67", "7.5", "68", "Missed the template gallery entirely"],
      ["P2 - Eng manager", ymd(-9), "1", "4", "82", "Pasted 12 emails into the invite field"],
      ["P3 - Ops lead", ymd(-8), "0.67", "9", "61", "Renamed the workspace twice"],
      ["P4 - Founder", ymd(-6), "1", "3.5", "88", "Asked for Slack import"],
      ["P5 - Teacher", ymd(-2), "0.33", "12", "54", "Got stuck on the role picker"],
      ["P6 - IT manager", ymd(-1), "1", "5", "79", "Wanted roles per person while inviting"],
      ["Average", "", "=AVERAGE(C1:C6)", "=AVERAGE(D1:D6)", "=AVERAGE(E1:E6)", ""],
    ],
    {
      0: { c_success: pct }, 1: { c_success: pct }, 2: { c_success: pct },
      3: { c_success: pct }, 4: { c_success: pct }, 5: { c_success: pct },
      6: {
        c_participant: total, c_date: total, c_notes: total,
        c_success: { ...total, ...pct },
        c_time: { ...total, decimals: 1 },
        c_sus: { ...total, decimals: 0 },
      },
    },
  );

  const issues = [
    col("c_issue", "Issue", "text", 300),
    col("c_seen", "Seen by", "number", 100),
    col("c_severity", "Severity", "text", 110),
    col("c_status", "Status", "text", 120),
    col("c_fixed", "Fix shipped", "boolean", 110),
  ];
  const issueRows = grid("issue", issues, [
    ["Template gallery hidden below the fold", "5", "High", "In Review", "FALSE"],
    ["Role picker labels are ambiguous", "3", "Medium", "Ready", "FALSE"],
    ["Workspace name field has no suggestion", "4", "Medium", "Verified", "TRUE"],
    ["Invite confirmation disappears too quickly", "2", "Low", "Blocked", "FALSE"],
  ]);

  return [
    { id: "tab_sessions", name: "Sessions", columns: sessions, rows: sessionRows, merges: [] },
    { id: "tab_issues", name: "Issues", columns: issues, rows: issueRows, merges: [] },
  ];
}

function budgetTab(clock: Clock): SheetTab {
  const { ymd } = clock;
  const columns = [
    col("c_tool", "Tool", "text", 180),
    col("c_seats", "Seats", "number", 90),
    col("c_cost", "Cost / seat", "currency", 120),
    col("c_monthly", "Monthly", "formula", 120),
    col("c_renewal", "Renews", "date", 120),
    col("c_owner", "Owner", "text", 120),
  ];
  const total: SheetCellFormat = { bold: true };
  const rows = grid(
    "budget",
    columns,
    [
      ["Figma Organization", "6", "45", "=B1*C1", ymd(52), "Maya"],
      ["Maze", "2", "99", "=B2*C2", ymd(18), "Research"],
      ["Dovetail", "3", "39", "=B3*C3", ymd(75), "Research"],
      ["Lottie Pro", "1", "20", "=B4*C4", ymd(9), "Maya"],
      ["Font licenses (Inter Display)", "1", "15", "=B5*C5", ymd(140), "Brand"],
      ["Total", "=SUM(B1:B5)", "", "=SUM(D1:D5)", "", ""],
    ],
    { 5: { c_tool: total, c_seats: total, c_cost: total, c_monthly: { ...total, numberFormat: "currency" }, c_renewal: total, c_owner: total } },
  );
  return { id: "tab_budget", name: "Q4 tooling", columns, rows, merges: [] };
}

export function buildSheets(clock: Clock): Sheet[] {
  const { iso, ago } = clock;
  const usability = usabilityTabs(clock);
  const budget = budgetTab(clock);
  return [
    {
      id: S.usability,
      title: "Onboarding usability tracker",
      icon: "🧪",
      columns: usability[0].columns,
      rows: usability[0].rows,
      merges: [],
      tabs: usability,
      workspaceId: WS_STUDIO,
      projectId: P_ONBOARDING,
      userId: USER_ID,
      isFavorite: true,
      archivedAt: null,
      createdAt: iso(-10, 9, 0),
      updatedAt: ago(60 * 18),
    },
    {
      id: S.budget,
      title: "Design tooling budget",
      icon: "💳",
      columns: budget.columns,
      rows: budget.rows,
      merges: [],
      tabs: [],
      workspaceId: WS_STUDIO,
      projectId: null,
      userId: USER_ID,
      isFavorite: false,
      archivedAt: null,
      createdAt: iso(-30, 16, 0),
      updatedAt: iso(-3, 11, 20),
    },
  ];
}

export function buildSheetTemplates(clock: Clock): SheetTemplate[] {
  const { iso } = clock;
  const columns = [
    col("c_participant", "Participant", "text", 160),
    col("c_date", "Date", "date", 120),
    col("c_success", "Task success", "number", 120),
    col("c_sus", "SUS score", "number", 110),
    col("c_notes", "Notes", "text", 320),
  ];
  const rows = grid("tpl_usab", columns, [[], [], [], [], ["Average", "", "=AVERAGE(C1:C4)", "=AVERAGE(D1:D4)", ""]]);
  const tracker = [
    col("c_item", "Item", "text", 220),
    col("c_owner", "Owner", "text", 120),
    col("c_due", "Due", "date", 120),
    col("c_done", "Done", "boolean", 90),
  ];
  return [
    {
      id: "tpl_usability",
      userId: USER_ID,
      name: "Usability test log",
      icon: "🧪",
      columns,
      rows,
      merges: [],
      tabs: [],
      sourceSheetId: S.usability,
      createdAt: iso(-8, 12, 0),
      updatedAt: iso(-8, 12, 0),
    },
    {
      id: "tpl_action_items",
      userId: USER_ID,
      name: "Meeting action items",
      icon: "✅",
      columns: tracker,
      rows: grid("tpl_actions", tracker, [[], [], [], [], []]),
      merges: [],
      tabs: [],
      sourceSheetId: null,
      createdAt: iso(-40, 10, 0),
      updatedAt: iso(-40, 10, 0),
    },
  ];
}
