import { describe, it, expect } from "vitest";
import { sourceLogo, oppCrestFor, crestFor, cleanFill, withFill, crestFill } from "@/lib/clubs";
import {
  squadiLogoKind, providerOf, teamRefOf, cleanLibrary, learnFromGames, learnDriblClubs, crestFromLibrary, logoSummary, setManual, isRef, sameName, clubWords, namedKey, namedCovers, guessClubName, namedClubFor, setNamedClub, dropNamedClub, NAMED_MAX
} from "@/lib/clubLogos";

// lib/clubLogos: the club logo library's extension, for opposition clubs the
// built-in registry (lib/clubs.js) has no artwork for. Every name, number and
// address here is made up.
const BUCKET = "https://storage.googleapis.com/download/storage/v1/b/squadi-prod.appspot.com/o/";
const orgLogo = (org, upload = 1700000001) => `${BUCKET}organisation%2Flogo_org_${org}_${upload}.jpg?generation=1700000002&alt=media`;
const compLogo = `${BUCKET}competitions%2Flogo_comp_0a1b2c3d-1111-4c3b-aef9-222233334444_1700000003.blob?generation=1700000004&alt=media`;
const teamLogo = `${BUCKET}team%2Flogo_team_77_1700000005.png?generation=1700000006&alt=media`;
const DRIBL_LOGO = "https://cdn.dribl.com/clubs/riverside.png";
// Squadi writes some file names with a slash in front: the shape seen on a real tournament's teams.
const slashCompLogo = `${BUCKET}%2Fcompetitions%2Flogo_comp_0a1b2c3d-5555-4c3b-aef9-666677778888_1700000007.blob?generation=1700000008&alt=media`;
const slashOrgLogo = `${BUCKET}%2Forganisation%2Flogo_org_63_1700000009.jpg?generation=1700000010&alt=media`;

// A Squadi game against `opponent` (team number `id`), with that team's logo.
const sq = (n, opponent, id, logo = "") => ({ squadiId: 900000 + n, opponent, opponentRef: id ? `squadi:team:${id}` : undefined, opponentLogo: logo, dateISO: "2026-05-02" });
const dr = (n, opponent, extra = {}) => ({ squadiId: `dribl:g${n}`, opponent, opponentLogo: "", ...extra, dateISO: "2026-06-06" });

describe("sourceLogo — which logos from a draw may be shown", () => {
  it("shows a club's logo from Squadi's own storage, and a logo on Dribl's own site", () => {
    expect(sourceLogo(orgLogo(41))).toBe(orgLogo(41));
    expect(sourceLogo(teamLogo)).toBe(teamLogo);
    expect(sourceLogo(DRIBL_LOGO)).toBe(DRIBL_LOGO);
    expect(sourceLogo("https://dribl.com/logo.png")).toBe("https://dribl.com/logo.png");
  });
  it("never shows a competition's logo Squadi gives a tournament's teams, with or without a slash in front of its name", () => {
    expect(sourceLogo(compLogo)).toBeNull();
    expect(sourceLogo(slashCompLogo)).toBeNull();
    expect(sourceLogo(slashOrgLogo)).toBe(slashOrgLogo);
  });
  it("shows nothing from anywhere else, over plain http, or with a name, password or port", () => {
    for (const bad of [
      "https://storage.googleapis.com/download/storage/v1/b/someone-else.appspot.com/o/organisation%2Flogo_org_41_1.jpg",
      "https://storage.googleapis.com/squadi-prod.appspot.com/organisation/logo_org_41_1.jpg",
      "http://cdn.dribl.com/x.png", "https://evil-dribl.com/x.png", "https://cdn.dribl.com.example.com/x.png",
      "https://user:pass@cdn.dribl.com/x.png", "https://cdn.dribl.com:8443/x.png", "https://example.com/logo.png",
      "javascript:alert(1)", "data:image/png;base64,AAAA", "", null, 42, `https://cdn.dribl.com/${"a".repeat(400)}.png`
    ]) expect(sourceLogo(bad)).toBeNull();
  });
});

