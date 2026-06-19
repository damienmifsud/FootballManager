// Pure access-decision helpers for the edge middleware. Deliberately free of
// NextAuth / NextResponse so the routing rules stay edge-safe and can be unit
// tested without standing up the whole auth stack.

export const PUBLIC_PATHS = ["/login", "/api/auth", "/api/login", "/api/calendar", "/api/sync"];

// A path is public if it equals a public entry or sits under it ("/x/..."),
// so "/loginX" is NOT public — only "/login" and "/login/...".
export function isPublicPath(pathname) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// Valid legacy (team-code) session cookie values, from TEAMS or SITE_PASSWORD.
export function legacyPasswords(env = process.env) {
  if (env.TEAMS) {
    try { return JSON.parse(env.TEAMS).map((t) => t && t.password).filter(Boolean); } catch {}
  }
  return env.SITE_PASSWORD ? [env.SITE_PASSWORD] : [];
}

// What should the middleware do with this request? Returns:
//   "allow"        - let it through
//   "unauthorized" - API request, respond 401
//   "login"        - page request, redirect to /login
// Inputs are plain values so the decision is trivially testable:
//   authOn    - account login (AUTH_SECRET) enabled
//   authed    - request carries a valid Auth.js session
//   cookie    - already URL-decoded site_auth cookie (legacy mode)
//   passwords - valid legacy passwords (from legacyPasswords())
export function decideAccess({ pathname, authOn, authed, cookie, passwords }) {
  if (isPublicPath(pathname)) return "allow";
  const ok = authOn ? !!authed : (!!cookie && passwords.includes(cookie));
  if (ok) return "allow";
  return pathname.startsWith("/api/") ? "unauthorized" : "login";
}
