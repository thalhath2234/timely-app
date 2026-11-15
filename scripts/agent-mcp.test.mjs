import assert from "node:assert/strict";
import test from "node:test";
import {
  MCP_MODES,
  catalogCategories,
  categoryLabel,
  commandLine,
  filterCatalog,
  formatArgs,
  missingFields,
  modeHint,
  modeLabel,
  nameProblem,
  parseArgs,
  parseEnv,
  serverStatus,
  toolsEmptyText,
  serverTarget,
  serversSummary,
  suggestName,
  toolAlwaysAsks,
  toolClassLabel,
  urlProblem,
} from "../packages/contract/src/agentMcp.ts";

// External MCP servers (phase 5, Q-5.6): the words and small decisions web, desktop
// and phone share. Pure functions over packages/contract/src/agentMcp.ts.

const row = (over) => ({
  id: "x", name: "x", url: "https://x.example", category: "other", flag: "", auth: "oauth", description: "", fields: [], note: "", added: false, ...over,
});

test("the three modes read as the owner named them", () => {
  assert.deepEqual(MCP_MODES.map((m) => m.label), ["Can use", "Ask me first", "Off"]);
  assert.equal(modeLabel("use"), "Can use");
  assert.equal(modeLabel("off"), "Off");
  assert.equal(modeLabel("something"), "Ask me first", "an unknown mode is read as Ask me first, as the worker does");
  assert.match(modeHint("use"), /Supervised it still asks/);
  assert.match(modeHint("ask"), /waits for your OK/);
});

test("a row says what the person must do", () => {
  const ok = { status: "ready", mode: "ask", signsIn: false, signedIn: false };
  assert.deepEqual(serverStatus(ok), { text: "Connected", tone: "ok" });
  assert.deepEqual(serverStatus({ ...ok, signsIn: true, signedIn: true }), { text: "Signed in", tone: "ok" });
  assert.deepEqual(serverStatus({ ...ok, status: "needs_sign_in", signsIn: true }), { text: "Sign in to use it", tone: "warn" });
  assert.deepEqual(serverStatus({ ...ok, status: "waiting_for_ok" }), { text: "Waiting for your OK on the host card", tone: "warn" });
  assert.deepEqual(serverStatus({ ...ok, status: "not_approved", warning: "Not added: you said no, or it timed out." }), {
    text: "Not added: you said no, or it timed out.",
    tone: "warn",
  });
  assert.equal(serversSummary([{ status: "not_approved", mode: "ask" }]), "1 server, 1 needs you");
  assert.deepEqual(serverStatus({ ...ok, status: "unavailable", warning: "This address now points at a private network." }), {
    text: "This address now points at a private network.",
    tone: "error",
  });
  assert.deepEqual(serverStatus({ ...ok, lastError: "401 Unauthorized" }), { text: "401 Unauthorized", tone: "error" });
  assert.deepEqual(serverStatus({ ...ok, mode: "off", status: "needs_sign_in" }), { text: "Not connected", tone: "muted" }, "Off hides what it would need");
});

test("the closed row counts servers and the ones that need the person", () => {
  assert.equal(serversSummary(undefined), "Connect Linear, Notion, Stripe and more");
  assert.equal(serversSummary([]), "Connect Linear, Notion, Stripe and more");
  assert.equal(serversSummary([{ status: "ready", mode: "ask" }]), "1 server");
  assert.equal(serversSummary([{ status: "ready", mode: "use" }, { status: "needs_sign_in", mode: "ask" }]), "2 servers, 1 needs you");
  assert.equal(
    serversSummary([{ status: "needs_sign_in", mode: "ask" }, { status: "waiting_for_ok", mode: "ask" }, { status: "needs_sign_in", mode: "off" }]),
    "3 servers, 2 need you",
    "an Off server never needs the person",
  );
});

test("tool classes use plain words and the risky ones always ask", () => {
  assert.equal(toolClassLabel("send"), "Sends");
  assert.equal(toolClassLabel("pay"), "Spends money");
  assert.equal(toolClassLabel("config"), "Changes settings");
  assert.equal(toolClassLabel("delete"), "Deletes");
  assert.equal(toolClassLabel("read"), "Reads");
  assert.equal(toolClassLabel("???"), "Changes data");
  assert.deepEqual(["send", "pay", "config", "delete", "write", "read"].map(toolAlwaysAsks), [true, true, true, true, false, false]);
});

