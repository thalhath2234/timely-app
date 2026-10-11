"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copies a shell command; says so for screen readers too. */
export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="d3-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
      aria-label={copied ? "Copied" : `Copy ${text}`}
    >
      {copied ? <Check aria-hidden className="d3-ico-sm" /> : <Copy aria-hidden className="d3-ico-sm" />}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
