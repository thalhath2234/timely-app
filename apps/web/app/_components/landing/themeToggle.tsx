"use client";

import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { applyLandingTheme, readLandingTheme, writeLandingTheme } from "./landingTheme";

export default function ThemeToggle() {
  useEffect(() => {
    // The inline script covers a full page load; this covers client-side
    // navigation to the page and later system or cross-tab changes.
    const sync = () => applyLandingTheme(readLandingTheme());
    sync();
    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", sync);
    window.addEventListener("storage", sync);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <button
      type="button"
      aria-label="Switch between dark and light theme"
      onClick={() => writeLandingTheme(readLandingTheme() === "dark" ? "light" : "dark")}
      className="l-ghost flex size-9 shrink-0 items-center justify-center rounded-full"
    >
      <Sun className="l-theme-sun size-4" />
      <Moon className="l-theme-moon size-4" />
    </button>
  );
}
