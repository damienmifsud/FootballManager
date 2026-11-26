import { describe, it, expect } from "vitest";
import { shortTeamNames, ownRoles, personPills, personSearchText, personInitials, filterPeople, OVERRIDE_LABELS } from "@/lib/people";

// Pure helpers behind the people page: short team names for pills, a person's
// pills, and what the search box matches.

const coachHat = (over = {}) => ({ role: "coach", playerIds: [], playerNames: [], ...over });
const parentHat = (...names) => ({ role: "parent", playerIds: names.map((_, i) => "p" + i), playerNames: names });
const team = (slug, name, hats) => ({ teamSlug: slug, teamName: name, hats, mine: hats.some((h) => !h.club) });
const TEAMS = [{ slug: "u9", name: "Riverside FC U9 Reds" }, { slug: "u11", name: "Riverside FC U11 Blues" }, { slug: "ff", name: "Fast Fives" }];
const sam = {
  email: "sam@example.com", name: "Sam Kelly", superAdmin: false, clubAdmin: null, overrides: {},
  teams: [team("u9", "Riverside FC U9 Reds", [coachHat({ staffRole: "Assistant coach" }), parentHat("Leo K.", "Ana K.")]), team("u11", "Riverside FC U11 Blues", [parentHat("Mia K.")])]
};

describe("shortTeamNames", () => {
  it("drops the club's name when most teams start with it", () => {
    const short = shortTeamNames(["Riverside FC U9 Reds", "Riverside FC U11 Blues", "Riverside FC U13 Golds"]);
    expect(["Riverside FC U9 Reds", "Riverside FC U11 Blues", "Riverside FC U13 Golds"].map(short)).toEqual(["U9 Reds", "U11 Blues", "U13 Golds"]);
  });

  it("leaves alone a team that does not start that way", () => {
    const short = shortTeamNames(["Riverside FC U9 Reds", "Riverside FC U11 Blues", "Fast Fives"]);
    expect(short("Riverside FC U9 Reds")).toBe("U9 Reds");
    expect(short("Fast Fives")).toBe("Fast Fives");
  });

  it("never cuts a name down to a single word", () => {
    const short = shortTeamNames(["Riverside FC U9 Reds", "Riverside FC U11 Blues", "Riverside FC Seniors"]);
    expect(short("Riverside FC Seniors")).toBe("Riverside FC Seniors");
    expect(short("Riverside FC U9 Reds")).toBe("U9 Reds");
    // An age group shared by every team is not a club name to drop.
    const ages = shortTeamNames(["U9 Reds", "U9 Blues", "U9 Golds"]);
    expect(ages("U9 Reds")).toBe("U9 Reds");
  });

  it("needs more than half the teams, and at least two, to agree", () => {
    const short = shortTeamNames(["Riverside FC U9 Reds", "Northside United U9", "Hill End Rovers U9", "Riverside FC U11 Blues"]);
    expect(short("Riverside FC U9 Reds")).toBe("Riverside FC U9 Reds"); // two of four is not most
    expect(shortTeamNames(["Riverside FC U9 Reds"])("Riverside FC U9 Reds")).toBe("Riverside FC U9 Reds");
  });

  it("matches the prefix whatever its capitals, and takes the longest one shared", () => {
    const short = shortTeamNames(["Riverside FC u9 Reds", "RIVERSIDE fc U11 Blues", "Riverside FC U13 Golds"]);
    expect(short("RIVERSIDE fc U11 Blues")).toBe("U11 Blues");
  });

  it("copes with nothing, blanks and names it was not given", () => {
    expect(shortTeamNames([])("Anything")).toBe("Anything");
    expect(shortTeamNames(undefined)("")).toBe("");
    const short = shortTeamNames(["Riverside FC U9 Reds", "", null, "Riverside FC U11 Blues"]);
    expect(short("Some Other Team")).toBe("Some Other Team");
  });
});

