import { C as FILM } from "../theme";

/**
 * The film's colours for the empty-state loops, which sit on app pages: the
 * surfaces, text and accent follow the app's theme through --loop-* (set on
 * a themed LoopPlayer's .film-loop-themed in globals.css, light only), and
 * fall back to the film's dark palette where they are unset (dark theme, a
 * loop that is not themed yet, Remotion Studio).
 */
export const C = {
  ...FILM,
  bg: `var(--loop-bg, ${FILM.bg})`,
  panel: `var(--loop-panel, ${FILM.panel})`,
  panel2: `var(--loop-panel2, ${FILM.panel2})`,
  raised: `var(--loop-raised, ${FILM.raised})`,
  line: `var(--loop-line, ${FILM.line})`,
  line2: `var(--loop-line2, ${FILM.line2})`,
  ink: `var(--loop-ink, ${FILM.ink})`,
  soft: `var(--loop-soft, ${FILM.soft})`,
  faint: `var(--loop-faint, ${FILM.faint})`,
  accent: `var(--loop-accent, ${FILM.accent})`,
  accentInk: `var(--loop-accent-ink, ${FILM.accentInk})`,
} as const;
