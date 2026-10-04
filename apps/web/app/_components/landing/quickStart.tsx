"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

const COMMANDS = [
  { command: "make setup", note: "install dependencies, create .env" },
  { command: "make dev", note: "API and web app" },
  { command: "make dev-desktop", note: "the same, in a desktop window" },
];

const COMMAND_WIDTH = Math.max(...COMMANDS.map((line) => line.command.length)) + 3;

export default function QuickStart() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    void navigator.clipboard
      .writeText(COMMANDS.map((line) => line.command).join("\n"))
      .then(() => setCopied(true))
      .catch(() => undefined);
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0c0e14] text-left text-[#e2e2eb]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 py-2 pr-2 pl-5">
        <span className="font-mono text-xs text-[#908fa0]">From the repository root</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-[#e2e2eb] transition-colors hover:bg-white/10"
        >
          {copied ? <Check className="size-3.5 text-[#4edea3]" /> : <Copy className="size-3.5" />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-sm leading-7">
        {COMMANDS.map((line) => (
          <span key={line.command} className="block whitespace-pre">
            <span className="text-[#c0c1ff] select-none">$ </span>
            {line.command.padEnd(COMMAND_WIDTH)}
            <span className="text-[#908fa0] select-none">{`# ${line.note}`}</span>
          </span>
        ))}
      </pre>
    </div>
  );
}
