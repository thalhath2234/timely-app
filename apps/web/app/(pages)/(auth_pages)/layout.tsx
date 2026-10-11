import { displayFont } from "@/app/_components/site/displayFont";
import { cn } from "@/app/utils/cn";
import "@/app/_components/site/site.css";

// Sign-in, sign-up and onboarding continue the landing page: always dark,
// with its tokens and display face.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={cn("site lp dark", displayFont.variable)}>{children}</div>;
}
