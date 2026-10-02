import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decrypt } from "@/app/utils/session";

const protectedPrefixes = [
  "/chat",
  "/calendar",
  "/today",
  "/inbox",
  "/tasks",
  "/projects",
  "/report",
  "/settings",
  "/docs",
  "/sheets",
  "/notifications",
];
const publicExact = new Set(["/login", "/signup", "/"]);

function isProtectedPath(path: string) {
  return protectedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const access = await decrypt(req.cookies.get("session")?.value);
  const hasRefresh = Boolean(req.cookies.get("refresh")?.value);
  const authenticated = Boolean(access) || hasRefresh;
  const onboarded = Boolean(access?.is_on_boarding_completed);

  if (path === "/m" || path.startsWith("/m/")) {
    return NextResponse.redirect(new URL("/calendar", req.url));
  }

  if (isProtectedPath(path) && !authenticated) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (path === "/onboarding" && !authenticated) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Signed-in visitors skip the landing page as well as the auth pages.
  if (publicExact.has(path) && authenticated) {
    return NextResponse.redirect(
      new URL(onboarded || !access ? "/calendar" : "/onboarding", req.url),
    );
  }

  if (authenticated && access && !onboarded && isProtectedPath(path) && path !== "/onboarding") {
    return NextResponse.redirect(new URL("/onboarding", req.url));
  }

  if (path === "/onboarding" && onboarded) {
    return NextResponse.redirect(new URL("/calendar", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
