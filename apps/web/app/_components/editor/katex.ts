"use client";

import katex from "katex";
import "katex/dist/katex.min.css";

/** TeX to HTML. Errors render as the source in the error colour instead of throwing. */
export function renderTex(latex: string, displayMode: boolean) {
  return katex.renderToString(latex, {
    displayMode,
    throwOnError: false,
    errorColor: "var(--destructive, #e5484d)",
    strict: "ignore",
    trust: false,
    output: "htmlAndMathml",
  });
}