describe("oppCrestFor — the crest beside a game's opponent", () => {
  it("keeps the built-in crest for a club it has artwork for, whatever the game's own logo says or when the server sends none", () => {
    const built = { src: crestFor("Oxley United U9 Eagles"), drawn: false };
    expect(oppCrestFor("Oxley United U9 Eagles", orgLogo(41))).toEqual(built);
    expect(oppCrestFor("Oxley United U9 Eagles", orgLogo(41), null)).toEqual(built);
    expect(oppCrestFor("Oxley United U9 Eagles", orgLogo(41), "javascript:alert(1)")).toEqual(built);
  });
  it("but a logo the server sends for it stands over the built-in crest: the admin chose it from the club's website", () => {
    const chosen = "https://oxley.example/new-crest.png#fill=1.2";
    expect(oppCrestFor("Oxley United U9 Eagles", orgLogo(41), chosen)).toEqual({ src: chosen, drawn: true });
    // The size on the end is not part of the link: a logo as long as may be kept still shows with it.
    const longest = `https://oxley.example/${"a".repeat(400 - 26)}.png`;
    expect(longest).toHaveLength(400);
    expect(oppCrestFor("Oxley United U9 Eagles", null, longest + "#fill=1.25")).toEqual({ src: longest + "#fill=1.25", drawn: true });
    expect(oppCrestFor("Riverside FC U10", null, longest + "x#fill=1.25")).toEqual({ src: null, drawn: false });
  });
  it("otherwise takes the library's choice when the server sent one, a logo or none", () => {
    expect(oppCrestFor("Riverside FC U10", orgLogo(41), DRIBL_LOGO)).toEqual({ src: DRIBL_LOGO, drawn: true });
    expect(oppCrestFor("Riverside FC U10", orgLogo(41), null)).toEqual({ src: null, drawn: false });
    expect(oppCrestFor("Riverside FC U10", orgLogo(41), "javascript:alert(1)")).toEqual({ src: null, drawn: false });
  });
  it("and without one, the game's own logo if it may be shown", () => {
    expect(oppCrestFor("Riverside FC U10", orgLogo(41))).toEqual({ src: orgLogo(41), drawn: true });
    expect(oppCrestFor("Riverside FC U10", compLogo)).toEqual({ src: null, drawn: false });
    expect(oppCrestFor("Riverside FC U10", "")).toEqual({ src: null, drawn: false });
  });
});

// How much a logo the admin chose is enlarged in its circle, so one with a
// margin of its own fills the circle as a built-in crest does.
describe("the size of a chosen logo in its circle", () => {
  it("is kept to steps of 5%, from the logo's own size up to 160%", () => {
    expect([1, 1.02, 1.03, 1.25, 1.333, 1.6, 2, "1.4", "x", 0.8, -1, null, undefined, NaN, Infinity].map(cleanFill))
      .toEqual([1, 1, 1.05, 1.25, 1.35, 1.6, 1.6, 1.4, 1, 1, 1, 1, 1, 1, 1]);
  });
  it("rides on the logo's address after #fill=, which never goes with the request for the image, and only when enlarged", () => {
    const logo = "https://seaside.example/crest.png";
    expect([withFill(logo, 1.3), withFill(logo, 1), withFill(logo, 7), withFill(logo, "x"), withFill("", 1.3), withFill(undefined, 1.3)])
      .toEqual([logo + "#fill=1.3", logo, logo + "#fill=1.6", logo, "", ""]);
  });
  it("is drawn enlarged and cut back to the same circle, so it never spills past its place", () => {
    const logo = "https://seaside.example/crest.png";
    expect(crestFill(logo + "#fill=1.25")).toEqual({ transform: "scale(1.25)", clipPath: "circle(40.00% at 50% 50%)" });
    expect(crestFill(logo + "#fill=1.6")).toEqual({ transform: "scale(1.6)", clipPath: "circle(31.25% at 50% 50%)" });
    expect(crestFill(logo + "#fill=9")).toEqual({ transform: "scale(1.6)", clipPath: "circle(31.25% at 50% 50%)" });
    for (const src of [logo, logo + "#fill=1", logo + "?fill=1.3", logo + "#fill=1.3&x", logo + "#fill=1.333", logo + "#fill=", "", null, undefined]) {
      expect(crestFill(src)).toEqual({});
    }
  });
});

