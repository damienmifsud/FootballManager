import { describe, it, expect, beforeEach, vi } from "vitest";

// lib/clubLogoStore: the club logo library on the server. The store is a
// stand-in; lib/clubLogos (pure) is real. Every name, number and address here
// is made up.
const { getClubLogos, setClubLogos, takeLock, dropLock } = vi.hoisted(() => ({
  getClubLogos: vi.fn(), setClubLogos: vi.fn(), takeLock: vi.fn(), dropLock: vi.fn()
}));
vi.mock("@/lib/store", () => ({ getClubLogos, setClubLogos, takeLock, dropLock }));
import { learnLogos, withCrests, withoutCrests, withCrestsSafely, logoAllowed, extraLogoHosts, readLibrary, forgetLibrary, changeLibrary } from "@/lib/clubLogoStore";
import { cleanLibrary } from "@/lib/clubLogos";

const BUCKET = "https://storage.googleapis.com/download/storage/v1/b/squadi-prod.appspot.com/o/";
const orgLogo = (org) => `${BUCKET}organisation%2Flogo_org_${org}_1700000001.jpg?generation=1700000002&alt=media`;
const compLogo = `${BUCKET}competitions%2Flogo_comp_0a1b2c3d_1700000003.blob?generation=1&alt=media`;
const game = (n, opponent, id, logo) => ({ id: "f" + n, squadiId: 900000 + n, opponent, opponentRef: `squadi:team:${id}`, opponentLogo: logo, dateISO: "2026-05-02" });

let stored;
beforeEach(() => {
  vi.clearAllMocks();
  forgetLibrary();
  stored = {};
  getClubLogos.mockImplementation(async () => stored);
  setClubLogos.mockImplementation(async (v) => { stored = v; });
  takeLock.mockResolvedValue(true);
  dropLock.mockResolvedValue(undefined);
  delete process.env.LOGO_HOSTS;
});

describe("learnLogos — what a sync found, added to the library", () => {
  it("adds the opposition's logos under the library's own lock, and frees it", async () => {
    const r = await learnLogos({ draws: [{ provider: "squadi", records: [game(1, "Riverside FC U10 Blue", 500001, orgLogo(41))] }] });
    expect(r).toEqual({ ok: true, changed: true });
    expect(takeLock).toHaveBeenCalledWith("_club", "logos", 20);
    expect(dropLock).toHaveBeenCalledWith("_club", "logos");
    expect(stored.clubs["squadi:org:41"].logo).toBe(orgLogo(41));
  });
  it("writes nothing when nothing is new, and asks nothing for draws with no logos to give", async () => {
    await learnLogos({ draws: [{ provider: "squadi", records: [game(1, "Riverside FC U10 Blue", 500001, orgLogo(41))] }] });
    setClubLogos.mockClear();
    expect(await learnLogos({ draws: [{ provider: "squadi", records: [game(1, "Riverside FC U10 Blue", 500001, orgLogo(41))] }] })).toEqual({ ok: true, changed: false });
    expect(setClubLogos).not.toHaveBeenCalled();
    takeLock.mockClear();
    expect(await learnLogos({ draws: [{ provider: "majestri", records: [game(2, "Reds", 1, "")] }, { provider: "squadi", records: [] }] })).toEqual({ ok: true, changed: false });
    expect(takeLock).not.toHaveBeenCalled();
  });
  it("never throws: a busy lock or a failing store is reported back and otherwise ignored", async () => {
    takeLock.mockResolvedValue(false);
    expect(await learnLogos({ draws: [{ provider: "squadi", records: [game(1, "Riverside FC U10 Blue", 500001, orgLogo(41))] }] })).toEqual({ ok: false, error: "the logo library is busy" });
    expect(takeLock).toHaveBeenCalledTimes(3);
    takeLock.mockResolvedValue(true);
    getClubLogos.mockRejectedValue(new Error("store down"));
    expect(await learnLogos({ draws: [{ provider: "squadi", records: [game(1, "Riverside FC U10 Blue", 500001, orgLogo(41))] }] })).toEqual({ ok: false, error: "store down" });
    expect(dropLock).toHaveBeenCalledWith("_club", "logos");
    takeLock.mockRejectedValue(new Error("redis gone"));
    expect(await learnLogos({ draws: [{ provider: "squadi", records: [game(1, "A", 1, orgLogo(41))] }] })).toEqual({ ok: false, error: "redis gone" });
  });
  it("adds Dribl's club list too", async () => {
    await learnLogos({ clubs: [{ id: "C1", name: "Hilltop SC", logo: "https://cdn.dribl.com/hilltop.png" }] });
    expect(stored.clubs["dribl:club:C1"]).toEqual(expect.objectContaining({ names: ["Hilltop SC"], logo: "https://cdn.dribl.com/hilltop.png", from: "Dribl" }));
  });
});

