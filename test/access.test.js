import { describe, it, expect } from "vitest";
import { isPublicPath, legacyPasswords, decideAccess, isKeyedPath, hasBearer, KEYED_PATHS } from "@/lib/access";

describe("isPublicPath", () => {
  it("allows the public entries and their subpaths", () => {
    for (const p of ["/login", "/login/reset", "/api/auth", "/api/auth/callback/google", "/api/login", "/api/calendar", "/api/sync", "/crests", "/crests/olympic-fc.png"]) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it("does not treat protected paths as public", () => {
    for (const p of ["/", "/dashboard", "/api/data", "/api/rsvp", "/league"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });

  it("does not let a prefix lookalike slip through", () => {
    expect(isPublicPath("/loginX")).toBe(false);
    expect(isPublicPath("/api/loginsomething")).toBe(false);
    expect(isPublicPath("/api/syncer")).toBe(false);
  });
});

describe("legacyPasswords", () => {
  it("reads passwords from TEAMS, dropping blanks", () => {
    const env = { TEAMS: JSON.stringify([{ password: "a" }, { password: "" }, { name: "no-pw" }, { password: "b" }]) };
    expect(legacyPasswords(env)).toEqual(["a", "b"]);
  });

  it("falls back to SITE_PASSWORD when TEAMS is invalid JSON", () => {
    expect(legacyPasswords({ TEAMS: "{bad", SITE_PASSWORD: "legacy" })).toEqual(["legacy"]);
  });

  it("uses SITE_PASSWORD when TEAMS is unset", () => {
    expect(legacyPasswords({ SITE_PASSWORD: "legacy" })).toEqual(["legacy"]);
  });

  it("returns an empty list when nothing is configured", () => {
    expect(legacyPasswords({})).toEqual([]);
  });
});

describe("decideAccess", () => {
  const base = { authOn: false, authed: false, cookie: "", passwords: [] };

  it("always allows public paths regardless of auth state", () => {
    expect(decideAccess({ ...base, pathname: "/login" })).toBe("allow");
    expect(decideAccess({ ...base, pathname: "/api/calendar", authOn: true })).toBe("allow");
  });

  describe("account-login mode (authOn)", () => {
    it("allows a signed-in request", () => {
      expect(decideAccess({ ...base, authOn: true, authed: true, pathname: "/dashboard" })).toBe("allow");
    });

    it("401s an unauthenticated API request", () => {
      expect(decideAccess({ ...base, authOn: true, authed: false, pathname: "/api/data" })).toBe("unauthorized");
    });

    it("redirects an unauthenticated page request to login", () => {
      expect(decideAccess({ ...base, authOn: true, authed: false, pathname: "/dashboard" })).toBe("login");
    });

    it("ignores the legacy cookie when account login is on", () => {
      expect(decideAccess({ ...base, authOn: true, authed: false, cookie: "team-code", passwords: ["team-code"], pathname: "/dashboard" })).toBe("login");
    });
  });

  describe("legacy team-code mode", () => {
    it("allows a request whose cookie matches a known password", () => {
      expect(decideAccess({ ...base, cookie: "team-code", passwords: ["team-code"], pathname: "/dashboard" })).toBe("allow");
    });

    it("401s an API request with a wrong/empty cookie", () => {
      expect(decideAccess({ ...base, cookie: "nope", passwords: ["team-code"], pathname: "/api/data" })).toBe("unauthorized");
      expect(decideAccess({ ...base, cookie: "", passwords: ["team-code"], pathname: "/api/data" })).toBe("unauthorized");
    });

    it("redirects a page request with a wrong cookie to login", () => {
      expect(decideAccess({ ...base, cookie: "nope", passwords: ["team-code"], pathname: "/dashboard" })).toBe("login");
    });
  });
});

// A scheduled job reaches /api/dribl with its key as a Bearer token. The gate
// passes such a request to the route, which checks the key itself; without a
// token, or on any other path, the gate decides as it always has.
describe("a scheduled job's keyed calls", () => {
  const base = { authOn: true, authed: false, cookie: "", passwords: [] };

  it("lets a request with a Bearer token through to the Dribl route, signed in or not, in either mode", () => {
    expect(KEYED_PATHS).toEqual(["/api/dribl"]);
    expect(decideAccess({ ...base, pathname: "/api/dribl", bearer: true })).toBe("allow");
    expect(decideAccess({ ...base, authOn: false, pathname: "/api/dribl", bearer: true })).toBe("allow");
  });

  it("without a token the Dribl route is guarded as before", () => {
    expect(decideAccess({ ...base, pathname: "/api/dribl" })).toBe("unauthorized");
    expect(decideAccess({ ...base, pathname: "/api/dribl", bearer: false })).toBe("unauthorized");
    expect(decideAccess({ ...base, authOn: false, pathname: "/api/dribl" })).toBe("unauthorized");
    expect(decideAccess({ ...base, pathname: "/api/dribl", authed: true })).toBe("allow");
  });

  it("a token opens no other path, and no path that only starts like it", () => {
    for (const pathname of ["/api/data", "/api/teams", "/api/dribl/x", "/api/driblx", "/api/dribl.json", "/", "/admin", "/league"]) {
      expect(isKeyedPath(pathname), pathname).toBe(false);
      expect(decideAccess({ ...base, pathname, bearer: true }), pathname).not.toBe("allow");
    }
  });

  it("hasBearer: a Bearer token with something in it, and nothing else", () => {
    expect(hasBearer("Bearer abc")).toBe(true);
    for (const h of [null, undefined, "", "Bearer", "Bearer ", "bearer abc", "Basic abc", " Bearer abc", "abc", 7]) expect(hasBearer(h), String(h)).toBe(false);
  });
});

