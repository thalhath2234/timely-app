"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ImageIcon, LoaderCircle, X } from "lucide-react";
import { apiFetch } from "@/app/utils/api/client";
import {
  chatRequest,
  uploadChatImage,
  type ChatImage,
} from "@/app/utils/api/chat";

export function ImagePreview({
  image,
  large = false,
}: {
  image: ChatImage;
  large?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [unavailable, setUnavailable] = useState(
    () => Date.parse(image.expiresAt) <= Date.now(),
  );
  const removed = !!image.deletedAt;
  useEffect(() => {
    if (removed) return;
    const controller = new AbortController();
    let objectURL = "";
    const timer = setTimeout(
      () => {
        if (objectURL) URL.revokeObjectURL(objectURL);
        setUnavailable(true);
      },
      Math.max(0, Date.parse(image.expiresAt) - Date.now()),
    );
    void apiFetch(`/chats/images/${image.id}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("unavailable");
        const blob = await res.blob();
        if (controller.signal.aborted) return;
        objectURL = URL.createObjectURL(blob);
        setUrl(objectURL);
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnavailable(true);
      });
    return () => {
      controller.abort();
      clearTimeout(timer);
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [image.id, image.expiresAt, removed]);
  if (removed || unavailable)
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
        <ImageIcon className="size-4" />
        Image removed · extracted details kept
      </div>
    );
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-muted/30">
      {url ? (
        <Image
          unoptimized
          src={url}
          alt={image.name || "Attached image"}
          width={800}
          height={1000}
          className={
            large
              ? "max-h-[480px] w-full object-contain"
              : "h-28 w-28 object-cover"
          }
        />
      ) : (
        <div
          role="status"
          className="flex h-28 items-center justify-center p-6"
        >
          <LoaderCircle className="size-4 animate-spin" />
          <span className="sr-only">Loading image</span>
        </div>
      )}
      {large && (
        <figcaption className="px-3 py-2 text-xs text-muted-foreground">
          {image.name}
        </figcaption>
      )}
    </figure>
  );
}

export function useImageUploads() {
  const [images, setImages] = useState<ChatImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const current = useRef<ChatImage[]>([]);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const image of current.current)
        void chatRequest(`/images/${image.id}`, "DELETE").catch(() => {});
    };
  }, []);
  async function add(files: File[]) {
    if (inFlight.current) return;
    if (files.length + current.current.length > 5) {
      setError("Attach up to five photos of one receipt.");
      return;
    }
    if (
      files.some(
        (f) =>
          !["image/jpeg", "image/png"].includes(f.type) ||
          f.size > 10 * 1024 * 1024,
      )
    ) {
      setError("Choose JPEG or PNG images, up to 10 MB each.");
      return;
    }
    inFlight.current = true;
    setUploading(true);
    setError("");
    try {
      for (const file of files) {
        const image = await uploadChatImage(file);
        if (!alive.current) {
          void chatRequest(`/images/${image.id}`, "DELETE");
          break;
        }
        current.current = [...current.current, image];
        setImages(current.current);
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      inFlight.current = false;
      if (alive.current) setUploading(false);
    }
  }
  async function remove(id: string) {
    try {
      await chatRequest(`/images/${id}`, "DELETE");
      current.current = current.current.filter((i) => i.id !== id);
      setImages(current.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't discard image");
    }
  }
  function sent() {
    current.current = [];
    setImages([]);
    setError("");
  }
  return { images, uploading, error, add, remove, sent };
}
export function PendingImages({
  images,
  remove,
}: {
  images: ChatImage[];
  remove: (id: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {images.map((image) => (
        <div key={image.id} className="relative">
          <ImagePreview image={image} />
          <button
            type="button"
            aria-label={`Remove ${image.name}`}
            onClick={() => remove(image.id)}
            className="absolute -right-1 -top-1 rounded-full border border-border bg-background p-1 shadow-sm"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
