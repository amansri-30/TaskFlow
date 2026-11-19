import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const protectedRoutes = ["/dashboard"];
// `/forgot-password` is deliberately absent: a signed-in user may open it to
// reset a password they no longer know, and the login form already hides its
// own link from authenticated visitors.
const authRoutes = ["/login", "/signup"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("token")?.value;

  if (protectedRoutes.some((route) => pathname.startsWith(route))) {
    if (!token) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // A stale `token` cookie must not trap the user out of the login form. Both
  // the 401 handler and the "Go to Login" button navigate with `?expired=1`
  // after the server has rejected/cleared the session, so that one flag opts
  // out of the "already signed in" redirect.
  if (
    authRoutes.includes(pathname) &&
    token &&
    !request.nextUrl.searchParams.has("expired")
  ) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup"],
};
