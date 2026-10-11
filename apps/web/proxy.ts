import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decrypt } from "@/app/utils/session";
import { legacyFilePath } from "@/app/utils/fileRoutes";

const protectedPrefixes = [
  "/chat",
  "/calendar",
  "/today",
  "/inbox",
  "/tasks",
  "/projects",
  "/dashboard",
  "/settings",
  "/setup",
  "/files",
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

  // Report was renamed Dashboard; old links keep working.
  if (path === "/report" || path.startsWith("/report/")) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Docs and sheets moved under /files; old links keep working.
  const moved = legacyFilePath(path);
  if (moved) {
    const url = req.nextUrl.clone();
    url.pathname = moved;
    return NextResponse.redirect(url);
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
