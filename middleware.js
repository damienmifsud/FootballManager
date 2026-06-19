import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { decideAccess, legacyPasswords } from "@/lib/access";

const { auth } = NextAuth(authConfig);
const AUTH_ON = !!process.env.AUTH_SECRET;

export default auth((req) => {
  const { pathname } = req.nextUrl;

  let cookie = req.cookies.get("site_auth")?.value || "";
  try { cookie = decodeURIComponent(cookie); } catch {}

  const action = decideAccess({
    pathname,
    authOn: AUTH_ON,
    authed: !!req.auth, // signed in via Google / Microsoft / magic-link
    cookie,
    passwords: legacyPasswords()
  });

  if (action === "allow") return NextResponse.next();
  if (action === "unauthorized") {
    return new NextResponse(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
});

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
