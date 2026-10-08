import { useToastStore } from "@/app/_store/toastStore";

/**
 * PDF export of a doc. The editor's page is copied, as it is drawn, into a
 * print-only container (see #doc-print in globals.css), so diagrams,
 * formulas and maps print as they look. The desktop app saves the PDF
 * straight to a file; a browser opens its print dialog, where "Save as PDF"
 * is the destination.
 */
export async function exportDocPdf(title: string, editorDom: HTMLElement) {
  const root = document.createElement("div");
  root.id = "doc-print";
  const heading = document.createElement("h1");
  heading.className = "doc-print-title";
  heading.textContent = title || "Untitled";
  const body = editorDom.cloneNode(true) as HTMLElement;
  body.removeAttribute("contenteditable");
  body.classList.remove("ProseMirror-focused");

  // Canvases (3D models) do not copy their pixels; draw them as images.
  const sourceCanvases = editorDom.querySelectorAll("canvas");
  body.querySelectorAll("canvas").forEach((canvas, index) => {
    const source = sourceCanvases[index];
    try {
      const image = document.createElement("img");
      image.src = source.toDataURL("image/png");
      image.style.width = `${source.clientWidth}px`;
      image.style.maxWidth = "100%";
      canvas.replaceWith(image);
    } catch {
      canvas.remove();
    }
  });
  // Form fields (a callout's kind and title) print as their text; a copy
  // would lose what was picked.
  const sourceFields = editorDom.querySelectorAll("input, select, textarea");
  body.querySelectorAll("input, select, textarea").forEach((field, index) => {
    const source = sourceFields[index] as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined;
    if (source instanceof HTMLInputElement && (source.type === "checkbox" || source.type === "radio")) {
      (field as HTMLInputElement).checked = source.checked;
      if (source.checked) field.setAttribute("checked", "");
      return;
    }
    const text = source instanceof HTMLSelectElement ? source.selectedOptions[0]?.text ?? "" : source?.value ?? "";
    if (!text) {
      field.remove();
      return;
    }
    const span = document.createElement("span");
    span.className = field.className;
    span.textContent = text;
    field.replaceWith(span);
  });
  // An embedded player cannot print; leave its link.
  body.querySelectorAll(".doc-embed-frame").forEach((frame) => frame.remove());
  // Everything a reader might need is shown: folded toggles open, long code
  // in full, and no editing controls.
  body.querySelectorAll(".doc-details").forEach((details) => details.setAttribute("data-open", ""));
  body.querySelectorAll(".is-folded").forEach((element) => element.classList.remove("is-folded"));
  body
    .querySelectorAll(".doc-code-bar, .doc-code-fold, .doc-details-toggle, .doc-link-form, .ProseMirror-gapcursor, .ProseMirror-trailingBreak")
    .forEach((element) => element.remove());
  body.querySelectorAll("[contenteditable]").forEach((element) => element.removeAttribute("contenteditable"));

  root.append(heading, body);
  document.body.append(root);
  // Paper is white: the copy gets the light theme's colors. They are read
  // with the dark class off and put back in the same task, so nothing on
  // screen changes.
  const html = document.documentElement;
  if (html.classList.contains("dark")) {
    html.classList.remove("dark");
    const style = getComputedStyle(html);
    for (let i = 0; i < style.length; i += 1) {
      const name = style[i];
      if (name.startsWith("--")) root.style.setProperty(name, style.getPropertyValue(name));
    }
    html.classList.add("dark");
    root.style.colorScheme = "light";
  }
  html.classList.add("printing-doc");
  const cleanup = () => {
    html.classList.remove("printing-doc");
    root.remove();
  };

  const desktop = window.timelyDesktop;
  if (desktop?.savePdf) {
    try {
      const result = await desktop.savePdf(title || "Untitled");
      if (result.ok) useToastStore.getState().show("PDF saved");
    } catch (error) {
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not save the PDF");
    } finally {
      cleanup();
    }
    return;
  }
  window.addEventListener("afterprint", cleanup, { once: true });
  // Let images in the copy load before the print layout is taken.
  await Promise.all(
    [...root.querySelectorAll("img")].map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) return resolve();
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
          setTimeout(resolve, 3000);
        }),
    ),
  );
  window.print();
}
