"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard can be blocked; the text is still selectable.
        }
      }}
      aria-label={copied ? "Copied" : "Copy"}
      className="absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-lg border border-[var(--s-line-strong)] bg-[var(--s-raised)] text-white/55 opacity-100 transition hover:text-white sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
    >
      {copied ? <Check className="size-4 text-[#4edea3]" /> : <Copy className="size-4" />}
    </button>
  );
}
