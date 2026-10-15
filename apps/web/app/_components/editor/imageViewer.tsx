"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { Copy, Download, X } from "lucide-react";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import Button from "@/app/_components/_ui/button";
import { useToastStore } from "@/app/_store/toastStore";
import { downloadImages } from "./blockMenu";
import { copyImageToClipboard, imageSrc } from "./docImage";

/**
 * A doc picture at full size, opened with a double-click on it: pictures in
 * the page are capped in height, so a phone screenshot stays readable here.
 */

type Viewed = { src: string; alt: string };

const useViewerStore = create<{ image: Viewed | null; set: (image: Viewed | null) => void }>((set) => ({
  image: null,
  set: (image) => set({ image }),
}));

export function openImageViewer(src: string, alt: string) {
  useViewerStore.getState().set({ src, alt });
}

export default function ImageViewer() {
  const image = useViewerStore((state) => state.image);
  const close = () => useViewerStore.getState().set(null);

  useEffect(() => {
    if (!image) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [image]);

  if (!image) return null;
  return (
    <>
      <OverlayScrim className="z-[70] bg-black/85" onClick={close} />
      <OverlayFrame className="z-[70] flex-col items-center justify-center gap-3 p-6">
        <OverlayPanel className="flex items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-xl">
          <span className="max-w-[40vw] truncate px-2 text-xs text-muted-foreground">{image.alt || "Image"}</span>
          <Button
            variant="ghost"
            size="sm"
            leading={<Copy className="size-3.5" />}
            onClick={() =>
              void copyImageToClipboard(image.src, image.alt)
                .then(() => useToastStore.getState().show("Image copied"))
                .catch((error) => useToastStore.getState().show(error instanceof Error ? error.message : "Could not copy the image"))
            }
          >
            Copy
          </Button>
          <Button variant="ghost" size="sm" leading={<Download className="size-3.5" />} onClick={() => void downloadImages([image])}>
            Download
          </Button>
          <Button variant="ghost" size="sm" icon aria-label="Close" onClick={close}>
            <X className="size-4" />
          </Button>
        </OverlayPanel>
        <OverlayPanel className="flex min-h-0 flex-1 items-center justify-center" onClick={close}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a doc file served by the API */}
          <img
            src={imageSrc(image.src)}
            alt={image.alt}
            onClick={(event) => event.stopPropagation()}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
        </OverlayPanel>
      </OverlayFrame>
    </>
  );
}
