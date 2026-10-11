import { redirect } from "next/navigation";
import { HELP_SECTIONS } from "@/app/_components/help/registry";

export const dynamicParams = false;

export function generateStaticParams() {
  return HELP_SECTIONS.map((section) => ({ section: section.id }));
}

/** A section has no page of its own; its card on the help home lists the articles. */
export default async function HelpSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  redirect(`/help#${section}`);
}