describe("personPills", () => {
  const short = shortTeamNames(TEAMS.map((t) => t.name));

  it("one pill per role per team, staff and family told apart", () => {
    expect(personPills(sam, TEAMS, short)).toEqual([
      { text: "Assistant coach · U9 Reds", tone: "staff" },
      { text: "Parent of Leo & Ana · U9 Reds", tone: "family" },
      { text: "Parent of Mia · U11 Blues", tone: "family" }
    ]);
  });

  it("club roles come first and only once, however many teams they open", () => {
    const owner = {
      email: "owner@example.com", name: "", superAdmin: true, clubAdmin: null, overrides: {},
      teams: [team("u9", "Riverside FC U9 Reds", [coachHat({ admin: true, club: true }), parentHat("Theo H.")]), team("u11", "Riverside FC U11 Blues", [coachHat({ admin: true, club: true })])]
    };
    expect(personPills(owner, TEAMS, short)).toEqual([{ text: "Super admin", tone: "club" }, { text: "Parent of Theo · U9 Reds", tone: "family" }]);
    const td = { email: "td@example.com", name: "", superAdmin: false, clubAdmin: "stored", overrides: {}, teams: TEAMS.map((t) => team(t.slug, t.name, [{ role: "viewer", playerIds: [], playerNames: [], clubAdmin: true, club: true }])) };
    expect(personPills(td, TEAMS, short)).toEqual([{ text: "Club admin", tone: "club" }]);
  });

  it("a team they are shut out of is named; a role given on purpose reads as that role", () => {
    const p = { email: "x@example.com", name: "", superAdmin: false, clubAdmin: null, overrides: { ff: "blocked", u9: "viewer" }, teams: [team("u9", "Riverside FC U9 Reds", [{ role: "viewer", playerIds: [], playerNames: [] }])] };
    expect(personPills(p, TEAMS, short)).toEqual([{ text: "View only · U9 Reds", tone: "plain" }, { text: "No access · Fast Fives", tone: "blocked" }]);
    // Without the club's team list the slug stands in rather than nothing.
    expect(personPills({ ...p, overrides: { zz: "blocked" }, teams: [] })).toEqual([{ text: "No access · zz", tone: "blocked" }]);
  });

  it("someone signed in as a player reads Player, in the family tint, and is found by that word", () => {
    const playerHat = { role: "parent", playerIds: ["p7"], playerNames: ["Jo P."], selfIds: ["p7"] };
    const both = { role: "parent", playerIds: ["p7", "p8"], playerNames: ["Jo P.", "Leo P."], selfIds: ["p7"] };
    const jo = { email: "jo@example.com", name: "Jo Park", superAdmin: false, clubAdmin: null, overrides: {}, teams: [team("ff", "Fast Fives", [playerHat])] };
    expect(personPills(jo, TEAMS)).toEqual([{ text: "Player · Fast Fives", tone: "family" }]);
    expect(personPills({ ...jo, teams: [team("ff", "Fast Fives", [coachHat({ staffRole: "Manager" }), both])] }, TEAMS)).toEqual([
      { text: "Manager · Fast Fives", tone: "staff" },
      { text: "Player and parent of Leo · Fast Fives", tone: "family" }
    ]);
    expect(filterPeople([sam, jo], "player")).toEqual([jo]);
    expect(filterPeople([sam, jo], "fast fives")).toEqual([jo]);
  });

  it("ownRoles leaves out club-level access", () => {
    expect(ownRoles(team("u9", "T", [coachHat({ admin: true, club: true }), parentHat("Leo")])).map((h) => h.role)).toEqual(["parent"]);
    expect(ownRoles(undefined)).toEqual([]);
  });

  it("names every override the role menu offers", () => {
    expect(OVERRIDE_LABELS).toEqual({ coach: "Coach", parent: "Parent or player only", viewer: "View only", blocked: "No access" });
  });
});

describe("search", () => {
  const rita = { email: "rita@example.com", name: "Rita van Dyk", superAdmin: false, clubAdmin: "stored", overrides: {}, teams: [team("u11", "Riverside FC U11 Blues", [coachHat({ staffRole: "Manager" })])] };
  const nameless = { email: "second@example.com", name: "", superAdmin: true, clubAdmin: null, overrides: {}, teams: [] };
  const people = [sam, rita, nameless];

  it("matches a name, an email, a role or a team, whatever the capitals", () => {
    expect(filterPeople(people, "kelly")).toEqual([sam]);
    expect(filterPeople(people, "RITA@")).toEqual([rita]);
    expect(filterPeople(people, "manager")).toEqual([rita]);
    expect(filterPeople(people, "u11")).toEqual([sam, rita]);
    expect(filterPeople(people, "club admin")).toEqual([rita]);
    expect(filterPeople(people, "super")).toEqual([nameless]);
    expect(filterPeople(people, "parent of mia")).toEqual([sam]);
  });

  it("every word typed has to match, in any order", () => {
    expect(filterPeople(people, "blues sam")).toEqual([sam]);
    expect(filterPeople(people, "blues nobody")).toEqual([]);
  });

  it("an empty search is everyone", () => {
    expect(filterPeople(people, "")).toBe(people);
    expect(filterPeople(people, "   ")).toBe(people);
    expect(filterPeople(undefined, "x")).toEqual([]);
  });

  it("a team someone can only open because they run the club is not one of theirs to be found by", () => {
    const owner = { email: "owner@example.com", name: "", superAdmin: true, clubAdmin: null, overrides: {}, teams: [
      team("u9", "Riverside FC U9 Reds", [coachHat({ admin: true, club: true })]),
      team("u11", "Riverside FC U11 Blues", [coachHat({ admin: true, club: true }), parentHat("Theo H.")])
    ] };
    expect(personSearchText(owner)).toBe("owner@example.com super admin riverside fc u11 blues parent of theo");
    expect(filterPeople([owner, sam], "reds")).toEqual([sam]);
    expect(filterPeople([owner, sam], "blues")).toEqual([owner, sam]);
  });
});

describe("personInitials", () => {
  it("first and last name; two letters of a single name; the email when there is no name", () => {
    expect(personInitials({ name: "Sam Kelly", email: "x@example.com" })).toBe("SK");
    expect(personInitials({ name: "Rita van Dyk", email: "x@example.com" })).toBe("RD");
    expect(personInitials({ name: "Pat", email: "x@example.com" })).toBe("PA");
    expect(personInitials({ name: "", email: "jo.smith@example.com" })).toBe("JO");
    expect(personInitials({ name: "", email: "" })).toBe("?");
  });
});
