import type { Metadata } from "next";
import LandingOne from "@/app/_components/landing/landingOne";
import "@/app/_components/site/site.css";

export const metadata: Metadata = { title: "Timely · Design 1" };

/** Design iteration 1: the current "day in Timely" landing page. */
export default function DesignOne() {
  return <LandingOne base="/1" />;
}
