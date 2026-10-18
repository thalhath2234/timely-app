import { Sparkles } from "lucide-react";
import type { HelpSection } from "../types";
import { CLAUDE_CODE_URL, CODEX_URL, TYPESAFE_URL } from "@/app/_components/site/links";
import { Callout, Code, HelpLink, Path, Shot, Steps, Still } from "../ui";

export const assistant: HelpSection = {
  id: "assistant",
  title: "Assistant and AI",
  description: "Run the assistant on your own Claude or ChatGPT subscription, turn on smart suggestions, and connect your own agents.",
  icon: Sparkles,
  articles: [
    {
      slug: "subscriptions",
      title: "Use your Claude or ChatGPT subscription",
      summary: "Run the assistant on the Claude or ChatGPT plan you already have, or on any model with your own key.",
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
        "more api keys",
        "openrouter",
        "anthropic",
        "openai",
        "gemini",
        "default model",
        "free",
      ],
      lead: (
        <p>
          Timely is free and open source, and it doesn&apos;t sell AI. The assistant runs on a provider you choose: the
          Claude or ChatGPT subscription you already have, a subscription such as OpenCode Go, models on your own
          computer, or an API key. You only pay a provider if you choose one that charges. You pick a default in{" "}
          <Path>Settings &gt; Agent</Path> and can switch the model in any chat.
        </p>
      ),
      sections: [
        {
          id: "options",
          title: "Your options",
          body: (
            <>
              <p>
                <Path>Settings &gt; Agent</Path> shows the <strong>OpenRouter</strong> card first, then{" "}
                <strong>Smart suggestions</strong>, then <strong>More API keys</strong>, then the{" "}
                <strong>Claude Code</strong> and <strong>Codex</strong> cards.
              </p>
              <ul>
                <li>
                  <strong>Claude Code</strong> uses the Claude Code app and its sign-in on your computer, so chats count
                  against your Claude Pro or Max plan instead of a separate API bill.
                </li>
                <li>
                  <strong>Codex</strong> does the same with the Codex app and your ChatGPT plan.
                </li>
                <li>
                  <strong>OpenRouter</strong> gives you hundreds of models with one key. It also powers search by
                  meaning, and smart suggestions can use it.
                </li>
                <li>
                  <strong>More API keys</strong> opens a list of direct providers: Anthropic API, OpenAI API, Google
                  Gemini, DeepSeek, xAI Grok, Mistral, Z.ai (GLM), Kimi (Moonshot), Ollama, NVIDIA NIM, OpenCode Zen and
                  OpenCode Go. Ollama runs models on your own computer and needs no key (only Ollama Cloud does);
                  OpenCode Go uses the models in an OpenCode Go subscription.
                </li>
              </ul>
            </>
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
                  and <strong>Signed in</strong> with your account. If it doesn&apos;t, choose <strong>Re-scan</strong>.
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
                Paste a key into the OpenRouter card, or open <strong>More API keys</strong> and choose a provider.
                Timely checks the key with a test call. Keys are stored encrypted and only a short hint is ever shown
                again. Then pick the provider&apos;s chat model and choose <strong>Use as default</strong>.
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
              key. Pictures and receipts sent through OpenRouter use its zero-data-retention route. If the provider is
              unavailable, the chat stops with a message: Timely never switches to another provider behind your back,
              and a request keeps the provider it started with.
            </Callout>
          ),
        },
      ],
    },
    {
      slug: "chat",
      title: "Assistant chat and quick prompt",
      summary: "Ask the assistant to plan, create and change things, approve what it does, and draft text with Help me write.",
      keywords: [
        "assistant",
        "chat",
        "ai",
        "agent",
        "quick prompt",
        "activity island",
        "model picker",
        "openrouter",
        "claude",
        "codex",
        "provider",
        "model",
        "receipt",
        "expense sheet",
        "help me write",
        "pinch",
        "phone assistant",
        "web search",
      ],
      lead: (
        <p>
          The assistant can do most of what you can do in Timely: create projects and tasks, plan your week, write
          docs, fill sheets, and answer questions about your work. It uses the AI provider and model you choose.
        </p>
      ),
      sections: [
        {
          id: "set-up",
          title: "Choose what it runs on",
          body: (
            <>
              <p>
                Connect your Claude or ChatGPT subscription, or add a key, in <Path>Settings &gt; Agent</Path>. See{" "}
                <HelpLink href="/help/assistant/subscriptions">Use your Claude or ChatGPT subscription</HelpLink>.
              </p>
              <p>
                The model menu sits in the bar under your message. <strong>Default</strong> uses the provider and model
                from <Path>Settings &gt; Agent</Path>. When more than one provider is connected, tabs such as{" "}
                <strong>Claude Code</strong>, <strong>Codex</strong> and <strong>OpenRouter</strong> let you pick
                another one and search its models. A pick applies to that chat only.
              </p>
            </>
          ),
        },
        {
          id: "chat",
          title: "Chat",
          body: (
            <>
              <p>
                Open <strong>Chat</strong> in the sidebar. Describe what you want in your own words, attach pictures if
                they help, and turn on <strong>Web search</strong> when the answer needs it. Web search is off for a
                chat with pictures.
              </p>
              <Still
                id="assistant"
                alt="The Chat page: the Chats list on the left, a conversation in which the assistant proposes four changes to the launch week and shows the calendar it would make, and the prompt box with Web search and the model menu."
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
                <li>Search past chats from <strong>Search chats</strong>. Applied changes stay when you delete a chat.</li>
              </ul>
            </>
          ),
        },
        {
          id: "what-it-can-do",
          title: "What it can do",
          body: (
            <>
              <ul>
                <li>
                  <strong>Plan:</strong> break a goal into a project with stages and tasks, set lengths and deadlines,
                  and place the Work on your calendar with Auto-schedule.
                </li>
                <li>
                  <strong>Organize:</strong> create, move and update tasks, checklists, labels, repeats and
                  dependencies; set your Today focus; capture to the Inbox; add habits and goals.
                </li>
                <li>
                  <strong>Calendar:</strong> add and move events, and find free time.
                </li>
                <li>
                  <strong>Write:</strong> create docs, append to them or rewrite them, and build sheets with columns,
                  rows and tabs. See <HelpLink href="/help/notes/docs#assistant">Docs</HelpLink> and{" "}
                  <HelpLink href="/help/notes/sheets#assistant">Sheets</HelpLink>.
                </li>
                <li>
                  <strong>Views:</strong> make a saved view from plain words, such as &ldquo;overdue work in Home,
                  grouped by priority&rdquo;.
                </li>
                <li>
                  <strong>Answer:</strong> what to do next, what is overdue, how busy a week is, or what a doc or sheet
                  says.
                </li>
              </ul>
              <Callout kind="note">
                The assistant in Timely can&apos;t delete whole tasks, projects, events, docs, sheets or workspaces, and
                it doesn&apos;t change your settings, exports or backups. You do those yourself.
              </Callout>
            </>
          ),
        },
        {
          id: "review",
          title: "Review before anything changes",
          body: (
            <>
              <p>
                A single small change, like adding one task, is applied straight away and shows as a card you can
                open. Anything bigger waits as a proposal marked <strong>Ready for your review</strong>: plans with
                several steps, bulk edits, changes to a repeating series, replacing a doc&apos;s text, filling a sheet,
                deleting sheet rows, columns or tabs, and applying Auto-schedule.
              </p>
              <p>
                The proposal lists every change. <strong>Apply changes</strong> writes them, a reply in the chat asks
                for a different version first, and <strong>Discard</strong> writes nothing. With smart suggestions on,
                changes that need a closer look are listed under <strong>Worth a check before you apply</strong>.
              </p>
            </>
          ),
        },
        {
          id: "receipts",
          title: "Receipts to your expense sheet",
          body: (
            <>
              <Steps>
                <p>
                  Attach up to five photos of one receipt. The assistant reads the shop, date, currency, items and
                  total.
                </p>
                <p>
                  Check the details under <strong>Review your receipt</strong>. Anything it is unsure of is listed
                  under <strong>Needs your review</strong>.
                </p>
                <p>
                  Choose the <strong>Expense sheet</strong> (or <strong>Create a new expense sheet</strong>) and the{" "}
                  <strong>Expense summary tab</strong>, such as this month&apos;s tab. With a sheet open in the chat,
                  Timely starts with that sheet and tab.
                </p>
                <p>
                  Choose <strong>Review sheet changes</strong>, then <strong>Apply changes</strong>. Nothing is saved
                  to the sheet before that.
                </p>
              </Steps>
              <p>
                One summary row goes on the expense tab, and every item goes on an <strong>Items</strong> tab, linked
                by a receipt ID. If the receipt looks like one you already saved, Timely says so and lets you update
                the existing entry. Receipt photos are removed when you apply, when you choose{" "}
                <strong>Discard receipt</strong>, or 24 hours after upload.
              </p>
            </>
          ),
        },
        {
          id: "quick-prompt",
          title: "Quick prompt and the Activity island",
          body: (
            <>
              <p>
                Press <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>J</kbd> (<kbd>Cmd</kbd> <kbd>Shift</kbd> <kbd>J</kbd> on a
                Mac) on any page to ask from a bar at the bottom. It starts with the page you are on as a chip, and has
                the same <strong>Web search</strong> switch and model menu as Chat.
              </p>
              <p>
                While the assistant works, the bar tucks into the <strong>Activity island</strong> in the sidebar.
                Click it to see the reply. The island also lists chats still running, chats that replied, a running
                focus session or Pomodoro, and Auto-schedule while it works.
              </p>
              <Shot
                src="quick-prompt"
                alt="The quick prompt bar open over the Today page, with a Today context chip, Web search and the model menu."
              />
            </>
          ),
        },
        {
          id: "help-me-write",
          title: "Help me write",
          body: (
            <p>
              <strong>Help me write</strong> drafts and rewrites text inside a doc, or a task or project description,
              on the desktop and the phone. You see the draft before anything goes in. It runs on the same provider as
              chat, so it needs Claude Code, Codex or an API key in <Path>Settings &gt; Agent</Path>; a TypeSafe key
              alone is not enough. See <HelpLink href="/help/notes/docs">Docs</HelpLink> for how to use it.
            </p>
          ),
        },
        {
          id: "phone",
          title: "On the phone",
          body: (
            <>
              <p>
                Pinch inward with two fingers on any screen to ask about it. The new chat takes the screen you pinched
                on: the task, project, doc, event or calendar day in front of you. Starting a new chat inside the
                assistant does the same. Screens where a pinch zooms keep their normal gesture.
              </p>
              <ul>
                <li>A request keeps running after you close the assistant.</li>
                <li>Long-press a chat in the assistant to rename or delete it.</li>
                <li>
                  Take a photo of a receipt and check its details before <strong>Save receipt</strong> adds it to your
                  expense sheet.
                </li>
                <li>A view made from the phone is a list or a board.</li>
              </ul>
            </>
          ),
        },
      ],
    },
    {
      slug: "smart-suggestions",
      title: "Smart suggestions",
      summary:
        "Hints across Inbox, tasks, docs, search and Today, powered by Jev with your TypeSafe or OpenRouter key.",
      keywords: [
        "smart suggestions",
        "jev",
        "typesafe",
        "openrouter",
        "suggest",
        "ai",
        "hints",
        "up next",
        "task hints",
        "doc suggestions",
        "make task",
        "reads like a task",
        "smart alerts",
        "morning briefing",
        "learned",
      ],
      lead: (
        <p>
          Smart suggestions add small, specific hints across Timely: what an Inbox item looks like, a status or blocker
          for a task, lines in a doc that could be tasks. They use Jev, <a href={TYPESAFE_URL}>TypeSafe</a>&apos;s
          fast decision model. Without a key, Timely works exactly the same: nothing is filled in for you and every
          field stays yours to fill.
        </p>
      ),
      sections: [
        {
          id: "how",
          title: "How they work",
          body: (
            <>
              <Still
                id="suggestions"
                alt="A task made from an Inbox item, with Priority, Duration, Deadline and Project marked Suggested, each with how sure Jev was, and Accept all and Change buttons."
              />
              <p>
                Timely asks Jev short, typed questions, such as &ldquo;which of these projects fits this item?&rdquo; or
                &ldquo;does this read like a task: yes or no?&rdquo;. Jev picks one of the given answers and says how
                sure it is. Timely only shows a suggestion when Jev is sure enough; otherwise you see nothing.
              </p>
              <p>
                Timely asks TypeSafe first. If TypeSafe is busy, slow or refuses the key, it asks again through
                OpenRouter, when you have an OpenRouter key. With no key, or with the switch off, Timely makes no call
                at all. Receipt photos and receipt amounts are never sent.
              </p>
            </>
          ),
        },
        {
          id: "turn-on",
          title: "Turn them on",
          body: (
            <>
              <Steps>
                <p>
                  Open <Path>Settings &gt; Agent</Path> (on the phone too).
                </p>
                <p>
                  In the <strong>Smart suggestions</strong> card, paste a <strong>TypeSafe API key</strong> and choose{" "}
                  <strong>Save</strong>. An OpenRouter key on the OpenRouter card works too.
                </p>
                <p>
                  Turn the switch on and use <strong>Test</strong> to check it answers.
                </p>
              </Steps>
              <p>
                The line under the description says which key is in use. <strong>Needs a key</strong> means the
                switch is on but no key is saved yet.
              </p>
            </>
          ),
        },
        {
          id: "where",
          title: "Where they show up",
          body: (
            <ul>
              <li>
                <strong>Inbox:</strong> the <strong>Up next</strong> card shows what each capture looks like: a task,
                how long it takes, and when it is due. The Clarify form opens already filled in, and Quick add
                suggests a length.
              </li>
              <li>
                <strong>Task details:</strong> a short list of hints, such as a status or stage the description reads
                like, a field to fill in, a blocker it seems to wait on, or keeping it in one sitting. Each has a
                button, such as <strong>Set status</strong> or <strong>Set as blocker</strong>, and you can dismiss
                it.
              </li>
              <li>
                <strong>Docs:</strong> lines that read like tasks, with <strong>Make task</strong>. A line that is
                already a task, even after you edit it, is not offered again, and a dismissed suggestion stays
                dismissed for that doc on every device. Docs also get hints for where a doc belongs, its type,
                properties and a template, a link for selected text, and a note when a doc looks out of date. See{" "}
                <HelpLink href="/help/notes/docs">Docs</HelpLink>.
              </li>
              <li>
                <strong>Search:</strong> better ordering, weak matches tucked away, &ldquo;Create …&rdquo; commands,
                and Related lists on tasks, projects and docs.
              </li>
              <li>
                <strong>Projects and workspaces:</strong> work idle for three weeks, how a project is going,
                &ldquo;Start from&rdquo; templates, and labels or statuses that mean the same.
              </li>
              <li>
                <strong>Today and calendar:</strong> work worth focusing on, the best task for your next free gap, and
                a next step for missed or overdue work.
              </li>
              <li>
                <strong>Sheets and receipts:</strong> a template for a new sheet, column types for an imported CSV,
                and a category and sheet for a receipt.
              </li>
              <li>
                <strong>Notifications:</strong> smart alerts and a morning briefing.
              </li>
              <li>
                <strong>Assistant chat:</strong> it narrows the tools the assistant gets and points you to an earlier
                chat on the same topic.
              </li>
            </ul>
          ),
        },
        {
          id: "control",
          title: "Keep them in check",
          body: (
            <>
              <Callout kind="note">
                Suggestions never change anything until you save or apply; you accept or dismiss each one.
              </Callout>
              <ul>
                <li>
                  When you change most of one kind of suggestion, that kind only shows up when it is surer.{" "}
                  <strong>What suggestions learned</strong> lists each kind, and <strong>Reset</strong> sets one back.
                </li>
                <li>
                  Dismiss the same kind of smart alert on a few days and Timely leaves it out for a while.
                </li>
                <li>
                  <strong>Best time for deep work</strong> and <strong>What you use Timely for</strong> help it fit
                  hints and starter labels to you.
                </li>
              </ul>
            </>
          ),
        },
      ],
    },
    {
      slug: "mcp",
      title: "Connect an agent with MCP",
      summary: "Give an outside agent such as Hermes, OpenClaw, Claude Code or Codex access to your planner with a personal API key.",
      keywords: [
        "mcp",
        "model context protocol",
        "api key",
        "api keys",
        "integrations",
        "hermes",
        "openclaw",
        "claude code",
        "codex",
        "agent",
        "integration",
        "tools",
        "revoke",
        "sheets",
        "tabs",
        "bearer token",
      ],
      lead: (
        <p>
          Timely runs an MCP server over HTTP, so an outside agent can read and change your planner with more than 150
          tools. Any MCP client works: Hermes, OpenClaw, Claude Code, Codex or your own agent. It signs in with a
          personal API key that you can revoke at any time.
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
                  Open <Path>Settings &gt; Integrations</Path>. On the phone, open <Path>Settings &gt; API keys</Path>.
                </p>
                <p>
                  Name the key and choose <strong>Create key</strong>. Copy the secret now; it is shown only once.
                </p>
                <p>
                  Copy the <strong>MCP server address</strong> shown on the same page into your agent&apos;s settings,
                  with the key as a bearer token in the <code>Authorization</code> header.
                </p>
              </Steps>
              <Still
                id="agents"
                alt="Settings, Integrations tab: the active keys for two agents with Revoke buttons, Create key, the MCP endpoint on the tailnet, and a log of the tool calls the agents made."
              />
              <p>
                For Hermes, choose <strong>Copy Hermes snippet</strong> after creating the key and paste it into{" "}
                <code>~/.hermes/config.yaml</code>:
              </p>
              <Code>{`mcp_servers:
  timely:
    url: "<MCP server address>"
    headers:
      Authorization: "Bearer tk_..."`}</Code>
              <Callout kind="tip">
                In the desktop app the address points straight at the server on your computer and works while Timely
                is running. The page also lists its Tailscale address when{" "}
                <HelpLink href="/help/install/android#away-from-home">Tailscale access</HelpLink> is on.
              </Callout>
            </>
          ),
        },
        {
          id: "tools",
          title: "What an agent can use",
          body: (
            <>
              <p>Agents are told to call <code>get_context</code> first. The tools cover:</p>
              <ul>
                <li>Your workspaces, statuses, labels, custom fields, projects and stages.</li>
                <li>Tasks, checklists, repeats, dependencies, comments, bulk edits and the Inbox.</li>
                <li>Today, focus sessions, habits and goals.</li>
                <li>The calendar, events, free time, Auto-schedule and undo.</li>
                <li>Saved views.</li>
                <li>Docs and sheets, including sheet templates.</li>
                <li>Search by keyword and by meaning.</li>
                <li>Notifications, reminders and failed jobs.</li>
                <li>Settings, exports, backups and restore.</li>
              </ul>
              <p>
                Changes an agent makes apply straight away; there is no review step like in Timely&apos;s own chat.
                Deleting a workspace, project or doc, deleting a backup and restoring a backup need an explicit
                confirmation from the agent. Task changes show in activity as made by <em>Hermes</em>, whichever agent
                made them.
              </p>
            </>
          ),
        },
        {
          id: "sheets",
          title: "Sheets through an agent",
          body: (
            <>
              <p>
                A sheet can have several tabs, such as one per month. Tools that read or edit cells, rows and columns
                take a tab by its name, such as &ldquo;October&rdquo;, so an entry never lands on the wrong tab. On a
                sheet with several tabs the agent has to name one.
              </p>
              <ul>
                <li>
                  <code>get_sheet</code> reads the raw grid and formulas, and <code>get_sheet_values</code> reads the
                  worked-out numbers.
                </li>
                <li>
                  <code>add_sheet_row</code> adds one entry in the next free row, and <code>update_sheet_cells</code>{" "}
                  changes cells in one row.
                </li>
                <li>
                  <code>delete_sheet_rows</code> and <code>delete_sheet_column</code> update formulas on every tab, as
                  in the apps. A formula that read a deleted cell shows <code>#REF!</code>.
                </li>
              </ul>
              <Callout kind="warning">
                <code>update_sheet</code> saves a whole grid exactly as the agent sends it and does not fix formula
                references. Ask your agent to use the row, cell and column tools for everyday edits.
              </Callout>
            </>
          ),
        },
        {
          id: "revoke",
          title: "Revoke a key",
          body: (
            <p>
              Under <strong>Active keys</strong>, each key shows when it was created and last used. Choose{" "}
              <strong>Revoke</strong> to stop it working at once. The agent needs a new key to connect again.
            </p>
          ),
        },
      ],
    },
  ],
};