describe("what a draw's logos say", () => {
  it("reads the organisation a Squadi club logo belongs to, a competition's logo, and a team's own", () => {
    expect(squadiLogoKind(orgLogo(41))).toEqual({ kind: "club", club: "squadi:org:41", url: orgLogo(41) });
    expect(squadiLogoKind(orgLogo(41, 1800000000)).club).toBe("squadi:org:41"); // a new upload, the same club
    expect(squadiLogoKind(compLogo)).toEqual({ kind: "competition" });
    expect(squadiLogoKind(slashCompLogo)).toEqual({ kind: "competition" });
    expect(squadiLogoKind(slashOrgLogo)).toEqual({ kind: "club", club: "squadi:org:63", url: slashOrgLogo });
    expect(squadiLogoKind(teamLogo)).toEqual({ kind: "team", url: teamLogo });
    expect(squadiLogoKind(DRIBL_LOGO)).toBeNull();
    expect(squadiLogoKind("")).toBeNull();
  });
  it("tells the provider from a game's id, and keys the team by the provider's own id or its exact name", () => {
    expect([providerOf({ squadiId: 900001 }), providerOf({ squadiId: "900001" }), providerOf({ squadiId: "dribl:g1" }), providerOf({ squadiId: "majestri:1:2:3" }), providerOf({})]).toEqual(["squadi", "squadi", "dribl", "majestri", ""]);
    expect(teamRefOf(sq(1, "Riverside FC U10", 500001))).toBe("squadi:team:500001");
    expect(teamRefOf(sq(1, "  Riverside  FC U10 ", null))).toBe("squadi:name:riverside fc u10");
    expect(teamRefOf(dr(1, "Hilltop SC", { opponentRef: "dribl:team:Ab12" }))).toBe("dribl:team:Ab12");
    // A reference of the wrong provider is not taken.
    expect(teamRefOf(dr(1, "Hilltop SC", { opponentRef: "squadi:team:500001" }))).toBe("dribl:name:hilltop sc");
    expect(teamRefOf({ squadiId: "majestri:1:2:3", opponent: "Reds" })).toBe("");
    expect(sameName("St. George  U10")).not.toBe(sameName("St George U10"));
  });
});

describe("learnFromGames — Squadi", () => {
  it("files every team of one organisation under one club, and keeps its logo once, on the club", () => {
    const { lib, changed } = learnFromGames({}, [sq(1, "Riverside FC U10 Blue", 500001, orgLogo(41)), sq(2, "Riverside FC U10 Gold", 500002, orgLogo(41)), sq(3, "Riverside FC U10 Blue", 500001, orgLogo(41))], "squadi", { today: "2026-11-27" });
    expect(changed).toBe(true);
    expect(lib.clubs).toEqual({ "squadi:org:41": { names: ["Riverside FC U10 Blue", "Riverside FC U10 Gold"], logo: orgLogo(41), from: "Squadi", seen: "2026-11-27" } });
    expect(lib.teams["squadi:team:500001"]).toEqual({ name: "Riverside FC U10 Blue", club: "squadi:org:41", from: "Squadi", seen: "2026-11-27" });
    expect(lib.teams["squadi:team:500002"].club).toBe("squadi:org:41");
  });
  it("keeps a team's own logo on the team, and never keeps a competition's logo", () => {
    const { lib } = learnFromGames({}, [sq(1, "Hilltop Academy U10", 500003, teamLogo), sq(2, "Valley Wanderers U10", 500004, compLogo), sq(3, "Seaside FC U10", 500008, slashCompLogo)], "squadi");
    expect(lib.teams["squadi:team:500003"]).toMatchObject({ logo: teamLogo });
    expect(lib.teams["squadi:team:500004"]).not.toHaveProperty("logo");
    expect(lib.teams["squadi:team:500008"]).not.toHaveProperty("logo");
    expect(lib.teams["squadi:team:500004"]).not.toHaveProperty("club");
    expect(lib.clubs).toEqual({});
  });
  it("is a no-op the second time, and does not move the date a club was first seen", () => {
    const games = [sq(1, "Riverside FC U10 Blue", 500001, orgLogo(41))];
    const once = learnFromGames({}, games, "squadi", { today: "2026-11-01" }).lib;
    const again = learnFromGames(once, games, "squadi", { today: "2026-11-27" });
    expect(again.changed).toBe(false);
    expect(again.lib.clubs["squadi:org:41"].seen).toBe("2026-11-01");
  });
  it("takes a new upload of the same club's logo", () => {
    const once = learnFromGames({}, [sq(1, "Riverside FC U10 Blue", 500001, orgLogo(41))], "squadi").lib;
    const { lib, changed } = learnFromGames(once, [sq(1, "Riverside FC U10 Blue", 500001, orgLogo(41, 1800000000))], "squadi");
    expect(changed).toBe(true);
    expect(lib.clubs["squadi:org:41"].logo).toBe(orgLogo(41, 1800000000));
  });
  it("notes a team with a built-in crest too, so its other names are known, and never touches the admin's choices", () => {
    const start = { manual: { "squadi:org:41": { hidden: true } } };
    const { lib } = learnFromGames(start, [sq(1, "Lions FC U10 Blue", 500005, orgLogo(57)), sq(2, "Riverside FC U10 Blue", 500001, orgLogo(41))], "squadi");
    expect(lib.teams["squadi:team:500005"].club).toBe("squadi:org:57");
    expect(lib.manual).toEqual({ "squadi:org:41": { hidden: true } });
  });
  it("replaces a team first met by its name alone once its id is known", () => {
    const once = learnFromGames({}, [sq(1, "Riverside FC U10 Blue", null, orgLogo(41))], "squadi").lib;
    expect(Object.keys(once.teams)).toEqual(["squadi:name:riverside fc u10 blue"]);
    const { lib } = learnFromGames(once, [sq(1, "Riverside FC U10 Blue", 500001, orgLogo(41))], "squadi");
    expect(Object.keys(lib.teams)).toEqual(["squadi:team:500001"]);
  });
  it("keeps no logo the site may not show, and learns nothing from Majestri, byes or nameless games", () => {
    const { lib } = learnFromGames({}, [sq(1, "Riverside FC U10 Blue", 500001, orgLogo(41))], "squadi", { allowed: () => false });
    expect(lib.clubs).toEqual({});
    expect(lib.teams["squadi:team:500001"]).not.toHaveProperty("club");
    expect(learnFromGames({}, [{ squadiId: "majestri:1:2:3", opponent: "Reds" }], "majestri").changed).toBe(false);
    expect(learnFromGames({}, [{ squadiId: 900009, bye: true }, { squadiId: 900010, opponent: "  " }, null], "squadi").changed).toBe(false);
  });
});

