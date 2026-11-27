// Pure access-decision helpers for the edge middleware. Deliberately free of
// NextAuth / NextResponse so the routing rules stay edge-safe and can be unit
// tested without standing up the whole auth stack.

export const PUBLIC_PATHS = ["/login", "/api/auth", "/api/login", "/api/calendar", "/api/sync", "/crests"];

// A path is public if it equals a public entry or sits under it ("/x/..."),
// so "/loginX" is NOT public — only "/login" and "/login/...".
export function isPublicPath(pathname) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// Routes a scheduled job reaches with its key (CRON_SECRET as a Bearer token,
// lib/cronAuth.js). A request to one of these that carries a Bearer token is
// passed on to the route, which checks the key itself and treats anything else
// as an ordinary signed-out request. Exact paths only. (/api/sync is public
// outright, as it always was: a pinger may send its key as ?key=.)
export const KEYED_PATHS = ["/api/dribl"];
export const isKeyedPath = (pathname) => KEYED_PATHS.includes(pathname);

// Does an Authorization header carry a Bearer token? Whether it is the right
// one is for the route to say.
export const hasBearer = (header) => /^Bearer \S/.test(typeof header === "string" ? header : "");

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
//   bearer    - the request carries a Bearer token (hasBearer())
export function decideAccess({ pathname, authOn, authed, cookie, passwords, bearer = false }) {
  if (isPublicPath(pathname)) return "allow";
  if (bearer && isKeyedPath(pathname)) return "allow";
  const ok = authOn ? !!authed : (!!cookie && passwords.includes(cookie));
  if (ok) return "allow";
  return pathname.startsWith("/api/") ? "unauthorized" : "login";
}
