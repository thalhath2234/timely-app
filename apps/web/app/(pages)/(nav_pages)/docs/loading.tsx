import { LogoLoader } from "@/app/_components/_ui/timelyLogo";

// Keeps the list on the left while an item loads; without it the section-wide
// loader replaced the whole page, list included.
export default function Loading() {
  return <LogoLoader label="Loading" className="h-full" />;
}
