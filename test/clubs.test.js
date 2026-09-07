import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { CLUBS, OUR_CREST, clubKeyFor, clubByKey, crestFor } from "@/lib/clubs";

// The crest registry replaces every hotlinked club logo. Every key must resolve
// to a real 512 px file under public/crests, and Squadi's team names must map
// to the right club (most specific alias wins).

const PUBLIC = path.resolve(__dirname, "..", "public", "crests");

describe("registry integrity", () => {
  it("has 19 keys, all local, all backed by a file in public/crests", () => {
    expect(CLUBS).toHaveLength(19);
    for (const c of CLUBS) {
      expect(c.crest.startsWith("/crests/")).toBe(true);
      expect(c.crest).not.toMatch(/^https?:/);
      const file = path.join(PUBLIC, c.crest.replace("/crests/", ""));
      expect(fs.existsSync(file), `${c.key} -> ${c.crest}`).toBe(true);
    }
    expect(new Set(CLUBS.map((c) => c.key)).size).toBe(19);
    expect(OUR_CREST).toBe("/crests/olympic-fc.png");
    expect(fs.existsSync(path.join(PUBLIC, "olympic-fc.png"))).toBe(true);
  });

  it("every PNG in public/crests is 512 x 512", () => {
    for (const f of fs.readdirSync(PUBLIC).filter((f) => f.endsWith(".png"))) {
      const buf = fs.readFileSync(path.join(PUBLIC, f));
      // PNG IHDR: width at bytes 16-19, height at 20-23 (big-endian).
      expect([buf.readUInt32BE(16), buf.readUInt32BE(20)], f).toEqual([512, 512]);
    }
  });
});

describe("clubKeyFor — Squadi team names", () => {
  it.each([
    ["Springfield United U8 Snipers K1", "springfield-united"],
    ["Springfield United U8 Strikers K2", "springfield-strikers"],
    ["MFC U8 Kangaroos", "mfc-kangaroos"],
    ["Moggill FC U8", "mfc-kangaroos"],
    ["Lions FC U8 Orange Kangaroos", "lions-orange"],
    ["Lions FC U8 Blue Kangaroos", "lions-blue"],
    ["Lions FC U8 Kangaroos", "lions-fc"],
    ["Ripley Valley U8", "ripley-valley"],
    ["Oxley United FC U8 Eagles", "oxley-united"],
    ["Olympic FC U8 Kangaroos RED", "olympic-red"],
    ["Olympic FC U8 Kangaroos White", "olympic-fc"],
    ["St George Willawong FC U8", "st-george"],
    ["Eastern Suburbs FC U8 Tigers", "eastern-suburbs"],
    ["Moreton City Excelsior U8", "moreton-city-excelsior"],
    ["Gold Coast United FC U8", "gold-coast-united"],
    ["Gold Coast Knights U8", "gold-coast-knights"],
    ["Rochedale Rovers U8 K1", "rochedale-rovers"],
    ["Logan Lightning FC U8", "logan-lightning"],
    ["Brisbane City FC U8", "brisbane-city"],
    ["Wynnum Wolves FC U8", "wynnum-wolves"]
  ])("%s -> %s", (name, key) => {
    expect(clubKeyFor(name)).toBe(key);
  });

  it("returns null for unknown clubs and junk", () => {
    expect(clubKeyFor("Wests")).toBeNull();
    expect(clubKeyFor("")).toBeNull();
    expect(clubKeyFor(null)).toBeNull();
    expect(clubKeyFor("Bye")).toBeNull();
  });

  it("is case and punctuation insensitive", () => {
    expect(clubKeyFor("OXLEY UNITED")).toBe("oxley-united");
    expect(clubKeyFor("St. George")).toBe("st-george");
  });
});

describe("crestFor / clubByKey", () => {
  it("gives the shared file for aliases and null for unknowns", () => {
    expect(crestFor("Lions FC U8 Blue Kangaroos")).toBe("/crests/lions-fc.png");
    expect(crestFor("Springfield United U8 Strikers K2")).toBe("/crests/springfield-united.png");
    expect(crestFor("Olympic FC U8 Kangaroos RED")).toBe("/crests/olympic-fc.png");
    expect(crestFor("Wests")).toBeNull();
    expect(clubByKey("nope")).toBeNull();
    expect(clubByKey("lions-fc").name).toBe("Lions FC");
  });
});
