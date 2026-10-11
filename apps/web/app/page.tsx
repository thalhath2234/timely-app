import type { Metadata } from "next";
import LandingOne from "@/app/_components/landing/landingOne";
import "@/app/_components/site/site.css";

const TITLE = "Timely: write it down, Timely finds the time";
const DESCRIPTION =
  "A private planner with an AI assistant that runs on the Claude or ChatGPT subscription you already have. Capture a thought and Timely places it on your week, with smart suggestions, docs, sheets and an MCP server for your own agents. Open source, for Windows, Linux and Android.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Timely" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function Home() {
  return <LandingOne />;
}
