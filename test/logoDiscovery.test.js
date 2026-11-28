import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Logo discovery as the imports do it: the references each game keeps for the
// club logo library (Squadi's team number; Dribl's team and club ids), Dribl's
// club list read in the browser and checked by the server, the read-back's
// counts, and the library learning after a sync without ever getting in its
// way. Every name, number and address here is made up.
const { getData, setData, getMeta, setMeta, takeLock, dropLock, learnLogos } = vi.hoisted(() => ({
  getData: vi.fn(), setData: vi.fn(), getMeta: vi.fn(), setMeta: vi.fn(), takeLock: vi.fn(), dropLock: vi.fn(), learnLogos: vi.fn()
}));
vi.mock("@/lib/store", () => ({ getData, setData, getMeta, setMeta, takeLock, dropLock }));
vi.mock("@/lib/clubLogoStore", () => ({ learnLogos }));
import { normalize, applySync } from "@/lib/squadiSync";
import { applyDraws } from "@/lib/applyDraws";
import {
  normalizeDribl, sanitizeDrawRecords, driblClubsUrl, readDriblClubs, fetchDriblClubs, sanitizeDriblClubs,
  driblDrawNames, driblLogos, politeness, UNREACHABLE
} from "@/lib/dribl";
import { driblClubsReadBack } from "@/lib/driblLink";
import { driblLogoNote } from "@/components/TeamWizard";

const realWait = politeness.wait;
beforeEach(() => {
  vi.clearAllMocks();
  politeness.wait = async () => {};
  takeLock.mockResolvedValue(true); dropLock.mockResolvedValue(undefined);
  getMeta.mockResolvedValue({}); setMeta.mockResolvedValue(undefined); setData.mockResolvedValue(undefined);
  learnLogos.mockResolvedValue({ ok: true, changed: true });
});
afterEach(() => { politeness.wait = realWait; });

const BUCKET = "https://storage.googleapis.com/download/storage/v1/b/squadi-prod.appspot.com/o/";
const orgLogo = (org) => `${BUCKET}organisation%2Flogo_org_${org}_1700000001.jpg?generation=1700000002&alt=media`;

describe("Squadi: the opponent's team number on each game", () => {
  const cfg = { competitionId: "700", divisionId: "800", teamId: 500100 };
  const json = (matches) => ({ rounds: [{ name: "Round 3", sequence: 2, matches }] });
  const m = (over = {}) => ({ id: 70001, startTime: "2026-05-02T00:00:00Z", team1: { id: 500100, name: "Us FC", logoUrl: "" }, team2: { id: 500001, name: "Riverside FC U10 Blue", logoUrl: orgLogo(41) }, venueCourt: { name: "Field 1", venue: { name: "Park" } }, ...over });
  it("is read for the side we play, home or away", () => {
    expect(normalize(json([m()]), cfg)[0]).toMatchObject({ opponent: "Riverside FC U10 Blue", opponentRef: "squadi:team:500001", opponentLogo: orgLogo(41) });
    const away = m({ team1: { id: 500002, name: "Hilltop SC", logoUrl: "" }, team2: { id: 500100, name: "Us FC", logoUrl: "" } });
    expect(normalize(json([away]), cfg)[0].opponentRef).toBe("squadi:team:500002");
    expect(normalize(json([m({ team2: { id: "x", name: "Odd", logoUrl: "" } })]), cfg)[0]).not.toHaveProperty("opponentRef");
  });
  it("is kept by the sync on a new game, filled in quietly on one it already has, and never replaced by nothing", () => {
    const rec = { squadiId: 70001, round: 3, dateISO: "2026-05-02", time: "10:00", opponent: "Riverside FC U10 Blue", opponentLogo: orgLogo(41), ourLogo: "", homeAway: "H", venue: "Park – Field 1", opponentRef: "squadi:team:500001" };
    const created = applySync({ fixtures: [] }, [rec]);
    expect(created.data.fixtures[0].opponentRef).toBe("squadi:team:500001");
    const { opponentRef, ...older } = created.data.fixtures[0];
    const filled = applySync({ fixtures: [{ ...older, schedChanges: [] }] }, [rec]);
    expect(filled.mutated).toBe(true);
    expect(filled.changes).toEqual([]); // silent, like a logo
    expect(filled.data.fixtures[0].opponentRef).toBe("squadi:team:500001");
    const { opponentRef: _, ...noRef } = rec;
    const kept = applySync(filled.data, [noRef]);
    expect(kept.data.fixtures[0].opponentRef).toBe("squadi:team:500001");
    expect(applySync({ fixtures: [] }, [{ ...rec, opponentRef: "squadi:team:1; drop" }]).data.fixtures[0]).not.toHaveProperty("opponentRef");
  });
});