describe("learnFromGames and learnDriblClubs — Dribl", () => {
  it("files a team under the club its game names, and tells the club's own logo from the team's", () => {
    const clubs = learnDriblClubs({}, [{ id: "C1", name: "Riverside FC", logo: DRIBL_LOGO }]).lib;
    const { lib } = learnFromGames(clubs, [
      dr(1, "Riverside FC U10", { opponentRef: "dribl:team:T1", opponentClubRef: "dribl:club:C1", opponentLogo: DRIBL_LOGO }),
      dr(2, "Riverside Academy U10", { opponentRef: "dribl:team:T2", opponentClubRef: "dribl:club:C1", opponentLogo: "https://cdn.dribl.com/teams/academy.png" })
    ], "dribl");
    expect(lib.teams["dribl:team:T1"]).toEqual(expect.objectContaining({ club: "dribl:club:C1" }));
    expect(lib.teams["dribl:team:T1"]).not.toHaveProperty("logo");
    expect(lib.teams["dribl:team:T2"]).toEqual(expect.objectContaining({ club: "dribl:club:C1", logo: "https://cdn.dribl.com/teams/academy.png" }));
    expect(lib.clubs["dribl:club:C1"].names).toEqual(["Riverside FC", "Riverside FC U10", "Riverside Academy U10"]);
  });
  it("links a team to a listed club only by the very same logo image, never by a similar name", () => {
    const teams = learnFromGames({}, [dr(1, "Hilltop SC U10", { opponentRef: "dribl:team:T3", opponentLogo: "https://cdn.dribl.com/hilltop.png" }), dr(2, "Riverside FC U10", { opponentRef: "dribl:team:T4", opponentLogo: "" })], "dribl").lib;
    const { lib } = learnDriblClubs(teams, [{ id: "C2", name: "Hilltop Soccer Club", logo: "https://cdn.dribl.com/hilltop.png" }, { id: "C3", name: "Riverside FC", logo: "https://cdn.dribl.com/riverside.png" }]);
    expect(lib.teams["dribl:team:T3"]).toEqual(expect.objectContaining({ club: "dribl:club:C2" }));
    expect(lib.teams["dribl:team:T3"]).not.toHaveProperty("logo");
    expect(lib.teams["dribl:team:T4"]).not.toHaveProperty("club"); // "Riverside FC U10" is not taken to be "Riverside FC"
  });
  it("settles nothing on a logo two listed clubs share, and lets a club a game named stand", () => {
    const teams = learnFromGames({}, [dr(1, "Hilltop SC U10", { opponentRef: "dribl:team:T3", opponentLogo: "https://cdn.dribl.com/shared.png" }), dr(2, "Valley U10", { opponentRef: "dribl:team:T5", opponentClubRef: "dribl:club:C9", opponentLogo: "https://cdn.dribl.com/valley.png" })], "dribl").lib;
    const { lib } = learnDriblClubs(teams, [{ id: "C2", name: "A", logo: "https://cdn.dribl.com/shared.png" }, { id: "C4", name: "B", logo: "https://cdn.dribl.com/shared.png" }, { id: "C5", name: "C", logo: "https://cdn.dribl.com/valley.png" }]);
    expect(lib.teams["dribl:team:T3"]).not.toHaveProperty("club");
    expect(lib.teams["dribl:team:T5"].club).toBe("dribl:club:C9");
  });
  it("keeps no logo from a host the site does not show, and skips club list entries without an id or name", () => {
    const { lib } = learnFromGames({}, [dr(1, "Hilltop SC U10", { opponentRef: "dribl:team:T3", opponentLogo: "https://images.example.com/hilltop.png" })], "dribl");
    expect(lib.teams["dribl:team:T3"]).not.toHaveProperty("logo");
    const listed = learnDriblClubs({}, [{ id: "bad id!", name: "X", logo: DRIBL_LOGO }, { id: "C6", name: "", logo: DRIBL_LOGO }, { id: "C7", name: "Seaside FC", logo: "https://images.example.com/s.png" }]).lib;
    expect(Object.keys(listed.clubs)).toEqual(["dribl:club:C7"]);
    expect(listed.clubs["dribl:club:C7"]).not.toHaveProperty("logo");
  });
});

