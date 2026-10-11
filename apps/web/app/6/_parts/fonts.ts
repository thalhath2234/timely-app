import { Bricolage_Grotesque, Figtree, Kalam } from "next/font/google";

/** Chunky, friendly grotesk for headings and buttons. */
export const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--d6-display",
  axes: ["opsz", "wdth"],
});

/** Plain, warm text face for everything people read. */
export const body = Figtree({
  subsets: ["latin"],
  variable: "--d6-body",
});

/** Marker handwriting, only on the sticky notes themselves. */
export const hand = Kalam({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--d6-hand",
});

export const fontVars = `${display.variable} ${body.variable} ${hand.variable}`;
