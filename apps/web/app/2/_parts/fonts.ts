import { Caveat, IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";

/** Display serif: headings, numerals, captions. */
export const serif = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--d2-font-serif",
  display: "swap",
});

/** Sturdy text face; the condensed width sets the ink stamps. */
export const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--d2-font-sans",
  display: "swap",
});

/** File names, times and footnote marks. */
export const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--d2-font-mono",
  display: "swap",
});

/** Handwritten notes before Timely typesets them. */
export const hand = Caveat({
  subsets: ["latin"],
  variable: "--d2-font-hand",
  display: "swap",
});

export const fontVars = `${serif.variable} ${sans.variable} ${mono.variable} ${hand.variable}`;