describe("crestFromLibrary — what is shown beside a game's opponent", () => {
  const lib = cleanLibrary({
    clubs: { "squadi:org:41": { names: ["Riverside FC U10 Blue"], logo: orgLogo(41) }, "dribl:club:C1": { names: ["Hilltop SC"], logo: DRIBL_LOGO } },
    teams: {
      "squadi:team:500001": { name: "Riverside FC U10 Blue", club: "squadi:org:41" },
      "squadi:team:500003": { name: "Hilltop Academy U10", logo: teamLogo },
      "dribl:team:T1": { name: "Hilltop SC U10", club: "dribl:club:C1" },
      "squadi:name:valley wanderers u10": { name: "Valley Wanderers U10", club: "squadi:org:41" },
      "squadi:team:500007": { name: "Riverside Academy U10", club: "squadi:org:41", logo: teamLogo }
    }
  });
  it("leaves a club the built-in registry knows to its own crest", () => {
    expect(crestFromLibrary(lib, sq(1, "Lions FC U10 Blue", 500001, orgLogo(41)))).toBeUndefined();
  });
  it("gives an academy's own badge before its club's logo", () => {
    expect(crestFromLibrary(lib, sq(9, "Riverside Academy U10", 500007, orgLogo(41)))).toBe(teamLogo);
  });
  it("gives the team's own logo, else its club's, else the game's own", () => {
    expect(crestFromLibrary(lib, sq(1, "Hilltop Academy U10", 500003, compLogo))).toBe(teamLogo);
    // A tournament game: Squadi shows the competition's logo, the library knows the club.
    expect(crestFromLibrary(lib, sq(2, "Riverside FC U10 Blue", 500001, compLogo))).toBe(orgLogo(41));
    expect(crestFromLibrary(lib, dr(3, "Hilltop SC U10", { opponentRef: "dribl:team:T1" }))).toBe(DRIBL_LOGO);
    expect(crestFromLibrary(lib, sq(4, "Seaside FC U10", 500099, orgLogo(88)))).toBe(orgLogo(88));
  });
  it("finds an older game's team by its exact name on the same provider, never by a similar name or across providers", () => {
    expect(crestFromLibrary(lib, sq(5, "valley  wanderers U10", null, ""))).toBe(orgLogo(41));
    expect(crestFromLibrary(lib, sq(6, "Valley Wanderer U10", null, ""))).toBeNull();
    expect(crestFromLibrary(lib, dr(7, "Valley Wanderers U10"))).toBeNull();
  });
  it("shows nothing for a competition's logo alone, a team it knows nothing of, or a manual game", () => {
    expect(crestFromLibrary(lib, sq(8, "Seaside FC U10", 500098, compLogo))).toBeNull();
    expect(crestFromLibrary(lib, { opponent: "Seaside FC", opponentLogo: "" })).toBeNull();
  });
  it("shows nothing for what the admin hid, on the team or on its club", () => {
    expect(crestFromLibrary(setManual(lib, "squadi:org:41", { hidden: true }), sq(2, "Riverside FC U10 Blue", 500001, orgLogo(41)))).toBeNull();
    expect(crestFromLibrary(setManual(lib, "squadi:team:500003", { hidden: true }), sq(1, "Hilltop Academy U10", 500003, teamLogo))).toBeNull();
    expect(crestFromLibrary(setManual(setManual(lib, "squadi:org:41", { hidden: true }), "squadi:org:41", { hidden: false }), sq(2, "Riverside FC U10 Blue", 500001, compLogo))).toBe(orgLogo(41));
  });
  it("only ever gives a logo the site may show", () => {
    expect(crestFromLibrary(lib, sq(2, "Riverside FC U10 Blue", 500001, compLogo), { allowed: () => false })).toBeNull();
  });
});

