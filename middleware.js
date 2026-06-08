import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);
const AUTH_ON = !!process.env.AUTH_SECRET;
const PUBLIC = ["/login", "/api/auth", "/api/login", "/api/calendar", "/api/sync"];

function legacyPasswords() {
  if (process.env.TEAMS) {
    try { return JSON.parse(process.env.TEAMS).map((t) => t && t.password).filter(Boolean); } catch {}
  }
  return process.env.SITE_PASSWORD ? [process.env.SITE_PASSWORD] : [];
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();

  let ok = false;
  if (AUTH_ON) {
    ok = !!req.auth; // signed in via Google / Microsoft / magic-link
  } else {
    let cookie = req.cookies.get("site_auth")?.value || "";
    try { cookie = decodeURIComponent(cookie); } catch {}
    ok = !!cookie && legacyPasswords().includes(cookie);
  }
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return new NextResponse(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
});

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