test("the catalog filters by words and category, with what is added last", () => {
  const rows = [
    row({ id: "linear", name: "linear", category: "projects", description: "Find, create, and update Linear issues." }),
    row({ id: "intercom", name: "intercom", category: "messaging", description: "Conversations, tickets and customer data." }),
    row({ id: "asana", name: "asana", category: "projects", description: "Tasks and goals.", added: true }),
    row({ id: "stripe", name: "stripe", category: "payments", description: "Payments, customers and invoices." }),
  ];
  assert.deepEqual(filterCatalog(rows, "", "").map((r) => r.id), ["intercom", "linear", "stripe", "asana"]);
  assert.deepEqual(filterCatalog(rows, "", "projects").map((r) => r.id), ["linear", "asana"]);
  assert.deepEqual(filterCatalog(rows, "  INVOICE ", "").map((r) => r.id), ["stripe"]);
  assert.deepEqual(filterCatalog(rows, "messaging", "").map((r) => r.id), ["intercom"], "the category's own label matches");
  assert.deepEqual(filterCatalog(rows, "nothing like this", ""), []);
  assert.deepEqual(catalogCategories(rows).map((c) => c.label), ["Messaging", "Payments", "Projects and tasks"]);
  assert.equal(categoryLabel("brand-new"), "Brand-new", "a category the app has no word for still reads");
});

test("a catalog server asks only for what it needs", () => {
  const asana = row({
    fields: [
      { name: "ASANA_CLIENT_ID", prompt: "Client ID", secret: false, required: true },
      { name: "ASANA_CLIENT_SECRET", prompt: "Client secret", secret: true, required: true },
      { name: "NOTE", prompt: "A note", secret: false, required: false },
    ],
  });
  assert.deepEqual(missingFields(asana, {}).map((f) => f.name), ["ASANA_CLIENT_ID", "ASANA_CLIENT_SECRET"]);
  assert.deepEqual(missingFields(asana, { ASANA_CLIENT_ID: "a", ASANA_CLIENT_SECRET: "   " }).map((f) => f.name), ["ASANA_CLIENT_SECRET"]);
  assert.deepEqual(missingFields(asana, { ASANA_CLIENT_ID: "a", ASANA_CLIENT_SECRET: "b" }), []);
  assert.deepEqual(missingFields(row(), {}), []);
});

test("names and addresses are checked the way the API checks them", () => {
  for (const ok of ["linear", "hugging_face", "n8n-official", "A1"]) assert.equal(nameProblem(ok), null, ok);
  for (const bad of ["", "a b", "-x", "../x", "x".repeat(49)]) assert.notEqual(nameProblem(bad), null, bad);
  assert.equal(urlProblem("https://mcp.example.com/mcp"), null);
  assert.equal(urlProblem(" http://mcp.example.com:8080/x "), null);
  for (const bad of ["", "mcp.example.com", "ftp://x.example/", "javascript:alert(1)", "https://u:p@x.example/", "https://x.example/#a"]) {
    assert.notEqual(urlProblem(bad), null, bad);
  }
  assert.equal(suggestName("https://mcp.linear.app/mcp"), "linear");
  assert.equal(suggestName("https://www.notes.example.com/x"), "notes");
  assert.equal(suggestName("not a url"), "");
});

test("typed arguments split like a shell for the simple cases and round-trip", () => {
  assert.deepEqual(parseArgs("-y @scope/pkg --name 'my notes' \"a b\""), ["-y", "@scope/pkg", "--name", "my notes", "a b"]);
  assert.deepEqual(parseArgs("   "), []);
  assert.deepEqual(parseArgs('"" x'), ["", "x"]);
  assert.equal(formatArgs(["-y", "my notes", ""]), '-y "my notes" ""');
  assert.deepEqual(parseArgs(formatArgs(["a", "b c", "d"])), ["a", "b c", "d"]);
});

test("environment lines are NAME=value", () => {
  assert.deepEqual(parseEnv("API_KEY=abc\n# comment\n\nMODE=a=b\r\nEMPTY="), { env: { API_KEY: "abc", MODE: "a=b", EMPTY: "" } });
  assert.match(parseEnv("API_KEY=abc\nnonsense").error, /Line 2/);
  assert.match(parseEnv("1BAD=x").error, /Line 1/);
  assert.equal(parseEnv("").error, undefined);
});

test("a row shows the address or the exact command", () => {
  assert.equal(serverTarget({ transport: "remote", url: "https://mcp.linear.app/mcp" }), "mcp.linear.app/mcp");
  assert.equal(serverTarget({ transport: "remote", url: "https://mcp.stripe.com" }), "mcp.stripe.com");
  assert.equal(serverTarget({ transport: "command", command: "npx", args: ["-y", "my pkg"] }), 'npx -y "my pkg"');
  assert.equal(commandLine({ command: "srv" }), "srv");
});

test("an empty tools list says why, not that the server has none", () => {
  const ok = { status: "ready", mode: "ask" };
  assert.equal(toolsEmptyText(ok), "No tools listed.");
  assert.match(toolsEmptyText({ ...ok, mode: "off" }), /Turn it on/);
  assert.match(toolsEmptyText({ ...ok, status: "not_approved" }), /Add it first/);
  assert.match(toolsEmptyText({ ...ok, status: "waiting_for_ok" }), /Approve its card/);
  assert.match(toolsEmptyText({ ...ok, status: "unavailable" }), /not available/);
});
