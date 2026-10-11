import type { ReactNode } from "react";
import { displayFont } from "@/app/_components/site/displayFont";
import { VariantShell } from "@/app/_components/variations/shell";
import "@/app/_components/variations/v3/v3.css";

const NAV = [
  { href: "#ai", label: "AI" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#download", label: "Download" },
];

/** Design 3, "Board": the site laid out as a kanban from Inbox to Done. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <VariantShell n={3} nav={NAV} className={`v3 ${displayFont.variable}`}>
      {children}
    </VariantShell>
  );
}
