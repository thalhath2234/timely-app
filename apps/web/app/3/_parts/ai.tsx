"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Sparkles } from "lucide-react";
import { useLoop } from "./motion";
import { useModKey } from "./platformKey";

const spring = { type: "spring", stiffness: 320, damping: 30 } as const;

/* ---- 1 · model: the same chat on whichever plan you sign in with ---- */

const PROVIDERS = [
  { name: "Claude Code", plan: "your Claude Pro or Max plan", tag: "signed in", model: "Sonnet (latest)" },
  { name: "Codex", plan: "your ChatGPT plan", tag: "signed in", model: "Codex default" },
  { name: "OpenCode Go", plan: "your Go subscription", tag: "", model: "From your Go plan" },
  { name: "Ollama", plan: "models on this computer", tag: "local", model: "Local model" },
  { name: "API key", plan: "OpenRouter, Anthropic, OpenAI, Gemini, DeepSeek, xAI, Mistral…", tag: "", model: "Any model you pick" },
];

function ModelDemo() {
  const { ref, frame } = useLoop(PROVIDERS.length, 1500, 0);
  const active = PROVIDERS[frame];
  return (
    <div ref={ref} className="d3-term d3-fzf" aria-hidden>
      <p className="d3-term-line">
        <span className="d3-term-dim">chat</span> Launch prep <span className="d3-term-dim">· model</span>
      </p>
      <ul className="d3-fzf-list">
        {PROVIDERS.map((provider, index) => (
          <li key={provider.name} className="d3-fzf-row" data-on={index === frame || undefined}>
            <span className="d3-fzf-mark">{index === frame ? "▸" : " "}</span>
            <span className="d3-fzf-name">{provider.name}</span>
            <span className="d3-fzf-plan">{provider.plan}</span>
            {provider.tag ? <span className="d3-fzf-tag">{provider.tag}</span> : null}
          </li>
        ))}
      </ul>
      <p className="d3-term-line d3-fzf-foot">
        <span className="d3-term-dim">running on</span>{" "}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={active.model}
            className="d3-term-amber"
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={spring}
          >
            {active.model}
          </motion.span>
        </AnimatePresence>
      </p>
    </div>
  );
}

/* ---- 2 · review: one request becomes a diff you apply ---- */

const CHANGES = [
  { kind: "project", text: "Website launch" },
  { kind: "tasks", text: "8 tasks in 3 stages" },
  { kind: "doc", text: "Launch brief" },
  { kind: "sheet", text: "Launch budget" },
  { kind: "blocks", text: "6 placed this week" },
];

function ReviewDemo() {
  const mod = useModKey();
  const { ref, frame } = useLoop(9, [900, 1000, 450, 450, 450, 450, 450, 1500, 2600], 8);
  const shown = Math.max(0, Math.min(frame - 1, CHANGES.length));
  const pressing = frame === 7;
  const applied = frame === 8;
  return (
    <div ref={ref} className="d3-review" aria-hidden>
      <div className="d3-qp">
        <span className="d3-keys">
          <kbd className="d3-key" data-size="sm" data-pressed={frame === 0 || undefined}>
            {mod}
          </kbd>
          <kbd className="d3-key" data-size="sm" data-pressed={frame === 0 || undefined}>
            Shift
          </kbd>
          <kbd className="d3-key" data-size="sm" data-pressed={frame === 0 || undefined}>
            J
          </kbd>
        </span>
        <span className="d3-qp-text">Plan the website launch for the end of the month, with a budget.</span>
      </div>
      <div className="d3-diff">
        <p className="d3-diff-head">
          <span className="d3-diff-state" data-applied={applied || undefined}>
            {applied ? <Check className="d3-ico-sm" strokeWidth={2.6} /> : <Sparkles className="d3-ico-sm" />}
            {applied ? "Applied" : "Needs your review"}
          </span>
          <span className="d3-term-dim">{shown} changes</span>
        </p>
        <ul className="d3-diff-list">
          {CHANGES.map((change, index) => (
            <motion.li
              key={change.kind}
              className="d3-diff-row"
              initial={false}
              animate={{ opacity: index < shown ? 1 : 0.14, x: index < shown ? 0 : -6 }}
              transition={spring}
            >
              <span className="d3-diff-plus" data-applied={applied || undefined}>
                {applied ? "✓" : "+"}
              </span>
              <span className="d3-diff-kind">{change.kind}</span>
              <span>{change.text}</span>
            </motion.li>
          ))}
        </ul>
        <div className="d3-diff-actions">
          <span className="d3-fake-btn d3-fake-amber" data-pressed={pressing || undefined} data-done={applied || undefined}>
            {applied ? <Check className="d3-ico-sm" strokeWidth={2.6} /> : null}
            {applied ? "Applied" : "Apply changes"}
          </span>
          <span className="d3-fake-btn">Discard</span>
        </div>
      </div>
    </div>
  );
}

/* ---- 3 · clarify: suggestions arrive as ghost text, then settle ---- */

const FIELDS = [
  { label: "type", value: "Work" },
  { label: "length", value: "2h" },
  { label: "deadline", value: "Fri 16 Oct" },
  { label: "project", value: "Fundraising" },
  { label: "labels", value: "writing" },
  { label: "priority", value: "High" },
];

