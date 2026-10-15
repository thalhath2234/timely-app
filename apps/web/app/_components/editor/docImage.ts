import TiptapImage from "@tiptap/extension-image";
import type { Editor } from "@tiptap/react";
import { NodeSelection, Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import type { Fragment, Node as PMNode } from "@tiptap/pm/model";
import { useToastStore } from "@/app/_store/toastStore";
import { API_BASE, apiUrl } from "@/app/utils/api/client";
import { uploadDocFile } from "@/app/utils/api/docs";
import { openImageViewer } from "./imageViewer";

/** Uploaded images are stored in the doc as "/files/<id>" (see
 * apps/api/internal/features/docfile), which works on any server; the
 * editor shows them through the API's address. */
export function imageSrc(src: string) {
  return src.startsWith("/files/") ? apiUrl(src) : src;
}

const FILE_PATH = /\/files\/fil_[0-9a-f]{32}$/;

/** "/files/<id>" for an image of this server, also when it was copied out
 * as a full address (another tab or window of the app); others as they are. */
function storedSrc(src: string) {
  const prefix = `${API_BASE}/files/`;
  if (src.startsWith(prefix)) return src.slice(API_BASE.length);
  if (typeof window !== "undefined" && /^https?:/.test(src)) {
    try {
      const base = new URL(apiUrl("/"), window.location.href);
      const url = new URL(src);
      const path = url.pathname.slice(base.pathname.replace(/\/$/, "").length);
      if (url.origin === base.origin && url.pathname.startsWith(base.pathname) && FILE_PATH.test(path) && path.startsWith("/files/")) return path;
    } catch {
      // not a URL
    }
  }
  return src;
}

/** The image when the selection is one picture and nothing else. */
function selectedImage(state: EditorState): PMNode | null {
  const { selection } = state;
  if (selection instanceof NodeSelection) return selection.node.type.name === "image" ? selection.node : null;
  if (selection.empty) return null;
  return onlyImage(selection.content().content);
}

/** The image when `content` holds one picture and no text or other leaf. */
export function onlyImage(content: Fragment): PMNode | null {
  let image: PMNode | null = null;
  let other = false;
  content.descendants((node) => {
    if (node.type.name === "image") {
      other ||= Boolean(image);
      image = node;
    } else if ((node.isText && node.text?.trim()) || (node.isLeaf && !node.isText && node.type.name !== "hardBreak")) {
      other = true;
    }
    return !other;
  });
  return other ? null : image;
}

/** A PNG of the image: the format every app can paste. */
async function pngBlob(src: string) {
  const response = await fetch(imageSrc(src));
  if (!response.ok) throw new Error("Could not copy the image");
  const blob = await response.blob();
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("Could not copy the image"))), "image/png"),
  );
}

/**
 * Puts the picture itself on the clipboard (with an <img> for apps that take
 * HTML), instead of the editor's markup. Must run inside the click or key
 * press that asked for it; the PNG is fetched while the clipboard waits.
 */
export function copyImageToClipboard(src: string, alt: string) {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return Promise.reject(new Error("This browser cannot copy images"));
  }
  const url = new URL(imageSrc(src), window.location.href).href;
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const html = `<img src="${escape(url)}" alt="${escape(alt)}">`;
  return navigator.clipboard.write([
    new ClipboardItem({
      "image/png": pngBlob(src),
      "text/html": new Blob([html], { type: "text/html" }),
    }),
  ]);
}

/** Whether the doc shows an image uploaded to Timely; its Markdown download
 * then comes as a .zip with the images beside the .md. */
export function hasUploadedImages(editor: Editor | null) {
  let found = false;
  editor?.state.doc.descendants((node) => {
    if (node.type.name === "image" && String(node.attrs.src ?? "").startsWith("/files/")) found = true;
    return !found;
  });
  return found;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function imageFiles(list: FileList | null | undefined) {
  return Array.from(list ?? []).filter((file) => IMAGE_TYPES.has(file.type));
}

/** Uploads the files and puts them at pos (the caret when omitted), each in
 * a paragraph of its own unless the caret sits on an empty line. */
export async function insertImageFiles(editor: Editor, files: File[], pos?: number) {
  if (files.length === 0) return;
  const toast = useToastStore.getState();
  toast.show(files.length === 1 ? "Uploading image…" : `Uploading ${files.length} images…`);
  const uploaded: { src: string; alt: string }[] = [];
  for (const file of files) {
    try {
      const saved = await uploadDocFile(file);
      uploaded.push({ src: saved.url, alt: file.name.replace(/\.[^.]+$/, "") });
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Could not upload the image");
    }
  }
  if (uploaded.length === 0 || editor.isDestroyed) return;
  const images = uploaded.map((image) => ({ type: "image", attrs: image }));
  const at = pos ?? editor.state.selection.from;
  const $at = editor.state.doc.resolve(Math.min(at, editor.state.doc.content.size));
  const chain = editor.chain().focus();
  if ($at.parent.isTextblock && $at.parent.content.size === 0 && $at.parent.type.name === "paragraph") {
    chain.insertContentAt(at, images).run();
  } else if ($at.parent.isTextblock && $at.depth > 0) {
    chain.insertContentAt($at.after(), { type: "paragraph", content: images }).run();
  } else {
    chain.insertContentAt(at, { type: "paragraph", content: images }).run();
  }
  toast.show(uploaded.length === 1 ? "Image added" : `${uploaded.length} images added`);
}

export function pickImageFiles(editor: Editor) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp";
  input.multiple = true;
  input.onchange = () => void insertImageFiles(editor, imageFiles(input.files));
  input.click();
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docImage: {
      /** Opens the file picker and adds the chosen images at the caret. */
      pickImage: () => ReturnType;
    };
  }
}

export const DocImage = TiptapImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => storedSrc(element.getAttribute("src") ?? ""),
        renderHTML: (attrs: { src?: string | null }) => ({ src: attrs.src ? imageSrc(attrs.src) : null }),
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      pickImage:
        () =>
        ({ editor }) => {
          pickImageFiles(editor as Editor);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: new PluginKey("docImageUpload"),
        props: {
          handlePaste: (_view, event) => {
            // An image copied from a doc carries its <img> too: paste that,
            // so the same file is reused instead of uploaded again.
            const html = event.clipboardData?.getData("text/html") ?? "";
            if (/<img[^>]+src="[^"]*\/files\/fil_[0-9a-f]{32}"/.test(html)) return false;
            const files = imageFiles(event.clipboardData?.files);
            if (files.length === 0) return false;
            event.preventDefault();
            void insertImageFiles(editor, files);
            return true;
          },
          // Pictures are capped in height in the page; a double-click shows one full size.
          handleDoubleClickOn: (_view, _pos, node) => {
            if (node.type.name !== "image" || !node.attrs.src) return false;
            openImageViewer(node.attrs.src, node.attrs.alt ?? "");
            return true;
          },
          handleDOMEvents: {
            // Copying just a picture copies the picture, so it pastes into
            // other apps as an image. The editor still writes its own HTML
            // first; the image replaces it once fetched.
            copy: (view) => {
              const image = selectedImage(view.state);
              if (image?.attrs.src) {
                copyImageToClipboard(image.attrs.src, image.attrs.alt ?? "").catch(() => {
                  // The editor's own copy stays on the clipboard.
                });
              }
              return false;
            },
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved) return false;
            const files = imageFiles(event.dataTransfer?.files);
            if (files.length === 0) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            void insertImageFiles(editor, files, at?.pos);
            return true;
          },
        },
      }),
    ];
  },
});
