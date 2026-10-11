import { Sparkles } from "lucide-react";
import Link from "next/link";
import type { HelpSection } from "../types";
import { Callout, Path, Shot, Steps } from "../ui";

export const assistant: HelpSection = {
  id: "assistant",
  title: "Assistant and AI",
  description: "Chat with the assistant, turn on smart suggestions, and connect your own agents.",
  icon: Sparkles,
  articles: [
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
          title: "Choose a provider",
          body: (
            <>
              <p>
                Open <Path>Settings &gt; Agent</Path> and set up one provider:
              </p>
              <ul>
                <li>
                  <strong>OpenRouter</strong>, one key for many models. It also powers search by meaning.
                </li>
                <li>
                  A direct API key for Anthropic, OpenAI, Google Gemini, DeepSeek, xAI, Mistral, Z.ai, Kimi, NVIDIA,
                  OpenCode, or a local or cloud Ollama. These are under <strong>More API keys</strong>.
                </li>
                <li>
                  <strong>Claude Code</strong> or <strong>Codex</strong>, if they are installed and signed in on the
                  computer that runs Timely.
                </li>
              </ul>
              <p>
                Keys are checked with a test call and stored encrypted; Timely only ever shows a hint of them. Pick a
                default provider and model, and change the model per chat at any time.
              </p>
              <Shot
                src="settings-agent"
                alt="Settings, Agent tab: the OpenRouter card with an API key field, chat model and embedding model, and the Smart suggestions section."
              />
            </>
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
                  Small changes apply straight away and show as cards you can open. Larger ones wait as{" "}
                  <strong>Needs your review</strong> until you approve them.
                </li>
                <li>Past chats are grouped by day and searchable. Applied changes stay when you delete a chat.</li>
              </ul>
            </>
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
