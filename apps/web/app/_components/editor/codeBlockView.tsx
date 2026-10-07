"use client";

import { useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Check, Copy } from "lucide-react";
import { normalizeCodeLanguage } from "@/app/utils/markdown";
import MermaidPreview from "./mermaidPreview";

const LANGUAGES = [
  "",
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "python",
  "go",
  "rust",
  "json",
  "css",
  "html",
  "bash",
  "sql",
  "markdown",
  "mermaid",
];

export default function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  // Older docs and MCP writes may carry short aliases ("js"); show them under
  // their canonical name so the selector never silently falls back to plain.
  const language = normalizeCodeLanguage(String(node.attrs.language ?? ""));
  const options = LANGUAGES.includes(language) ? LANGUAGES : [...LANGUAGES, language];
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = node.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <NodeViewWrapper className="doc-code-wrap" data-language={language || "plain"}>
      <div className="doc-code-bar" contentEditable={false}>
        <select
          value={language}
          aria-label="Code language"
          onChange={(event) => updateAttributes({ language: event.target.value || null })}
          className="doc-code-lang"
        >
          <option value="">plain</option>
          {options.filter(Boolean).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void copy()}
          className="doc-code-copy"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className={`doc-code-block language-${language || "plaintext"}`}>
        <NodeViewContent />
      </pre>
      {language === "mermaid" && <MermaidPreview code={node.textContent} />}
    </NodeViewWrapper>
  );
}