describe("logoSummary — the admin's card and the report", () => {
  it("counts the opposition by what is shown, the clubs found, and the duplicate clubs avoided", () => {
    const games = [
      sq(1, "Lions FC U10 Blue", 500005, orgLogo(57)), sq(2, "Lions FC U10 White", 500006, orgLogo(57)), sq(3, "Lions FC U10 Blue", 500005, orgLogo(57)),
      sq(4, "Riverside FC U10 Blue", 500001, orgLogo(41)), sq(5, "Riverside FC U10 Gold", 500002, orgLogo(41)),
      sq(6, "Valley Wanderers U10", 500004, compLogo),
      dr(7, "Hilltop SC U10", { opponentRef: "dribl:team:T1", opponentLogo: DRIBL_LOGO }),
      { squadiId: "majestri:1:2:3", opponent: "Reds" }, { squadiId: 900020, bye: true }
    ];
    let lib = learnFromGames({}, games, "squadi").lib;
    lib = learnFromGames(lib, games.filter((g) => providerOf(g) === "dribl"), "dribl").lib;
    const { counts, opponents } = logoSummary(lib, games);
    expect(counts).toEqual({ opponents: 6, builtIn: 2, added: 0, found: 3, missing: 1, hidden: 0, newClubs: 1, newLogos: 2, duplicatesAvoided: 2 });
    expect(opponents.map((o) => [o.name, o.shown, o.kind || ""])).toEqual([
      ["Hilltop SC U10", "found", "team"], ["Lions FC U10 Blue", "built-in", ""], ["Lions FC U10 White", "built-in", ""],
      ["Riverside FC U10 Blue", "found", "club"], ["Riverside FC U10 Gold", "found", "club"], ["Valley Wanderers U10", "missing", ""]
    ]);
    const hidden = logoSummary(setManual(lib, "squadi:org:41", { hidden: true }), games).counts;
    expect([hidden.found, hidden.hidden]).toEqual([1, 2]);
  });
});

describe("cleanLibrary and setManual", () => {
  it("drops a competition's logo an older document holds as a team's or a club's", () => {
    const lib = cleanLibrary({ teams: { "squadi:team:1": { name: "A", logo: slashCompLogo } }, clubs: { "squadi:org:41": { names: ["A"], logo: compLogo } } });
    expect(lib.teams["squadi:team:1"]).not.toHaveProperty("logo");
    expect(lib.clubs["squadi:org:41"]).not.toHaveProperty("logo");
    expect(crestFromLibrary(lib, sq(1, "A", 1, slashCompLogo))).toBeNull();
  });
  it("drops anything not in the library's shape, so a bad document never breaks a read", () => {
    expect(cleanLibrary(null)).toEqual({ clubs: {}, teams: {}, manual: {}, named: {} });
    expect(cleanLibrary({
      clubs: { "squadi:org:41": { names: ["A", "A", 5], logo: "http://x" }, "nope": {}, "squadi:team:1": { names: [] } },
      teams: { "squadi:team:1": { name: "A", club: "dribl:team:2", logo: "https://cdn.dribl.com/a.png" }, "squadi:org:9": { name: "B" } },
      manual: { "squadi:org:41": { hidden: true }, "squadi:org:42": { hidden: "yes" }, "x": { hidden: true } }
    })).toEqual({
      clubs: { "squadi:org:41": { names: ["A"], from: "", seen: "" } },
      teams: { "squadi:team:1": { name: "A", logo: "https://cdn.dribl.com/a.png", from: "", seen: "" } },
      manual: { "squadi:org:41": { hidden: true } },
      named: {}
    });
  });
  it("records and clears the admin's choice, for a well-formed reference only", () => {
    expect(setManual({}, "squadi:org:41", { hidden: true }).manual).toEqual({ "squadi:org:41": { hidden: true } });
    expect(setManual({ manual: { "squadi:org:41": { hidden: true } } }, "squadi:org:41", { hidden: false }).manual).toEqual({});
    expect(setManual({}, "not a ref", { hidden: true }).manual).toEqual({});
    expect([isRef("squadi:team:12"), isRef("dribl:club:Ab_1-2"), isRef("squadi:name:riverside fc"), isRef("dribl:club:has space"), isRef("other:team:1")]).toEqual([true, true, true, false, false]);
  });
});

