/**
 * Help-centre stills: one frame of a film composition, rendered to
 * public/help/film/<id>.webp by `make film-render-stills`. Pure data, safe
 * to import from server components and from the render script.
 */

/** "window" keeps the app window of a chapter (no stage margin or caption); "full" keeps the whole frame. */
export type StillCrop = "window" | "full";

export type Still = {
  /** Composition id as registered in film/root.tsx. */
  composition: string;
  /** Frame to render; -1 is the last frame. */
  frame: number;
  crop: StillCrop;
  /** Size of the rendered image, which `<Still>` passes to next/image. */
  width: number;
  height: number;
};

/** The chapter stage is 1600x1000; its window sits 50/46/50/52 inside at zoom 1.25. */
const WINDOW = { crop: "window" as const, width: 1476, height: 878 };
const STAGE = { crop: "full" as const, width: 1600, height: 1000 };

export const STILLS = {
  capture: { composition: "Chapter-01-capture", frame: 135, ...WINDOW },
  "auto-schedule": { composition: "Chapter-03-auto-schedule", frame: 135, ...WINDOW },
  sheets: { composition: "Chapter-04-sheets", frame: 135, ...WINDOW },
  docs: { composition: "Chapter-05-docs", frame: 135, ...WINDOW },
  cards: { composition: "Chapter-06-cards", frame: 135, ...WINDOW },
  suggestions: { composition: "Chapter-07-suggestions", frame: 135, ...WINDOW },
  assistant: { composition: "Chapter-08-assistant", frame: 149, ...WINDOW },
  agents: { composition: "Chapter-09-agents", frame: 135, ...WINDOW },
  widgets: { composition: "Chapter-10-widgets", frame: 135, ...STAGE },
  "self-host": { composition: "Chapter-11-self-host", frame: 135, ...STAGE },
  replay: { composition: "ScheduleReplay", frame: -1, crop: "full", width: 960, height: 600 },
} satisfies Record<string, Still>;

export type StillId = keyof typeof STILLS;

/** Pixel crop of the chapter window inside the 1600x1000 stage, for ffmpeg. */
export const WINDOW_CROP = { x: 62, y: 57, width: 1476, height: 878 };
