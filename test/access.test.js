import { describe, it, expect } from "vitest";
import { isPublicPath, legacyPasswords, decideAccess } from "@/lib/access";

describe("isPublicPath", () => {
  it("allows the public entries and their subpaths", () => {
    for (const p of ["/login", "/login/reset", "/api/auth", "/api/auth/callback/google", "/api/login", "/api/calendar", "/api/sync"]) {
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
