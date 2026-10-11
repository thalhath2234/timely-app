import type { Metadata } from "next";
import HelpHomeOne from "@/app/_components/help/helpHomeOne";

export const metadata: Metadata = {
  title: { absolute: "Timely Help Center" },
};

export default function HelpHome() {
  return <HelpHomeOne />;
}
