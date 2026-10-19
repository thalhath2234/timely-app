import { Bricolage_Grotesque } from "next/font/google";

/** The public site's display face (headlines on the landing page and in the help center). */
export const siteFont = Bricolage_Grotesque({ subsets: ["latin"], weight: "variable", variable: "--font-site-display", display: "swap" });
