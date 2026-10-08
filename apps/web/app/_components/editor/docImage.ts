import TiptapImage from "@tiptap/extension-image";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { useToastStore } from "@/app/_store/toastStore";
import { API_BASE, apiUrl } from "@/app/utils/api/client";
import { uploadDocFile } from "@/app/utils/api/docs";

/** Uploaded images are stored in the doc as "/files/<id>" (see
 * apps/api/internal/features/docfile), which works on any server; the
 * editor shows them through the API's address. */
export function imageSrc(src: string) {
  return src.startsWith("/files/") ? apiUrl(src) : src;
}

function storedSrc(src: string) {
  const prefix = `${API_BASE}/files/`;
  return src.startsWith(prefix) ? src.slice(API_BASE.length) : src;
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
            const files = imageFiles(event.clipboardData?.files);
            if (files.length === 0) return false;
            event.preventDefault();
            void insertImageFiles(editor, files);
            return true;
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