describe("applyDraws: the library learns after the games are in, and never gets in their way", () => {
  const team = { slug: "u10", name: "Under 10s" };
  const rec = { squadiId: 70001, round: 3, dateISO: "2026-05-02", time: "10:00", opponent: "Riverside FC U10 Blue", opponentLogo: orgLogo(41), ourLogo: "", homeAway: "H", venue: "Park", opponentRef: "squadi:team:500001" };
  it("hands each draw's games to the library with its provider, and Dribl's club list with them", async () => {
    getData.mockResolvedValue({ fixtures: [] });
    const clubs = [{ id: "C1", name: "Hilltop SC", logo: "" }];
    const out = await applyDraws(team, [{ comp: null, records: [rec], provider: "squadi" }, { comp: { id: "c", name: "Cup" }, records: [], provider: "majestri" }], { clubs });
    expect(out).toMatchObject({ created: 1 });
    expect(learnLogos).toHaveBeenCalledWith({ draws: [{ provider: "squadi", records: [rec] }, { provider: "majestri", records: [] }], clubs });
    // ...after the team's lock was freed.
    expect(dropLock.mock.invocationCallOrder[0]).toBeLessThan(learnLogos.mock.invocationCallOrder[0]);
  });
  it("answers exactly as before when the library fails, and learns nothing from a sync that applied nothing", async () => {
    getData.mockResolvedValue({ fixtures: [] });
    learnLogos.mockRejectedValue(new Error("library down"));
    expect(await applyDraws(team, [{ records: [rec], provider: "squadi" }])).toMatchObject({ created: 1, matchesSeen: 1 });
    learnLogos.mockClear();
    getData.mockResolvedValue(null);
    expect(await applyDraws(team, [{ records: [rec], provider: "squadi" }])).toBeNull();
    takeLock.mockResolvedValue(false);
    expect(await applyDraws(team, [{ records: [rec], provider: "squadi" }])).toMatchObject({ busy: true });
    expect(learnLogos).not.toHaveBeenCalled();
  });
});

describe("Dribl: each game's logo and ids, as far as it carries them", () => {
  const item = (id, home, away, more = {}) => ({ hash_id: id, attributes: { date: "2026-06-06T23:00:00.000000Z", round: "R1", home_team_name: home, away_team_name: away, ground_name: "Park", field_name: "F1", bye_flag: false, ...more } });
  const US = "Us FC U10";
  it("takes the other side's logo, team id and club id from the first field names a game has", () => {
    const [home, away] = normalizeDribl([
      item("g1", US, "Hilltop SC U10", { home_logo: "https://cdn.dribl.com/us.png", away_logo: "https://cdn.dribl.com/hilltop.png", home_team_hash_id: "T0", away_team_hash_id: "T1", home_club_hash_id: "C0", away_club_hash_id: "C1" }),
      item("g2", "Seaside FC U10", US, { home_club_logo: "https://cdn.dribl.com/seaside.png", away_club_logo: "", home_team_id: 4321 })
    ], { team: US });
    expect(home).toMatchObject({ opponent: "Hilltop SC U10", opponentLogo: "https://cdn.dribl.com/hilltop.png", ourLogo: "https://cdn.dribl.com/us.png", opponentRef: "dribl:team:T1", opponentClubRef: "dribl:club:C1" });
    expect(away).toMatchObject({ opponent: "Seaside FC U10", opponentLogo: "https://cdn.dribl.com/seaside.png", opponentRef: "dribl:team:4321" });
    expect(away).not.toHaveProperty("opponentClubRef");
  });
  it("keeps the ids a coach's browser posts only when they are well formed", () => {
    const base = { squadiId: "dribl:g1", round: 1, dateISO: "2026-06-06", time: "09:00", opponent: "Hilltop SC U10", homeAway: "H", venue: "" };
    expect(sanitizeDrawRecords([{ ...base, opponentRef: "dribl:team:T1", opponentClubRef: "dribl:club:C1" }])[0]).toMatchObject({ opponentRef: "dribl:team:T1", opponentClubRef: "dribl:club:C1" });
    const [bad] = sanitizeDrawRecords([{ ...base, opponentRef: "squadi:team:1", opponentClubRef: "dribl:club:<script>" }]);
    expect(bad).not.toHaveProperty("opponentRef");
    expect(bad).not.toHaveProperty("opponentClubRef");
  });
  it("counts, for the read-back, the teams we play with a logo, those the app can show, and where the rest are", () => {
    const games = [
      item("g1", US, "Hilltop SC U10", { away_logo: "https://cdn.dribl.com/hilltop.png" }),
      item("g2", "Seaside FC U10", US, { home_logo: "https://images.example.com/seaside.png" }),
      item("g3", US, "Valley U10"), item("g4", US, "Hilltop SC U10")
    ];
    expect(driblDrawNames(games, US).logos).toEqual({ teams: 3, withLogo: 2, shown: 1, hosts: { "cdn.dribl.com": 1, "images.example.com": 1 }, elsewhere: ["images.example.com"], logoField: "home_logo/away_logo", teamIdField: "", clubIdField: "" });
    expect(driblLogos([], US)).toEqual({ teams: 0, withLogo: 0, shown: 0, hosts: {}, elsewhere: [], logoField: "", teamIdField: "", clubIdField: "" });
  });
});

