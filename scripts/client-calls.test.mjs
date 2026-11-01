// When the apps ask the server for things that cost a model call or an
// embedding: the search box's text and timing (packages/contract/src/searchQuery.ts)
// how Settings follows a semantic-search rebuild (reindexPoll.ts), and where
// chat goes when a provider is disconnected (providerFallback.ts).
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SEARCH_QUERY, SEARCH_DEBOUNCE_MS, SEARCH_SETTLE_MS, searchQueryText } from "../packages/contract/src/searchQuery.ts";
import { reindexPollInterval } from "../packages/contract/src/reindexPoll.ts";
import { DOC_HINTS_SETTLE_MS } from "../packages/contract/src/documents.ts";
import { providerAfterRemoval } from "../packages/contract/src/providerFallback.ts";

test("a search is trimmed and a pasted page is clipped to a URL the server takes", () => {
  assert.equal(searchQueryText("  budget review  "), "budget review");
  assert.equal(searchQueryText("x".repeat(MAX_SEARCH_QUERY)), "x".repeat(MAX_SEARCH_QUERY));
  const pasted = "预算".repeat(10_000);
  const clipped = searchQueryText(pasted);
  assert.equal(Array.from(clipped).length, MAX_SEARCH_QUERY);
  // The 20,000-character paste made a 161 KB URL (HTTP 431); the clip stays
  // far under the 16 KB a Node server takes for its request line and headers.
  assert.ok(new URLSearchParams({ q: clipped }).toString().length < 8_000);
});

test("clipping never cuts an emoji in two", () => {
  const emoji = "😀".repeat(MAX_SEARCH_QUERY + 20);
  const clipped = searchQueryText(emoji);
  assert.equal(Array.from(clipped).length, MAX_SEARCH_QUERY);
  assert.ok(Array.from(clipped).every((char) => char === "😀"));
  assert.doesNotThrow(() => encodeURIComponent(clipped));
});

test("the costly searches wait for longer than a pause between words", () => {
  // The tester typed with pauses of about 420 ms: each pause asked smart suggestions once.
  assert.ok(SEARCH_DEBOUNCE_MS < 420);
  assert.ok(SEARCH_SETTLE_MS > 420);
  // A title typed one word a second was asked about at every autosave.
  assert.ok(DOC_HINTS_SETTLE_MS > 1000);
});

test("Settings follows a rebuild closely at first, then slowly, then not at all", () => {
  assert.equal(reindexPollInterval("ready", 0), false);
  assert.equal(reindexPollInterval(undefined, 0), false);
  assert.equal(reindexPollInterval("failed", 0), false);
  assert.equal(reindexPollInterval("queued", 0), 2000);
  assert.equal(reindexPollInterval("running", 59_000), 2000);
  assert.equal(reindexPollInterval("running", 61_000), 15_000);
  assert.equal(reindexPollInterval("running", 15 * 60_000 + 1), false);
});

test("Disconnect names the provider chat moves to, in the server's order", () => {
  const setup = {
    defaultProvider: "anthropic",
    localCli: true,
    openrouter: { keySet: true },
    claude: { connected: false },
    codex: { connected: true },
    apiProviders: [
      { id: "anthropic", connected: true },
      { id: "openai", connected: false },
      { id: "gemini", connected: true },
    ],
  };
  // Another direct key leads, then a CLI, and OpenRouter last.
  assert.equal(providerAfterRemoval(setup, "anthropic"), "gemini");
  const noKeys = { ...setup, apiProviders: [{ id: "anthropic", connected: true }] };
  assert.equal(providerAfterRemoval(noKeys, "anthropic"), "codex");
  assert.equal(providerAfterRemoval({ ...noKeys, localCli: false }, "anthropic"), "openrouter");
  // The tester's account: Anthropic and OpenRouter only.
  const tester = { ...noKeys, localCli: false, codex: { connected: false } };
  assert.equal(providerAfterRemoval(tester, "anthropic"), "openrouter");
  assert.equal(providerAfterRemoval({ ...tester, openrouter: { keySet: false } }, "anthropic"), "");
  // A provider that is not the default changes nothing.
  assert.equal(providerAfterRemoval(setup, "gemini"), "anthropic");
});
