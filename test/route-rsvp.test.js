import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// The RSVP route is the narrow, parent-facing write path. Its whole job is
// permission enforcement (parent → own child only; coach → anyone) and a
// surgical single-entry merge, so we mock auth, the store and the directory.
const { auth, getData, setData, teamBySlug, membershipsForEmail, isCoachForTeam } = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(),
  teamBySlug: vi.fn(), membershipsForEmail: vi.fn(), isCoachForTeam: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getData, setData }));
vi.mock("@/lib/teams", () => ({ teamBySlug }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, isCoachForTeam }));

import { POST } from "@/app/api/rsvp/route";

const PLAYER = { id: "p1", name: "Sam", parentEmails: ["mum@a.com"] };
function happyPath({ email = "mum@a.com", coach = false } = {}) {
  auth.mockResolvedValue({ user: { email } });
  membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: coach ? "coach" : "parent" }] });
  teamBySlug.mockReturnValue({ slug: "a", name: "Team A" });
  getData.mockResolvedValue({ fixtures: [{ id: "f1", availability: {} }], sessions: [{ id: "s1", availability: {} }], players: [PLAYER] });
  isCoachForTeam.mockResolvedValue(coach);
  setData.mockResolvedValue();
}

beforeEach(() => { vi.clearAllMocks(); });

describe("POST /api/rsvp — request validation", () => {
  it("401s when not signed in", async () => {
    auth.mockResolvedValue(null);
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "in" } }));
    expect(res.status).toBe(401);
  });

  it("400s on malformed JSON", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    const res = await POST(fakeRequest({})); // no body → json() throws
    expect(res.status).toBe(400);
  });

  it("400s on an invalid kind or missing ids", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    expect((await POST(fakeRequest({ body: { kind: "nope", id: "f1", playerId: "p1", status: "in" } }))).status).toBe(400);
    expect((await POST(fakeRequest({ body: { kind: "game", playerId: "p1", status: "in" } }))).status).toBe(400);
  });

  it("400s on an invalid status", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "maybe" } }));
    expect(res.status).toBe(400);
  });

  it("400s for a session RSVP with no occurrence date", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    const res = await POST(fakeRequest({ body: { kind: "session", id: "s1", playerId: "p1", status: "in" } }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/rsvp — team resolution", () => {
  it("401s when the caller has no memberships", async () => {
    auth.mockResolvedValue({ user: { email: "x@y.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "in" } }));
    expect(res.status).toBe(401);
  });

  it("ignores a team_slug cookie for a team the caller is not in", async () => {
    happyPath();
    teamBySlug.mockReturnValue({ slug: "a", name: "Team A" });
    await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "in" }, cookies: { team_slug: "other" } }));
    // Falls back to the first membership ("a"), never resolving "other".
    expect(teamBySlug).toHaveBeenCalledWith("a");
  });

  it("404s when the player is not on the roster", async () => {
    happyPath();
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "ghost", status: "in" } }));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/rsvp — permissions", () => {
  it("lets a parent set their own child and writes a single availability entry", async () => {
    happyPath({ coach: false });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "in" } }));
    expect(res.status).toBe(200);
    const [, saved] = setData.mock.calls[0];
    expect(saved.fixtures[0].availability.p1).toMatchObject({ status: "in", by: "Sam" });
  });

  it("forbids a parent from setting another family's child", async () => {
    happyPath({ coach: false });
    getData.mockResolvedValue({ fixtures: [{ id: "f1", availability: {} }], players: [{ id: "p1", name: "Other", parentEmails: ["someone@else.com"] }] });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "in" } }));
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });

  it("lets a coach set anyone and stamps the entry as Coach", async () => {
    happyPath({ email: "coach@a.com", coach: true });
    getData.mockResolvedValue({ fixtures: [{ id: "f1", availability: {} }], players: [{ id: "p1", name: "Other", parentEmails: ["someone@else.com"] }] });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "out", reason: "injured" } }));
    expect(res.status).toBe(200);
    const [, saved] = setData.mock.calls[0];
    expect(saved.fixtures[0].availability.p1).toMatchObject({ status: "out", reason: "injured", by: "Coach" });
  });

  it("clears a response when status is null (deletes the entry)", async () => {
    happyPath({ coach: false });
    getData.mockResolvedValue({ fixtures: [{ id: "f1", availability: { p1: { status: "in" } } }], players: [PLAYER] });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: null } }));
    expect(res.status).toBe(200);
    const [, saved] = setData.mock.calls[0];
    expect(saved.fixtures[0].availability).not.toHaveProperty("p1");
  });

  it("merges a session RSVP into the per-occurrence map", async () => {
    happyPath({ coach: false });
    const res = await POST(fakeRequest({ body: { kind: "session", id: "s1", occ: "2026-07-01", playerId: "p1", status: "in" } }));
    expect(res.status).toBe(200);
    const [, saved] = setData.mock.calls[0];
    expect(saved.sessions[0].availability["2026-07-01"].p1).toMatchObject({ status: "in" });
  });
});
