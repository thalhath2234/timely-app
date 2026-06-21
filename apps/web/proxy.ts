import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decrypt } from "@/app/utils/session";

const protectedRoutes = [
  "/calendar",
  "/tasks",
  "/report",
  "/settings",
  "/onboarding",
];
const publicRoutes = ["/login", "/signup", "/"];

export default async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  const isProtectedRoute = protectedRoutes.some((route) =>
    path.startsWith(route),
  );

  const isPublicRoute = publicRoutes.includes(path);

  const token = req.cookies.get("session")?.value;

  const session = await decrypt(token);

  if (isProtectedRoute && !session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (isPublicRoute && session && path !== "/") {
    return NextResponse.redirect(new URL("/calendar", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
