import { NextResponse } from "next/server";

// Paths reachable without the site password:
//  - the login page + its API
//  - the calendar feed (calendar apps can't send the cookie; it's protected by its own key)
const PUBLIC = ["/login", "/api/login", "/api/calendar", "/api/sync"];

export function middleware(req) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get("site_auth")?.value;
  if (cookie && process.env.SITE_PASSWORD && cookie === process.env.SITE_PASSWORD) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return new NextResponse(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

// Run on everything except Next's static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