describe("logoAllowed — Squadi's and Dribl's own hosts, plus any the site names", () => {
  it("takes exact host names from LOGO_HOSTS, never a pattern", () => {
    const env = { LOGO_HOSTS: " Logos.Example.org , *.example.com, bad host, example " };
    expect(extraLogoHosts(env)).toEqual(["logos.example.org"]);
    expect(logoAllowed("https://logos.example.org/a.png", env)).toBe(true);
    expect(logoAllowed("https://x.logos.example.org/a.png", env)).toBe(false);
    expect(logoAllowed("http://logos.example.org/a.png", env)).toBe(false);
    expect(logoAllowed("https://logos.example.org:444/a.png", env)).toBe(false);
    expect(logoAllowed(orgLogo(41), {})).toBe(true);
    expect(logoAllowed("https://logos.example.org/a.png", {})).toBe(false);
  });
});

describe("withCrests and withoutCrests — the crest on each game as a browser gets it, never stored", () => {
  const lib = cleanLibrary({ clubs: { "squadi:org:41": { names: ["Riverside FC U10 Blue"], logo: orgLogo(41) } }, teams: { "squadi:team:500001": { name: "Riverside FC U10 Blue", club: "squadi:org:41" } } });
  const doc = { team: { name: "Us" }, fixtures: [game(1, "Riverside FC U10 Blue", 500001, compLogo), game(2, "Lions FC U10 Blue", 500005, orgLogo(57)), game(3, "Seaside FC U10", 500009, compLogo)] };
  it("adds the library's choice to each game the built-in crests do not cover, and leaves the document itself alone", () => {
    const out = withCrests(doc, lib);
    expect(out.fixtures.map((f) => f.opponentCrest)).toEqual([orgLogo(41), undefined, null]);
    expect("opponentCrest" in out.fixtures[1]).toBe(false);
    expect(doc.fixtures.some((f) => "opponentCrest" in f)).toBe(false);
    expect(withCrests({ team: {} }, lib)).toEqual({ team: {} });
    expect(withCrests(null, lib)).toBeNull();
  });
  it("takes every crest off again before a save", () => {
    const back = withoutCrests(withCrests(doc, lib));
    expect(back.fixtures.some((f) => "opponentCrest" in f)).toBe(false);
    expect(back.fixtures).toEqual(doc.fixtures);
    expect(withoutCrests(doc)).toBe(doc);
  });
  it("serves the document as it is when the library cannot be read", async () => {
    getClubLogos.mockRejectedValue(new Error("store down"));
    expect(await withCrestsSafely(doc)).toBe(doc);
  });
  it("reads the library at most every half minute, and a change made here is seen at once", async () => {
    stored = { clubs: { "squadi:org:41": { names: ["A"], logo: orgLogo(41) } } };
    await readLibrary(); await readLibrary();
    expect(getClubLogos).toHaveBeenCalledTimes(1);
    await changeLibrary((l) => ({ lib: { ...l, manual: { "squadi:org:41": { hidden: true } } }, changed: true }));
    expect((await readLibrary()).manual).toEqual({ "squadi:org:41": { hidden: true } });
  });
});
