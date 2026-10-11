import { Sparkles } from "lucide-react";
import Link from "next/link";
import type { HelpSection } from "../types";
import { CLAUDE_CODE_URL, CODEX_URL } from "@/app/_components/site/links";
import { Callout, Code, Path, Shot, Steps } from "../ui";

export const assistant: HelpSection = {
  id: "assistant",
  title: "Assistant and AI",
  description: "Run the assistant on your own Claude or ChatGPT subscription, turn on smart suggestions, and connect your own agents.",
  icon: Sparkles,
  articles: [
    {
      slug: "subscriptions",
      title: "Use your Claude or ChatGPT subscription",
      summary: "Run the assistant on the Claude or ChatGPT plan you already pay for, or on any model with your own key.",
      keywords: [
        "subscription",
        "claude code",
        "claude pro",
        "claude max",
        "codex",
        "chatgpt",
        "chatgpt plus",
        "opencode go",
        "ollama",
        "local model",
        "provider",
        "api key",
        "openrouter",
      ],
      lead: (
        <p>
          Timely doesn&apos;t sell AI. The assistant runs on a provider you choose: the Claude or ChatGPT subscription
          you already have, a subscription such as OpenCode Go, models on your own computer, or an API key. You pick a
          default in <Path>Settings &gt; Agent</Path> and can switch the model in any chat.
        </p>
      ),
      sections: [
        {
          id: "options",
          title: "Your options",
          body: (
            <ul>
              <li>
                <strong>Claude Code</strong> uses the Claude Code app and its sign-in on your computer, so chats count
                against your Claude Pro or Max plan instead of a separate API bill.
              </li>
              <li>
                <strong>Codex</strong> does the same with the Codex app and your ChatGPT plan.
              </li>
              <li>
                <strong>OpenCode Go</strong> uses the models included in an OpenCode Go subscription, with its key.
              </li>
              <li>
                <strong>Ollama</strong> runs models on your own computer (or Ollama Cloud with a key).
              </li>
              <li>
                <strong>OpenRouter</strong> gives you hundreds of models with one key, and also powers search by
                meaning and smart suggestions.
              </li>
              <li>
                A direct key for Anthropic, OpenAI, Google Gemini, DeepSeek, xAI, Mistral, Z.ai, Kimi, NVIDIA or
                OpenCode Zen. These are under <strong>More API keys</strong>.
              </li>
            </ul>
          ),
        },
        {
          id: "claude-code",
          title: "Connect Claude Code (Claude subscription)",
          body: (
            <>
              <Steps>
                <p>
                  Install <a href={CLAUDE_CODE_URL}>Claude Code</a> on the computer that runs Timely. With the desktop
                  app, that is your own computer.
                </p>
                <div>
                  <p>Sign in once from a terminal with your Claude account:</p>
                  <Code>claude auth login</Code>
                </div>
                <p>
                  In Timely, open <Path>Settings &gt; Agent</Path>. The Claude Code card shows <strong>Found</strong>{" "}
                  and <strong>Signed in</strong> with your plan. If it doesn&apos;t, choose <strong>Re-scan</strong>.
                </p>
                <p>
                  Choose <strong>Connect</strong>. Timely makes one tiny test call; then choose{" "}
                  <strong>Use as default</strong>.
                </p>
              </Steps>
              <Callout kind="note">
                Timely runs Claude Code with every one of its own built-in tools turned off, so it can only use
                Timely&apos;s tools. Pick Fable, Opus, Sonnet or Haiku per chat; each follows the newest release.
              </Callout>
            </>
          ),
        },
        {
          id: "codex",
          title: "Connect Codex (ChatGPT subscription)",
          body: (
            <>
              <p>
                Install <a href={CODEX_URL}>Codex</a> on the same computer, sign in with your ChatGPT account, then
                choose <strong>Connect</strong> on the Codex card in <Path>Settings &gt; Agent</Path>.
              </p>
              <Code>codex login</Code>
              <p>Timely runs Codex in a read-only sandbox with its shell turned off.</p>
            </>
          ),
        },
        {
          id: "keys",
          title: "Use an API key instead",
          body: (
            <>
              <p>
                Paste a key into the provider&apos;s card and Timely checks it with a test call. Keys are stored
                encrypted and only a short hint is ever shown again. Then pick the provider&apos;s chat model and
                choose <strong>Use as default</strong>.
              </p>
              <Shot
                src="settings-agent"
                alt="Settings, Agent tab: the OpenRouter card with an API key field, chat model and embedding model, and the Smart suggestions section."
              />
            </>
          ),
        },
        {
          id: "privacy",
          title: "Where your words go",
          body: (
            <Callout kind="warning">
              Text, pictures, receipts and web searches go to the provider you selected, under your own subscription or
              key. If that provider is unavailable, the chat stops with a message: Timely never switches to another
              provider behind your back, and a request keeps the provider it started with.
            </Callout>
          ),
        },
      ],
    },
    {
      slug: "chat",
      title: "Assistant chat and quick prompt",
      summary: "Ask the assistant to plan, create and change things, and approve what it does.",
      keywords: ["assistant", "chat", "ai", "agent", "quick prompt", "openrouter", "claude", "provider", "model"],
      lead: (
        <p>
          The assistant can do almost anything you can do in Timely: create projects and tasks, plan your week, write
          docs, fill sheets, and answer questions about your work. It uses the AI provider and model you choose, with
          your own key.
        </p>
      ),
      sections: [
        {
          id: "set-up",
          title: "Choose what it runs on",
          body: (
            <p>
              Connect your Claude or ChatGPT subscription, or add a key, in <Path>Settings &gt; Agent</Path>. See{" "}
              <Link href="/help/assistant/subscriptions">Use your Claude or ChatGPT subscription</Link>. Pick a
              default, and change the model in any chat from the menu next to the send button.
            </p>
          ),
        },
        {
          id: "chat",
          title: "Chat",
          body: (
            <>
              <p>
                Open <strong>Chat</strong> in the sidebar (<kbd>g</kbd> then <kbd>a</kbd>). Describe what you want in
                your own words, attach pictures if they help, and turn on web search when the answer needs it.
              </p>
              <Shot
                src="chat"
                alt="The Chat page: conversation history on the left and a welcome screen with example prompts: Start a project, Build a budget, Make room to learn, Save a receipt."
              />
              <ul>
                <li>
                  The assistant sees what is on your screen: the open doc, task or project, selected text, and the
                  calendar view. These show as chips you can remove.
                </li>
                <li>
                  A request keeps running if you leave the chat; follow it in the <strong>Activity island</strong> in
                  the sidebar, or stop it there. Changes made before you stop are kept.
                </li>
                <li>Past chats are grouped by day and searchable. Applied changes stay when you delete a chat.</li>
              </ul>
            </>
          ),
        },
        {
          id: "what-it-can-do",
          title: "What it can do",
          body: (
            <ul>
              <li>
                <strong>Plan:</strong> break a goal into a project with stages and tasks, set lengths and deadlines,
                and place the Work on your calendar with Auto-schedule.
              </li>
              <li>
                <strong>Organize:</strong> create, move and update tasks, checklists, labels, repeats and dependencies;
                set your Today focus; capture to the Inbox; add habits and goals.
              </li>
              <li>
                <strong>Calendar:</strong> add, move and delete events, and find free time.
              </li>
              <li>
                <strong>Write:</strong> create docs, append to them or rewrite them, and build sheets with columns,
                rows and tabs. See <Link href="/help/notes/docs#assistant">Docs</Link> and{" "}
                <Link href="/help/notes/sheets#assistant">Sheets</Link>.
              </li>
              <li>
                <strong>Answer:</strong> what to do next, what is overdue, how busy a week is, or what a doc says.
                Turn on web search when it needs to look something up.
              </li>
              <li>
                <strong>Settings:</strong> working hours, notifications, saved views, exports and backups.
              </li>
            </ul>
          ),
        },
        {
          id: "review",
          title: "Review before anything changes",
          body: (
            <>
              <p>
                A single small change, like adding one task, is applied straight away and shows as a card you can
                open. Anything bigger waits as a proposal marked <strong>Needs your review</strong>: plans with several
                steps, bulk edits, changes to a repeating series, replacing a doc&apos;s text, and filling or clearing a
                sheet.
              </p>
              <p>
                The proposal lists every change. <strong>Apply changes</strong> writes them, a reply in the chat asks
                for a different version first, and <strong>Discard</strong> writes nothing.
              </p>
            </>
          ),
        },
        {
          id: "receipts",
          title: "Receipts to your expense sheet",
          body: (
            <p>
              Attach a photo of a receipt (up to five photos of one receipt) and the assistant reads the shop, date,
              currency and total. Check the details, choose the expense sheet, and confirm; nothing is saved to the
              sheet before that. Receipt photos are removed after you confirm, or after 24 hours.
            </p>
          ),
        },
        {
          id: "quick-prompt",
          title: "Quick prompt",
          body: (
            <>
              <p>
                Press <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>J</kbd> on any page to ask from a bar at the bottom. While
                the assistant works, the bar tucks into the <strong>Activity island</strong> in the sidebar; click it
                to see the reply.
              </p>
              <Shot src="quick-prompt" alt="The quick prompt bar open over the Today page, with a Today context chip and the model picker." />
            </>
          ),
        },
        {
          id: "phone",
          title: "On the phone",
          body: (
            <p>
              Pinch inward with two fingers on any screen to ask about it. The phone can also take a photo of a
              receipt and turn it into fields for you to check.
            </p>
          ),
        },
      ],
    },
    {
      slug: "smart-suggestions",
      title: "Smart suggestions",
      summary: "Suggestions across Inbox, search, tasks, docs and Today, powered by Jev.",
      keywords: ["smart suggestions", "jev", "typesafe", "suggest", "ai", "hints"],
      lead: (
        <p>
          Smart suggestions add small, specific hints across Timely: a likely project for an Inbox item, a better
          order for search results, a nudge about stale work. They use Jev, a model that answers short typed
          questions quickly. Without a key, Timely works exactly the same, just without the hints.
        </p>
      ),
      sections: [
        {
          id: "turn-on",
          title: "Turn them on",
          body: (
            <Steps>
              <p>
                Open <Path>Settings &gt; Agent</Path>.
              </p>
              <p>Add a TypeSafe key, or an OpenRouter key; Timely uses TypeSafe first and OpenRouter as a fallback.</p>
              <p>
                Under <strong>Smart suggestions</strong>, turn the switch on and use <strong>Test</strong> to check it
                answers.
              </p>
            </Steps>
          ),
        },
        {
          id: "where",
          title: "Where they show up",
          body: (
            <ul>
              <li>
                <strong>Inbox and Clarify:</strong> project, labels, dates and length, read from the item&apos;s words.
                Quick add suggests a length too.
              </li>
              <li>
                <strong>Search:</strong> better ordering, weak matches tucked away, &ldquo;Create …&rdquo; commands,
                and Related lists on tasks, projects and docs.
              </li>
              <li>
                <strong>Tasks and projects:</strong> task hints, reviews of stale work, project insights, cleanup of
                near-duplicates, and &ldquo;Start from&rdquo;.
              </li>
              <li>
                <strong>Docs:</strong> a suggestions card, Move to page, linking a selection to an item, tidying pasted
                text, and template hints for new docs.
              </li>
              <li>
                <strong>Today and calendar:</strong> focus suggestions, free gaps, and time for deep work.
              </li>
              <li>
                <strong>Notifications:</strong> smart alerts and a morning briefing.
              </li>
              <li>
                <strong>Assistant chat:</strong> it picks the tools it needs and points you to an earlier chat on the
                same topic.
              </li>
            </ul>
          ),
        },
        {
          id: "control",
          title: "Keep them in check",
          body: (
            <Callout kind="note">
              Suggestions never change anything on their own; you accept or dismiss each one. Dismiss the same kind of
              alert a few times and Timely shows it less. <Path>Settings &gt; Agent</Path> can reset what it has
              learned.
            </Callout>
          ),
        },
      ],
    },
    {
      slug: "mcp",
      title: "Connect an agent with MCP",
      summary: "Give an outside agent such as Hermes access to your planner with a personal API key.",
      keywords: ["mcp", "model context protocol", "api key", "hermes", "agent", "integration", "tools"],
      lead: (
        <p>
          Timely runs an MCP server, so an outside agent can read and change your planner with more than 150 tools:
          tasks, projects, the calendar, Auto-schedule, docs, sheets, notifications and backups.
        </p>
      ),
      sections: [
        {
          id: "key",
          title: "Create a key",
          body: (
            <>
              <Steps>
                <p>
                  Open <Path>Settings &gt; Integrations</Path>.
                </p>
                <p>
                  Name the key and choose <strong>Create key</strong>. Copy the secret now; it is shown only once.
                </p>
                <p>
                  Copy the <strong>MCP server address</strong> shown on the same page into your agent&apos;s settings,
                  with the key as a bearer token.
                </p>
              </Steps>
              <Shot
                src="settings-integrations"
                alt="Settings, Integrations tab: the MCP server address with a Copy button, a key name field and the list of active keys."
              />
            </>
          ),
        },
        {
          id: "what-agents-can-do",
          title: "What an agent can do",
          body: (
            <>
              <p>
                Agents are told to start by reading your workspaces, projects, working hours and saved views, and to
                ask which workspace to use for new Work. Changes they make show in activity as made by{" "}
                <em>Hermes</em>.
              </p>
              <p>
                Deleting a workspace, project or doc, and restoring a backup, need an explicit confirmation from the
                agent. Revoke a key at any time from the same page.
              </p>
              <Callout kind="tip">
                In the desktop app the address points straight at the server on your computer, and includes its
                Tailscale address when <Link href="/help/install/android#away-from-home">Tailscale access</Link> is on.
              </Callout>
            </>
          ),
        },
      ],
    },
  ],
};
