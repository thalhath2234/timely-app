import type { ReactNode } from "react";
import { VariantShell } from "@/app/_components/variations/shell";
import "@/app/_components/variations/v4/v4.css";

const NAV = [
  { href: "#ai", label: "AI" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#download", label: "Download" },
];

/** Design 4, "Sheet": the site laid out on a spreadsheet grid. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <VariantShell n={4} nav={NAV} className="v4">
      {children}
    </VariantShell>
  );
}