describe("clubs the admin adds from their own websites — held for the club", () => {
  const SITE_LOGO = "https://valleywanderers.example/img/crest.png";
  const add = (lib, name, logo = SITE_LOGO, site = "https://valleywanderers.example/") => setNamedClub(lib, { name, logo, site, today: "2026-11-28" });

  it("knows a club by every word of its name, letter case and punctuation aside, and never by generic words alone", () => {
    expect(clubWords("Valley Wanderers FC")).toEqual(["valley", "wanderers", "fc"]);
    expect(clubWords("Valley-Wanderers F.C.")).toEqual(["valley", "wanderers", "f", "c"]);
    expect(namedKey("Valley Wanderers FC")).toBe("valley-wanderers-fc");
    for (const generic of ["FC", "Football Club", "United FC", "the club", "", "  "]) expect(namedKey(generic)).toBe("");
    expect(namedCovers(["valley", "wanderers", "fc"], "Valley Wanderers FC Academy U12")).toBe(true);
    expect(namedCovers(["seaside", "fc"], "Seaside Rovers U10")).toBe(false); // every word counts, FC too
    expect(namedCovers(["valley", "wanderers"], "Valley United U10")).toBe(false);
    expect(namedCovers(["valley", "wanderers"], "Valleywanderers U10")).toBe(false); // whole words only
    expect(namedCovers([], "Valley Wanderers")).toBe(false);
  });

  it("guesses the club from a team's name: the words before its age group or division", () => {
    expect(guessClubName("Valley Wanderers FC NPL U11 Gold")).toBe("Valley Wanderers FC");
    expect(guessClubName("VWFC Div1 U12 Gold")).toBe("VWFC");
    expect(guessClubName("Seaside FC U9 Reds")).toBe("Seaside FC");
    expect(guessClubName("Ridge FC Under 12 Div 3")).toBe("Ridge FC");
    expect(guessClubName("Coastal Strikers 1 U12")).toBe("Coastal Strikers");
    expect(guessClubName("U10 Rovers")).toBe("U10 Rovers"); // never down to nothing
    expect(guessClubName("Riverside")).toBe("Riverside");
  });

  it("shows an added club's logo for every team whose name has all its words, before anything found and over a hidden one", () => {
    let lib = cleanLibrary({ teams: { "squadi:team:5": { name: "Valley Wanderers FC U11", logo: orgLogo(41), club: "squadi:org:41" } }, clubs: { "squadi:org:41": { names: ["Valley Wanderers FC U11"], logo: orgLogo(41) } }, manual: { "squadi:team:6": { hidden: true } } });
    lib = add(lib, "Valley Wanderers").lib;
    expect(crestFromLibrary(lib, sq(1, "Valley Wanderers FC Academy U12", 4, compLogo))).toBe(SITE_LOGO);
    expect(crestFromLibrary(lib, sq(2, "Valley Wanderers FC U11", 5, orgLogo(41)))).toBe(SITE_LOGO);
    expect(crestFromLibrary(lib, sq(3, "Valley Wanderers U12 Girls", 6))).toBe(SITE_LOGO);
    expect(crestFromLibrary(lib, dr(4, "Valley Wanderers FC U10"))).toBe(SITE_LOGO);
    expect(crestFromLibrary(lib, sq(5, "Valley United U10", 7))).toBeNull();
    // The hidden team (squadi:team:6) shows the club's added logo: that was chosen.
    // A club with a built-in crest keeps it until the admin links the club to
    // its website: then the logo chosen there comes first, enlarged as chosen.
    expect(crestFromLibrary(lib, sq(6, "Oxley United U9 Eagles", 8))).toBeUndefined();
    lib = setNamedClub(lib, { name: "Oxley United", logo: "https://oxley.example/crest.png", fill: 1.3 }).lib;
    expect(crestFromLibrary(lib, sq(6, "Oxley United U9 Eagles", 8))).toBe("https://oxley.example/crest.png#fill=1.3");
  });

  it("gives a team the added club with the most of its words", () => {
    let lib = add(cleanLibrary({}), "Seaside", "https://seaside.example/all.png").lib;
    lib = add(lib, "Seaside Reds", "https://seaside.example/reds.png").lib;
    expect(namedClubFor(lib, "Seaside Reds U10").key).toBe("seaside-reds");
    expect(namedClubFor(lib, "Seaside Blues U10").key).toBe("seaside");
    expect(namedClubFor(lib, "Ridge FC")).toBeNull();
    expect(namedClubFor({}, "Seaside")).toBeNull();
  });

  it("counts the teams each added club covers, and shows them as added rather than missing or found", () => {
    const lib = add(cleanLibrary({ clubs: { "squadi:org:41": { names: ["Valley Wanderers FC U11"], logo: orgLogo(41) } }, teams: { "squadi:team:5": { name: "Valley Wanderers FC U11", club: "squadi:org:41" } } }), "Valley Wanderers FC").lib;
    // "Valley Wanderers FC" covers its two FC teams, not a team named without FC.
    const { opponents, counts, named } = logoSummary(lib, [
      sq(1, "Valley Wanderers FC Academy U12", 4, compLogo), sq(2, "Valley Wanderers FC U11", 5, orgLogo(41)), sq(3, "Seaside FC U10", 9), sq(4, "Oxley United U9 Eagles", 8)
    ]);
    expect(opponents.map((o) => [o.name, o.shown, o.named || ""])).toEqual([
      ["Oxley United U9 Eagles", "built-in", ""], ["Seaside FC U10", "missing", ""],
      ["Valley Wanderers FC Academy U12", "added", "valley-wanderers-fc"], ["Valley Wanderers FC U11", "added", "valley-wanderers-fc"]
    ]);
    expect(counts).toMatchObject({ opponents: 4, builtIn: 1, added: 2, found: 0, missing: 1 });
    expect(named).toEqual([{ key: "valley-wanderers-fc", name: "Valley Wanderers FC", logo: SITE_LOGO, site: "https://valleywanderers.example/", fill: 1, teams: 2 }]);
  });

  it("keeps a club only with a name and an https logo; the same words are the same club; one can be taken out", () => {
    expect(setNamedClub({}, { name: "  ", logo: SITE_LOGO }).error).toBe("Give the club's name.");
    expect(setNamedClub({}, { name: "FC", logo: SITE_LOGO }).error).toBe("Give the club's name.");
    for (const logo of ["", "http://valleywanderers.example/a.png", "https://u:p@valleywanderers.example/a.png", "https://valleywanderers.example:81/a.png", "data:image/png;base64,AA", "https://x.example/" + "a".repeat(400)]) {
      expect(setNamedClub({}, { name: "Valley Wanderers", logo }).error).toBe("Pick a logo first.");
    }
    let r = setNamedClub({}, { name: "Valley Wanderers FC", logo: SITE_LOGO, site: "http://not-https.example/", today: "2026-11-28" });
    expect(r.key).toBe("valley-wanderers-fc");
    expect(r.lib.named["valley-wanderers-fc"]).toEqual({ name: "Valley Wanderers FC", logo: SITE_LOGO, site: "", at: "2026-11-28" });
    r = setNamedClub(r.lib, { name: "valley wanderers fc", logo: "https://valleywanderers.example/new.png" });
    expect(Object.keys(r.lib.named)).toEqual(["valley-wanderers-fc"]);
    expect(r.lib.named["valley-wanderers-fc"].logo).toBe("https://valleywanderers.example/new.png");
    expect(dropNamedClub(r.lib, "valley-wanderers-fc").named).toEqual({});
    let many = cleanLibrary({});
    for (let i = 0; i < NAMED_MAX; i++) many.named[`club${i}`] = { name: `Club${i}`, logo: SITE_LOGO, site: "", at: "" };
    expect(setNamedClub(many, { name: "One More", logo: SITE_LOGO }).error).toMatch(/as many added clubs as it can/);
  });

  it("drops an added club a stored document holds out of shape", () => {
    const lib = cleanLibrary({ named: {
      "valley-wanderers-fc": { name: "Valley Wanderers FC", logo: SITE_LOGO, site: "https://valleywanderers.example/", at: "2026-11-28" },
      "wrong-key": { name: "Seaside FC", logo: SITE_LOGO },
      "ridge": { name: "Ridge FC", logo: "http://ridge.example/a.png" },
      "coastal": "Coastal FC"
    } });
    expect(lib.named).toEqual({ "valley-wanderers-fc": { name: "Valley Wanderers FC", logo: SITE_LOGO, site: "https://valleywanderers.example/", at: "2026-11-28" } });
  });
});
