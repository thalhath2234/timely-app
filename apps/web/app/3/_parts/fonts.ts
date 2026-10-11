import { IBM_Plex_Mono, Schibsted_Grotesk } from "next/font/google";

/** Design 3 type: a sturdy grotesk for words, Plex Mono for keys, commands and times. */
export const grotesk = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--d3-font-sans",
  display: "swap",
});

export const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--d3-font-mono",
  display: "swap",
});

export const fontVars = `${grotesk.variable} ${mono.variable}`;
