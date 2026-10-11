import { Geist_Mono, Inter_Tight } from "next/font/google";

/** One tight grotesk for everything (variable weight, so headings can shift on scroll) and a mono for times and file names. */
export const sans = Inter_Tight({ subsets: ["latin"], variable: "--d4-sans", display: "swap" });
export const mono = Geist_Mono({ subsets: ["latin"], variable: "--d4-mono", display: "swap" });

export const fontClasses = `${sans.variable} ${mono.variable}`;
