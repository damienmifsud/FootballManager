import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/logout/route";

// Signing out of team-code mode must clear the httpOnly site_auth cookie
// server-side (client JS can't) plus the team selector.
describe("POST /api/logout", () => {
  it("expires the site_auth and team_slug cookies", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const cookies = res.headers.getSetCookie();
    const site = cookies.find((c) => c.startsWith("site_auth="));
    const slug = cookies.find((c) => c.startsWith("team_slug="));
    expect(site).toContain("Max-Age=0");
    expect(site).toContain("HttpOnly");
    expect(slug).toContain("Max-Age=0");
    // Both cleared for the whole site.
    expect(site).toContain("Path=/");
    expect(slug).toContain("Path=/");
  });
});
