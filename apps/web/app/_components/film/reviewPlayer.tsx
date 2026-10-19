"use client";

import { useEffect, useRef, useState } from "react";
import { Download, RotateCcw, X } from "lucide-react";
import { Player, type PlayerRef } from "@remotion/player";
import Button from "@/app/_components/_ui/button";
import { useReducedMotion } from "@/app/_components/home/scenePlayer";
import { useToastStore } from "@/app/_store/toastStore";
import type { WeekReview } from "./review/plan";
import { REVIEW, WeekInReview, reviewFrames } from "./review/review";

type Save = { phase: "idle" } | { phase: "rendering"; progress: number } | { phase: "saving" };

type Format = { container: "mp4" | "webm"; codec: "h264" | "vp9" | "vp8"; ext: "mp4" | "webm"; mime: "video/mp4" | "video/webm"; label: string };

/** Tried in order; the first the browser can encode is the one offered. */
const FORMATS: Format[] = [
  { container: "mp4", codec: "h264", ext: "mp4", mime: "video/mp4", label: "MP4" },
  { container: "webm", codec: "vp9", ext: "webm", mime: "video/webm", label: "WebM" },
  { container: "webm", codec: "vp8", ext: "webm", mime: "video/webm", label: "WebM" },
];

/**
 * The week in review played in the page, with "Save as video": the same
 * composition rendered to a video file in the browser by
 * @remotion/web-renderer (WebCodecs, no server). MP4 where the browser has
 * an H.264 encoder, else WebM; the button only shows where one of them
 * works, so Firefox keeps the Player alone. Loaded only with the dialog.
 */
export default function ReviewPlayer({ plan, fileName }: { plan: WeekReview; fileName: string }) {
  const ref = useRef<PlayerRef>(null);
  const reduced = useReducedMotion();
  const frames = reviewFrames();
  const [ended, setEnded] = useState(false);
  const [format, setFormat] = useState<Format | null>(null);
  const [save, setSave] = useState<Save>({ phase: "idle" });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    const onEnded = () => setEnded(true);
    player.addEventListener("ended", onEnded);
    if (reduced) {
      player.pause();
      player.seekTo(frames - 1);
    } else {
      player.play();
    }
    return () => player.removeEventListener("ended", onEnded);
  }, [frames, reduced]);

  useEffect(() => {
    let cancelled = false;
    import("@remotion/web-renderer")
      .then(async ({ canRenderMediaOnWeb }) => {
        for (const candidate of FORMATS) {
          const result = await canRenderMediaOnWeb({ width: REVIEW.width, height: REVIEW.height, container: candidate.container, videoCodec: candidate.codec, muted: true });
          if (result.canRender) return candidate;
        }
        return null;
      })
      .then((found) => {
        if (!cancelled) setFormat(found);
      })
      .catch(() => {
        if (!cancelled) setFormat(null);
      });
    return () => {
      cancelled = true;
      abort.current?.abort();
    };
  }, []);

  const again = () => {
    const player = ref.current;
    if (!player) return;
    setEnded(false);
    player.seekTo(0);
    player.play();
  };

  const saveVideo = async () => {
    if (!format) return;
    const name = `${fileName}.${format.ext}`;
    const controller = new AbortController();
    abort.current = controller;
    setSave({ phase: "rendering", progress: 0 });
    try {
      const { renderMediaOnWeb } = await import("@remotion/web-renderer");
      const { getBlob } = await renderMediaOnWeb({
        composition: { id: "WeekInReview", component: WeekInReview, width: REVIEW.width, height: REVIEW.height, fps: REVIEW.fps, durationInFrames: frames, defaultProps: { plan } },
        inputProps: { plan },
        container: format.container,
        videoCodec: format.codec,
        muted: true,
        videoBitrate: "high",
        // Timely is free software by one person, which Remotion's licence covers (package.md).
        licenseKey: "free-license",
        isProduction: process.env.NODE_ENV === "production",
        logLevel: "warn",
        signal: controller.signal,
        onProgress: ({ progress }) => setSave({ phase: "rendering", progress }),
      });
      const blob = await getBlob();
      setSave({ phase: "saving" });
      const outcome = await saveBlob(blob, name, format);
      if (outcome === "saved") useToastStore.getState().show(`Saved ${name}`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        useToastStore.getState().show(`Could not save the video: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      abort.current = null;
      setSave({ phase: "idle" });
    }
  };

  return (
    <div>
      <div className="relative overflow-hidden rounded-[12px] border border-border bg-[#0b0b0f]">
        <Player
          ref={ref}
          component={WeekInReview}
          inputProps={{ plan }}
          durationInFrames={frames}
          compositionWidth={REVIEW.width}
          compositionHeight={REVIEW.height}
          fps={REVIEW.fps}
          initiallyMuted
          moveToBeginningWhenEnded={false}
          acknowledgeRemotionLicense
          style={{ width: "100%" }}
        />
        {ended && !reduced ? (
          <button
            type="button"
            onClick={again}
            className="absolute right-3 top-3 inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-white/15 bg-black/60 px-2.5 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/80"
          >
            <RotateCcw className="size-3.5" /> Play again
          </button>
        ) : null}
      </div>
      {format ? (
        <div className="mt-3 flex min-h-8 items-center gap-3" data-testid="review-save">
          {save.phase === "idle" ? (
            <Button variant="primary" size="sm" leading={<Download />} onClick={saveVideo}>
              Save as video
            </Button>
          ) : (
            <>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${Math.round((save.phase === "rendering" ? save.progress : 1) * 100)}%` }} />
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {save.phase === "rendering" ? `Rendering ${Math.round(save.progress * 100)}%` : "Saving…"}
              </span>
              {save.phase === "rendering" ? (
                <Button variant="ghost" size="sm" icon aria-label="Cancel" onClick={() => abort.current?.abort()}>
                  <X />
                </Button>
              ) : null}
            </>
          )}
          <span className="ml-auto text-xs text-muted-foreground">{format.label}, 1280×720, 15 s</span>
        </div>
      ) : null}
    </div>
  );
}

type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
}>;

/** The native save dialog where the browser has one (Chrome, the desktop app), else a download. */
async function saveBlob(blob: Blob, fileName: string, format: Format): Promise<"saved" | "cancelled"> {
  const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const handle = await picker({ suggestedName: fileName, types: [{ description: `${format.label} video`, accept: { [format.mime]: [`.${format.ext}`] } }] });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Fall through to a plain download when the picker is refused.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "saved";
}
