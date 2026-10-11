import { Archivo } from "next/font/google";

/** Archivo with its width axis: the condensed display face of the public site and the sign-in pages. */
export const displayFont = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-lp-display", display: "swap" });
