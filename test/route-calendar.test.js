import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/calendar is the only unauthenticated lane: the key in the URL both
// authorises the request and selects the team. seasonICS is the real module.
const { getData, teamByCalendarKey } = vi.hoisted(() => ({ getData: vi.fn(), teamByCalendarKey: vi.fn() }));
vi.mock("@/lib/store", () => ({ getData }));
vi.mock("@/lib/teams", () => ({ teamByCalendarKey }));

import { GET } from "@/app/api/calendar/route";

beforeEach(() => { vi.clearAllMocks(); });

describe("GET /api/calendar", () => {
  it("403s when the key matches no team", async () => {
    teamByCalendarKey.mockReturnValue(null);
    const res = await GET(fakeRequest({ url: "https://x.test/api/calendar?key=bogus" }));
    expect(res.status).toBe(403);
    expect(teamByCalendarKey).toHaveBeenCalledWith("bogus");
    expect(getData).not.toHaveBeenCalled();
  });

  it("serves the team's ICS feed for a valid key", async () => {
    teamByCalendarKey.mockReturnValue({ slug: "a", name: "Team A" });
    getData.mockResolvedValue({ team: { name: "Team A" }, fixtures: [], sessions: [], players: [] });
    const res = await GET(fakeRequest({ url: "https://x.test/api/calendar?key=key-a" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/calendar");
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("X-WR-CALNAME:Team A 2026");
    expect(getData).toHaveBeenCalledWith("a");
  });

  it("serves an empty calendar when the team has no data yet", async () => {
    teamByCalendarKey.mockReturnValue({ slug: "a", name: "Team A" });
    getData.mockResolvedValue(null);
    const res = await GET(fakeRequest({ url: "https://x.test/api/calendar?key=key-a" }));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("END:VCALENDAR");
  });
});