describe("Dribl's club list", () => {
  const REQUEST = "https://mc-api.dribl.com/api/fixtures?date_range=all&league=L1&tenant=Tn12345678&timezone=Australia%2FBrisbane";
  const CLUBS = "https://mc-api.dribl.com/api/list/clubs?tenant=Tn12345678";
  const answer = (json, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
  it("is asked for with the request's match centre and nothing else", () => {
    expect(driblClubsUrl(REQUEST)).toBe(CLUBS);
    expect(driblClubsUrl("https://example.com/api/fixtures?tenant=X")).toBe("");
    expect(driblClubsUrl("")).toBe("");
  });
  it("is read without assuming its shape: a JSON:API list or a plain one, under any of the usual field names", () => {
    expect(readDriblClubs({ data: [{ type: "clubs", hash_id: "C1", attributes: { name: "Hilltop SC", logo: "https://cdn.dribl.com/h.png" } }, { id: "C2", attributes: { club_name: "Seaside FC", image_url: "https://cdn.dribl.com/s.png" } }, { attributes: { name: "No id" } }] }))
      .toEqual({ clubs: [{ id: "C1", name: "Hilltop SC", logo: "https://cdn.dribl.com/h.png" }, { id: "C2", name: "Seaside FC", logo: "https://cdn.dribl.com/s.png" }], fields: ["name", "logo", "club_name", "image_url"] });
    expect(readDriblClubs([{ id: 7, title: "Valley FC", crest: "http://cdn.dribl.com/v.png" }]).clubs).toEqual([{ id: "7", name: "Valley FC", logo: "" }]);
    expect(() => readDriblClubs({ clubs: [] })).toThrow("Dribl's club list was not in the form this app reads.");
  });
  it("is read page after page, by Dribl's cursor on the same request", async () => {
    const asked = [];
    const fetchImpl = vi.fn(async (url) => {
      asked.push(String(url));
      return String(url).includes("cursor=") ? answer({ data: [{ id: "C2", attributes: { name: "B" } }], meta: {} }) : answer({ data: [{ id: "C1", attributes: { name: "A" } }], meta: { next_cursor: "abc" } });
    });
    expect((await fetchDriblClubs({ url: REQUEST }, fetchImpl)).clubs.map((c) => c.id)).toEqual(["C1", "C2"]);
    expect(asked).toEqual([CLUBS, CLUBS + "&cursor=abc"]);
    await expect(fetchDriblClubs({ url: REQUEST }, vi.fn(async () => answer({}, 404)))).rejects.toThrow("Dribl responded 404");
  });
  it("is checked by the server before the library sees it", () => {
    expect(sanitizeDriblClubs([{ id: "C1", name: "  Hilltop   SC ", logo: "https://cdn.dribl.com/h.png" }, { id: "C1", name: "Again" }, { id: "bad id", name: "X" }, { id: "C2", name: "" }, { id: "C3", name: "Seaside", logo: "http://x/y.png" }, "junk"]))
      .toEqual([{ id: "C1", name: "Hilltop SC", logo: "https://cdn.dribl.com/h.png" }, { id: "C3", name: "Seaside", logo: "" }]);
    expect(sanitizeDriblClubs(undefined)).toEqual([]);
  });
  it("is read back in counts and host names, or with why it could not be read", async () => {
    const fetchImpl = vi.fn(async () => answer({ data: [{ id: "C1", attributes: { name: "A", logo: "https://cdn.dribl.com/a.png" } }, { id: "C2", attributes: { name: "B", logo: "https://images.example.com/b.png" } }, { id: "C3", attributes: { name: "C" } }] }));
    expect(await driblClubsReadBack({ url: REQUEST }, fetchImpl)).toEqual({ count: 3, withLogo: 2, shown: 1, hosts: { "cdn.dribl.com": 1, "images.example.com": 1 }, elsewhere: ["images.example.com"], fields: ["name", "logo"] });
    expect(await driblClubsReadBack({ url: REQUEST }, vi.fn(async () => { throw new TypeError("Failed to fetch"); }))).toEqual({ error: UNREACHABLE });
  });
});

describe("driblLogoNote — what the set-up's read-back says of logos", () => {
  it("says how many come through, where the rest are, and what Dribl's club list holds", () => {
    expect(driblLogoNote({ teams: 12, withLogo: 11, shown: 10, elsewhere: ["images.example.com"] }, { count: 40, withLogo: 38, shown: 38, elsewhere: [] }))
      .toBe("Logos for 10 of the 12 teams it plays come through. Logos for 1 team are on images.example.com, which the app does not show logos from yet. Dribl's club list has 40 clubs, 38 with a logo the app can show.");
  });
  it("lists the field names a game had when Dribl gives no logos, and says why a club list could not be read", () => {
    expect(driblLogoNote({ teams: 2, withLogo: 0, shown: 0, elsewhere: [] }, { error: "Dribl responded 404." }, { fields: ["date", "home_team_name"] }))
      .toBe("Dribl gives no logos with these games (a game there has: date, home_team_name). Dribl's club list could not be read (Dribl responded 404).");
    expect(driblLogoNote({ teams: 0 }, { count: 0 })).toBe("Dribl's club list is empty.");
    expect(driblLogoNote(undefined, undefined)).toBe("");
  });
});
