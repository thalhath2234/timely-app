import type { ReactNode } from "react";
import { VariantShell } from "@/app/_components/variations/shell";
import "@/app/_components/variations/v2/v2.css";

const NAV = [
  { href: "#ai", label: "AI" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#download", label: "Download" },
];

/** Design 2, "Ask": the site is a conversation with the assistant. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <VariantShell n={2} nav={NAV} className="v2">
      {children}
    </VariantShell>
  );
}
