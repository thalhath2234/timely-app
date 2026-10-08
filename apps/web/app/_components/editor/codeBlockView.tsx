"use client";

import { useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Check, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { normalizeCodeLanguage } from "@/app/utils/markdown";
import MapPreview from "./mapPreview";
import MermaidPreview from "./mermaidPreview";
import StlPreview from "./stlPreview";

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
  "geojson",
  "topojson",
  "stl",
];

// Languages drawn under their source. Their code is usually long and the
// drawing is what people want to see, so the source folds to a few lines.
const PREVIEW_LANGUAGES = new Set(["mermaid", "geojson", "topojson", "stl"]);
const FOLDED_LINES = 3;

export default function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  // Older docs and MCP writes may carry short aliases ("js"); show them under
  // their canonical name so the selector never silently falls back to plain.
  const language = normalizeCodeLanguage(String(node.attrs.language ?? ""));
  const options = LANGUAGES.includes(language) ? LANGUAGES : [...LANGUAGES, language];
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lineCount = node.textContent.split("\n").length;
  const foldable = PREVIEW_LANGUAGES.has(language) && lineCount > FOLDED_LINES;
  const folded = foldable && !expanded;

  const toggle = () => {
    setExpanded((value) => !value);
    // After folding a long block, bring its top back into view so the reader
    // stays where the block is instead of somewhere far below it.
    if (expanded) {
      window.requestAnimationFrame(() => wrapRef.current?.scrollIntoView({ block: "nearest" }));
    }
  };

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
    <NodeViewWrapper ref={wrapRef} className="doc-code-wrap" data-language={language || "plain"}>
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
      <pre className={`doc-code-block language-${language || "plaintext"}${folded ? " is-folded" : ""}`}>
        <NodeViewContent />
      </pre>
      {foldable && (
        // Sticks to the bottom of the screen while the open code scrolls past,
        // so it can be folded again from anywhere in it.
        <div className="doc-code-fold" contentEditable={false}>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={toggle}
            className="doc-code-copy"
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {expanded ? "Collapse code" : `Show all ${lineCount} lines`}
          </button>
        </div>
      )}
      {language === "mermaid" && <MermaidPreview code={node.textContent} />}
      {(language === "geojson" || language === "topojson") && <MapPreview code={node.textContent} />}
      {language === "stl" && <StlPreview code={node.textContent} />}
    </NodeViewWrapper>
  );
}