function ClarifyDemo() {
  const { ref, frame } = useLoop(9, [900, 420, 420, 420, 420, 420, 420, 1100, 2400], 8);
  const suggested = Math.min(frame, FIELDS.length);
  const accepted = frame >= 7;
  return (
    <div ref={ref} className="d3-term d3-clarify" aria-hidden>
      <p className="d3-term-line">
        <span className="d3-term-dim">clarify</span>
      </p>
      <p className="d3-clarify-title">Draft the Q3 investor update before Friday</p>
      <dl className="d3-clarify-fields">
        {FIELDS.map((field, index) => {
          const on = index < suggested;
          return (
            <div key={field.label} className="d3-clarify-field">
              <dt>{field.label}</dt>
              <dd data-state={on ? (accepted ? "set" : "ghost") : "empty"}>
                <AnimatePresence initial={false}>
                  {on ? (
                    <motion.span
                      key="v"
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                    >
                      {field.value}
                    </motion.span>
                  ) : (
                    <span>·</span>
                  )}
                </AnimatePresence>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="d3-term-line d3-clarify-foot">
        <Sparkles className="d3-ico-sm" />
        {accepted ? "Suggestions accepted · Save to create the Work" : "Suggested from “before Friday”"}
      </p>
    </div>
  );
}

/* ---- 4 · mcp: your own agent calls Timely's tools ---- */

const CALLS = [
  { tool: "get_agenda", note: "3 events, 5 blocks today" },
  { tool: "what_next", note: "Launch brief, due Fri" },
  { tool: "create_task", note: "“Send deck to Sam”" },
  { tool: "auto_schedule_apply", note: "placed 2 blocks" },
];

function AgentDemo() {
  const { ref, frame } = useLoop(7, [1000, 900, 750, 750, 750, 1100, 3000], 6);
  const calls = Math.max(0, Math.min(frame - 1, CALLS.length));
  return (
    <div ref={ref} className="d3-term d3-agent" aria-hidden>
      <p className="d3-term-line">
        <span className="d3-term-dim">~/code/site</span> <span className="d3-term-amber">$</span> claude
      </p>
      <p className="d3-term-line d3-agent-ask">
        <span className="d3-term-amber">&gt;</span> what&apos;s left for the launch this week? book time for the deck.
      </p>
      <ul className="d3-agent-calls">
        {CALLS.map((call, index) => (
          <motion.li
            key={call.tool}
            initial={false}
            animate={{ opacity: index < calls ? 1 : 0, y: index < calls ? 0 : 4 }}
            transition={spring}
          >
            <span className="d3-agent-dot">⏺</span>
            <span className="d3-agent-tool">timely.{call.tool}</span>
            <span className="d3-term-dim">{call.note}</span>
          </motion.li>
        ))}
      </ul>
      <motion.p
        className="d3-term-line d3-agent-reply"
        initial={false}
        animate={{ opacity: frame >= 6 ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      >
        Booked Thu 10:00–11:30 for the deck. Launch brief is still first.
      </motion.p>
      <p className="d3-term-line">
        <span className="d3-term-amber">&gt;</span> <span className="d3-caret d3-caret-sm" />
      </p>
    </div>
  );
}

/* ---- The tmux-style window ---- */

const PANES: { id: string; title: string; body: ReactNode; demo: ReactNode; area: string }[] = [
  {
    id: "model",
    area: "model",
    title: "Use the plan you already pay for",
    body: (
      <>
        Claude Code and Codex use the sign-in already on your computer, so chats run on your Claude or ChatGPT
        subscription. Or pick OpenCode Go, local models through Ollama, or an API key for OpenRouter, Anthropic,
        OpenAI, Gemini, DeepSeek, xAI, Mistral and more. Switch the model per chat.
      </>
    ),
    demo: <ModelDemo />,
  },
  {
    id: "review",
    area: "review",
    title: "It proposes. You apply.",
    body: (
      <>
        Ask for a plan and the assistant drafts the project, tasks, doc, sheet and calendar blocks. Bigger changes wait
        for your review: nothing is written until you choose <b>Apply changes</b>, and <b>Discard</b> drops the lot.
      </>
    ),
    demo: <ReviewDemo />,
  },
  {
    id: "clarify",
    area: "clarify",
    title: "Suggestions while you clarify",
    body: (
      <>
        Smart suggestions read the words you typed and fill in the project, labels, dates and length. Nothing changes
        until you accept it, and Timely works the same without them.
      </>
    ),
    demo: <ClarifyDemo />,
  },
  {
    id: "mcp",
    area: "mcp",
    title: "Your own agents, over MCP",
    body: (
      <>
        Timely runs an MCP server with more than 150 tools. Create a key in Settings › Integrations, and Claude Code,
        Codex or any MCP client can read and plan your calendar, tasks, docs and sheets. Deleting things needs the
        agent to confirm first, and you can revoke a key at any time.
      </>
    ),
    demo: <AgentDemo />,
  },
];

export default function AiPanes() {
  const [active, setActive] = useState(1);
  return (
    <div className="d3-tmux">
      <div className="d3-tmux-grid">
        {PANES.map((pane, index) => (
          <article
            key={pane.id}
            className="d3-pane"
            data-area={pane.area}
            data-active={active === index || undefined}
            onPointerEnter={() => setActive(index)}
            onFocusCapture={() => setActive(index)}
          >
            <div className="d3-pane-copy">
              <p className="d3-pane-tag">
                <span>{index + 1}</span>
                {pane.id}
              </p>
              <h3 className="d3-h3">{pane.title}</h3>
              <p className="d3-pane-body">{pane.body}</p>
            </div>
            <div className="d3-pane-demo">{pane.demo}</div>
          </article>
        ))}
      </div>
      <div className="d3-tmux-bar" aria-hidden>
        <span className="d3-tmux-session">[timely]</span>
        {PANES.map((pane, index) => (
          <span key={pane.id} className="d3-tmux-win" data-active={active === index || undefined}>
            {index + 1}:{pane.id}
            {active === index ? "*" : ""}
          </span>
        ))}
        <span className="d3-tmux-clock">
          10:05 Mon 12 Oct
        </span>
      </div>
    </div>
  );
}
