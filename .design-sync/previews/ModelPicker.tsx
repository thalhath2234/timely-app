import { ModelPicker } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

const CHAT_MODELS = [
  { id: "anthropic/claude-sonnet-4.5", name: "Anthropic: Claude Sonnet 4.5", vision: true, default: true },
  { id: "anthropic/claude-haiku-4.5", name: "Anthropic: Claude Haiku 4.5", vision: true },
  { id: "google/gemini-2.5-pro", name: "Google: Gemini 2.5 Pro", vision: true },
  { id: "openai/gpt-5", name: "OpenAI: GPT-5", vision: true },
  { id: "deepseek/deepseek-chat-v3.1", name: "DeepSeek: V3.1", vision: false, note: "Text only" },
];

const CLAUDE_MODELS = [
  { id: "fable", name: "Fable (latest)", vision: true, note: "Most capable" },
  { id: "opus", name: "Opus (latest)", vision: true },
  { id: "sonnet", name: "Sonnet (latest)", vision: true, default: true, note: "Balanced" },
  { id: "haiku", name: "Haiku (latest)", vision: true, note: "Fastest" },
];

const save = () => new Promise<void>((resolve) => setTimeout(resolve, 300));

/** Focuses the search input once so the model list is open. */
function OpenOnMount({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("input")?.focus();
  }, []);
  return <div ref={ref}>{children}</div>;
}

const Frame = ({ children, height }: { children: React.ReactNode; height?: number }) => (
  <div className="bg-background p-6" style={{ width: 520, height }}>{children}</div>
);

export const ChatModel = () => {
  const [value, setValue] = useState("anthropic/claude-sonnet-4.5");
  return (
    <Frame>
      <ModelPicker
        label="Chat model"
        value={value}
        options={CHAT_MODELS}
        onSave={async (model) => { await save(); setValue(model); }}
        allowCustom
        placeholder="Search tool-calling models…"
      />
    </Frame>
  );
};

export const ListOpen = () => {
  const [value, setValue] = useState("sonnet");
  return (
    <Frame height={340}>
      <OpenOnMount>
        <ModelPicker
          label="Claude Code model"
          value={value}
          options={CLAUDE_MODELS}
          onSave={async (model) => { await save(); setValue(model); }}
          allowCustom
          placeholder="fable, opus, sonnet, haiku or a full model name"
        />
      </OpenOnMount>
    </Frame>
  );
};

export const LoadingModels = () => (
  <Frame height={200}>
    <OpenOnMount>
      <ModelPicker label="Chat model" value="" options={undefined} loading onSave={save} allowCustom placeholder="Search tool-calling models…" />
    </OpenOnMount>
  </Frame>
);

export const LoadFailed = () => (
  <Frame height={200}>
    <OpenOnMount>
      <ModelPicker
        label="Semantic search embedding model"
        value=""
        options={undefined}
        loadError="Could not load models. Check your OpenRouter key."
        onSave={save}
      />
    </OpenOnMount>
  </Frame>
);

export const Saving = () => (
  <Frame>
    <ModelPicker label="Codex model" value="gpt-5-codex" options={[{ id: "gpt-5-codex", name: "GPT-5 Codex", vision: true }]} onSave={save} saving />
  </Frame>
);
