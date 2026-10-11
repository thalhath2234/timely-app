import type { ReactNode } from "react";
import { VariantShell } from "@/app/_components/variations/shell";
import "@/app/_components/variations/v5/v5.css";

const NAV = [
  { href: "#ai", label: "AI" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#download", label: "Download" },
];

/** Design 5, "Dashboard": the site is Timely's card dashboard. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <VariantShell n={5} nav={NAV} className="v5">
      {children}
    </VariantShell>
  );
}
