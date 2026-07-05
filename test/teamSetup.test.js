import { describe, it, expect } from "vitest";
import { DEFAULT_FEATURES, teamFeatures, sanitizeFeatures, sanitizeTrainingSessions, sanitizeStaff, sanitizeLogo } from "@/lib/teamSetup";

describe("teamFeatures", () => {
  it("falls back to the pre-flag behaviour: fruit/gk/focus on, jersey off", () => {
    expect(teamFeatures(undefined)).toEqual({ fruitDuty: true, jerseyDuty: false, gkDuty: true, focus: true });
    expect(teamFeatures({})).toEqual(DEFAULT_FEATURES);
  });

  it("merges saved flags over the defaults", () => {
    expect(teamFeatures({ features: { jerseyDuty: true, focus: false } }))
      .toEqual({ fruitDuty: true, jerseyDuty: true, gkDuty: true, focus: false });
  });
});

describe("sanitizeFeatures", () => {
  it("coerces to booleans and drops unknown keys", () => {
    const out = sanitizeFeatures({ fruitDuty: 0, jerseyDuty: "yes", hack: true });
    expect(out).toEqual({ fruitDuty: false, jerseyDuty: true, gkDuty: true, focus: true });
    expect(out).not.toHaveProperty("hack");
  });

  it("returns defaults for junk input", () => {
    expect(sanitizeFeatures(null)).toEqual(DEFAULT_FEATURES);
    expect(sanitizeFeatures("junk")).toEqual(DEFAULT_FEATURES);
  });
});

describe("sanitizeStaff", () => {
  it("keeps named rows with cleaned mobiles/emails, drops the rest", () => {
    const out = sanitizeStaff([
      { role: "Head coach", name: " Byron ", mobile: "0400 111 222", email: "Byron@Club.com" },
      { role: "Manager", name: "", mobile: "0400" },
      { name: "NoRole", email: "not-an-email" },
      null
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ role: "Head coach", name: "Byron", mobile: "0400111222", email: "byron@club.com", photo: "" });
    expect(out[1]).toMatchObject({ role: "Coach", name: "NoRole", email: "" });
    expect(sanitizeStaff("junk")).toEqual([]);
  });
});

describe("sanitizeLogo", () => {
  it("accepts only reasonably-sized image data URLs", () => {
    expect(sanitizeLogo("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
    expect(sanitizeLogo("https://evil.example/logo.png")).toBe("");
    expect(sanitizeLogo("data:text/html;base64,AAA")).toBe("");
    expect(sanitizeLogo("data:image/png;base64," + "A".repeat(400000))).toBe("");
  });
});

describe("sanitizeTrainingSessions", () => {
  it("builds weekly dashboard sessions from wizard rows", () => {
    const out = sanitizeTrainingSessions([
      { weekday: 2, time: "17:00", endTime: "18:00", location: "Perry Park" },
      { weekday: "4", time: "16:30", location: "" }
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: "Training", kind: "training", recur: "weekly", weekday: 2, time: "17:00", endTime: "18:00", location: "Perry Park" });
    expect(out[0].id).toBeTruthy();
    expect(out[1]).toMatchObject({ weekday: 4, time: "16:30" });
    expect(out[1]).not.toHaveProperty("endTime"); // omitted, dashboard defaults apply
  });

  it("drops rows with bad weekdays or times, keeps custom titles, caps the list", () => {
    const out = sanitizeTrainingSessions([
      { weekday: 7, time: "17:00" },          // bad weekday
      { weekday: 2, time: "25:99" },           // bad time
      { weekday: 2, time: "17:00", title: "Goalkeeper clinic" },
      null
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Goalkeeper clinic");
    expect(sanitizeTrainingSessions(Array.from({ length: 20 }, () => ({ weekday: 2, time: "17:00" })))).toHaveLength(7);
    expect(sanitizeTrainingSessions("junk")).toEqual([]);
  });
});
