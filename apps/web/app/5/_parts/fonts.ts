import { Instrument_Serif, Source_Sans_3 } from "next/font/google";

/** A refined humanist sans for reading, and an italic serif for the quiet accents. */
export const sans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600", "700"],
  variable: "--d5-sans",
  display: "swap",
});

export const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--d5-serif",
  display: "swap",
});
