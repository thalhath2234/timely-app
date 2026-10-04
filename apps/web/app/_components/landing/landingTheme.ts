export type LandingTheme = "dark" | "light";

export const LANDING_THEME_STORAGE_KEY = "timely.landingTheme";

/** The visitor's own choice if they made one, otherwise their system preference; dark when neither says light. */
export function readLandingTheme(): LandingTheme {
  try {
    const saved = localStorage.getItem(LANDING_THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // private mode can throw
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyLandingTheme(theme: LandingTheme) {
  document.documentElement.dataset.landingTheme = theme;
}

export function writeLandingTheme(theme: LandingTheme) {
  try {
    localStorage.setItem(LANDING_THEME_STORAGE_KEY, theme);
  } catch {
    // private mode can throw
  }
  applyLandingTheme(theme);
}

/** Runs before first paint so the page never flashes the other theme. Mirrors readLandingTheme. */
export const landingThemeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  LANDING_THEME_STORAGE_KEY,
)});if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.landingTheme=t}catch(e){}})()`;
