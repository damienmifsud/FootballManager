import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { decideAccess, legacyPasswords } from "@/lib/access";
import { storedPasswords } from "@/lib/edgeTeams";

const { auth } = NextAuth(authConfig);
const AUTH_ON = !!process.env.AUTH_SECRET;

export default auth(async (req) => {
  const { pathname } = req.nextUrl;

  let cookie = req.cookies.get("site_auth")?.value || "";
  try { cookie = decodeURIComponent(cookie); } catch {}

  // Valid team codes come from the env AND from wizard-created teams; only
  // reach for the stored list (a cached Upstash read) when the env list
  // doesn't already settle it.
  let passwords = legacyPasswords();
  if (!AUTH_ON && cookie && !passwords.includes(cookie)) {
    passwords = [...passwords, ...(await storedPasswords())];
  }

  const action = decideAccess({
    pathname,
    authOn: AUTH_ON,
    authed: !!req.auth, // signed in via Google / Microsoft / magic-link
    cookie,
    passwords
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
