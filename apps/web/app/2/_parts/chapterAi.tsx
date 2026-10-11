import type { ReactNode } from "react";
import { FigAgents, FigClarify, FigModels, FigProposal } from "./aiFigures";
import { Caption, ChapterHead, Fn, Footnotes, Page, Rv } from "./ui";

/** One numbered section of a chapter: margin number and note, text, figure. */
export function Entry({
  num,
  title,
  note,
  children,
  figure,
  fig,
  caption,
}: {
  num: string;
  title: ReactNode;
  note?: string;
  children: ReactNode;
  figure: ReactNode;
  fig: string;
  caption: ReactNode;
}) {
  return (
    <article className="grid gap-x-10 gap-y-7 border-b border-[var(--rule)] py-12 last:border-b-0 sm:py-16 lg:grid-cols-[180px_minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <Rv className="flex items-baseline gap-4 lg:block">
        <span className="d2-mono text-sm text-[var(--verm-2)]">§ {num}</span>
        {note ? (
          <p aria-hidden className="d2-hand hidden max-w-[150px] -rotate-3 text-[1.35rem] leading-[1.1] text-[var(--ink-3)] lg:mt-5 lg:block">
            {note}
          </p>
        ) : null}
      </Rv>
      <Rv delay={60} className="min-w-0">
        <h3 className="d2-serif text-[1.85rem] leading-[1.1] tracking-[-0.01em] text-balance sm:text-[2.2rem]">{title}</h3>
        <div className="d2-soft mt-4 space-y-4 text-[1.02rem] leading-relaxed">{children}</div>
      </Rv>
      <Rv as="figure" delay={120} className="min-w-0 lg:pt-1">
        {figure}
        <Caption fig={fig}>{caption}</Caption>
      </Rv>
    </article>
  );
}

/** Chapter 1: the assistant, on the subscription you already have. */
export default function ChapterAi() {
  return (
    <section id="ai" aria-labelledby="ai-title" className="py-20 sm:py-28">
      <Page>
        <ChapterHead
          n={1}
          head="The assistant"
          headingId="ai-title"
          title="Bring the AI you already pay for."
          lead="Sign in with your Claude or ChatGPT subscription, or pick any model with your own key. The assistant drafts plans you review, suggestions fill in the details while you clarify, and your own agents connect straight in."
        />

        <Entry
          num="1.1"
          note="the plan you already have"
          title="Sign in with Claude or ChatGPT."
          fig="1.1"
          caption="The same chat on five different sign-ins. The model is chosen per chat."
          figure={<FigModels />}
        >
          <p>
            Claude Code and Codex use the sign-in already on your computer
            <Fn n={1} />, so the assistant runs on your Claude or ChatGPT plan.
          </p>
          <p>
            Or use OpenCode Go, local models through Ollama, or an API key for OpenRouter, Anthropic, OpenAI, Gemini,
            DeepSeek, xAI, Mistral and more. Switch the model for each chat.
          </p>
        </Entry>

        <Entry
          num="1.2"
          note="nothing lands without you"
          title="It proposes. You review."
          fig="1.2"
          caption="One sentence becomes a project, tasks, a doc, a sheet and six calendar blocks, waiting for review."
          figure={<FigProposal />}
        >
          <p>
            Ask for a plan in plain words. The assistant creates projects, tasks, events, docs and sheets, and places Work on
            your calendar.
          </p>
          <p>
            Bigger changes wait as a proposal. Read it through, then press{" "}
            <strong className="font-semibold text-[var(--ink)]">Apply changes</strong> to keep it or{" "}
            <strong className="font-semibold text-[var(--ink)]">Discard</strong> to drop it.
          </p>
        </Entry>

        <Entry
          num="1.3"
          note="pencilled in, then set"
          title="Suggestions while you clarify."
          fig="1.3"
          caption="Clarify, with the project, label, due date and length suggested from the words typed."
          figure={<FigClarify />}
        >
          <p>
            When you clarify an Inbox item, smart suggestions fill in the project, labels and dates from the words you typed,
            and point out a likely duplicate.
          </p>
          <p>
            Keep them, change them or ignore them. Nothing changes until you save
            <Fn n={2} />.
          </p>
        </Entry>

        <Entry
          num="1.4"
          note="your agent, your key"
          title="Plug in your own agents."
          fig="1.4"
          caption="An agent reads the agenda, adds a task and places it, through Timely's MCP server."
          figure={<FigAgents />}
        >
          <p>
            Timely runs an MCP server. Give Claude Code, Codex or any MCP client a personal key, and it can read and plan your
            calendar, tasks, docs and sheets.
          </p>
          <p>Deleting things needs the agent to confirm first, and you can revoke a key at any time.</p>
        </Entry>

        <Footnotes
          running="The assistant"
          folio={10}
          notes={[
            { n: 1, text: "Install Claude Code or Codex on the computer that runs Timely and sign in once; Settings > Agent finds it and shows your plan." },
            { n: 2, text: "Without an AI sign-in or key, Timely works exactly the same; the suggestions are simply not there." },
          ]}
        />
      </Page>
    </section>
  );
}
