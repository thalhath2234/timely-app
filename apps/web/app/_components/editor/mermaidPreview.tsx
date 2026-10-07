"use client";

import { useEffect, useState } from "react";

type MermaidModule = typeof import("mermaid").default;

let mermaidLoad: Promise<MermaidModule> | null = null;
let renderCount = 0;

/** Loads mermaid once, on first use, so docs without diagrams never pay for it. */
function loadMermaid() {
  mermaidLoad ??= import("mermaid").then((mod) => mod.default);
  return mermaidLoad;
}

/** initialize() replaces the whole config, so every render passes all of it. */
function configure(mermaid: MermaidModule, theme: "light" | "dark") {
  mermaid.initialize({
    startOnLoad: false,
    theme: theme === "light" ? "default" : "dark",
    // Diagram text is user content; strict mode keeps HTML labels inert.
    securityLevel: "strict",
    fontFamily: "inherit",
    // SVG text labels measure reliably inside the app's styled page;
    // HTML labels pick up global styles and come out oversized.
    flowchart: { htmlLabels: false },
  });
}

function isLightTheme() {
  return document.documentElement.classList.contains("light");
}

/**
 * Draws a ```mermaid code block as a diagram. The source stays in the code
 * block (and in the exported Markdown); this only renders it.
 */
export default function MermaidPreview({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  // Follow the app theme toggle (a class on <html>).
  useEffect(() => {
    const update = () => setTheme(isLightTheme() ? "light" : "dark");
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const source = code.trim();
    // An empty block shows the hint below instead; nothing to draw.
    if (!source) return;
    let cancelled = false;
    // Wait for typing to pause; rendering a half-written diagram only flashes errors.
    const timer = window.setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        configure(mermaid, theme);
        renderCount += 1;
        // Mermaid measures the diagram in this container before returning
        // the SVG; globals.css keeps the reduce-motion rules off it.
        const container = document.createElement("div");
        container.className = "doc-mermaid-render";
        document.body.appendChild(container);
        let rendered = "";
        try {
          ({ svg: rendered } = await mermaid.render(`doc-mermaid-${renderCount}`, source, container));
        } finally {
          container.remove();
        }
        if (cancelled) return;
        setSvg(rendered);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code, theme]);

  if (!code.trim()) {
    return (
      <div className="doc-mermaid doc-mermaid-empty" contentEditable={false}>
        Type a diagram above, for example: flowchart TD; A --&gt; B
      </div>
    );
  }

  return (
    <div className="doc-mermaid" contentEditable={false}>
      {svg && (
        <div
          className="doc-mermaid-svg"
          aria-label="Diagram"
          // The SVG comes from mermaid in strict mode, which escapes labels.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      {error && <pre className="doc-mermaid-error">{error.split("\n")[0]}</pre>}
      {!svg && !error && <div className="doc-mermaid-empty">Drawing diagram…</div>}
    </div>
  );
}
