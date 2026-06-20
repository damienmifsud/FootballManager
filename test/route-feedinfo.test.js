import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/feedinfo returns the team's calendar subscribe URL for the logged-in
// user. We mock team resolution and drive the forwarded-host/proto headers.
const { teamFromCookieHeader } = vi.hoisted(() => ({ teamFromCookieHeader: vi.fn() }));
vi.mock("@/lib/teams", () => ({ teamFromCookieHeader }));

import { GET } from "@/app/api/feedinfo/route";

beforeEach(() => { vi.clearAllMocks(); });

describe("GET /api/feedinfo", () => {
  it("401s when the cookie resolves to no team", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    expect((await GET(fakeRequest())).status).toBe(401);
  });

  it("500s when the team has no calendar key configured", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a", calendarKey: "" });
    const res = await GET(fakeRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/no calendar key/);
  });

  it("builds the feed URL from the forwarded host and proto", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a", calendarKey: "key-a" });
    const res = await GET(fakeRequest({ headers: { "x-forwarded-host": "team.example.com", "x-forwarded-proto": "https" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).feedUrl).toBe("https://team.example.com/api/calendar?key=key-a");
  });

  it("falls back to the host header and https when forwarded headers are absent", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a", calendarKey: "key-a" });
    const res = await GET(fakeRequest({ headers: { host: "localhost:3000" } }));
    expect((await res.json()).feedUrl).toBe("https://localhost:3000/api/calendar?key=key-a");
  });
});
