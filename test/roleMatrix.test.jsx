// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ROLES, MARKS, ROLE_MATRIX, ROLE_MATRIX_NOTES } from "@/lib/roleMatrix";
import RoleMatrix from "@/components/RoleMatrix";

// The "who can do what" table is documentation the app renders, so it is
// checked for shape and for the few facts the access model guarantees.

afterEach(cleanup);

const allRows = ROLE_MATRIX.flatMap((g) => g.rows.map((r) => ({ ...r, group: g.group })));
const marks = Object.keys(MARKS);
const byFeature = (f) => allRows.find((r) => r.feature === f);

describe("lib/roleMatrix — shape", () => {
  it("every row has a mark for every role, and every mark is a known one", () => {
    expect(allRows.length).toBeGreaterThan(15);
    for (const row of allRows) {
      for (const role of ROLES) {
        expect(marks, `${row.feature} / ${role.key}`).toContain(row[role.key]);
      }
      expect(row.feature.length).toBeGreaterThan(3);
    }
  });

  it("features are unique and grouped See / Do / Club", () => {
    expect(new Set(allRows.map((r) => r.feature)).size).toBe(allRows.length);
    expect(ROLE_MATRIX.map((g) => g.group)).toEqual(["See", "Do", "Club"]);
    expect(ROLE_MATRIX_NOTES.length).toBeGreaterThan(2);
  });
});

describe("lib/roleMatrix — facts the code enforces", () => {

  it("a super admin can do everything; club features need account mode and are closed to coaches and parents", () => {
    expect(allRows.every((r) => ["yes", "any"].includes(r.admin))).toBe(true);
    for (const r of allRows.filter((r) => r.group === "Club")) {
      expect([r.coach, r.parent]).toEqual(["no", "no"]);
      expect(r.code).toBe("na"); // needs account mode
    }
    // Club admins may run the team wizard but never touch access control.
    expect(byFeature("Open /admin").club).toBe("yes");
    expect(byFeature("Create and edit teams (the wizard)").club).toBe("yes");
    expect(byFeature("Add or remove club admins").club).toBe("no");
    expect(byFeature("Per-person per-team overrides (coach, parent, viewer, blocked)").club).toBe("no");
    expect(byFeature("View as any user (read only)").club).toBe("no");
  });

  it("a club admin reads but never writes team data", () => {
    const doRows = allRows.filter((r) => r.group === "Do" && !/Switch team/.test(r.feature));
    expect(doRows.every((r) => r.club === "no")).toBe(true);
    expect(byFeature("Player ratings and coach notes").club).toBe("no");
    expect(byFeature("Parents' contact details and family PINs").club).toBe("no");
  });

  it("a parent replies only for their own children and sees only their own family's contacts", () => {
    expect(byFeature("Reply In or Out for games and training").parent).toBe("own");
    // Duties (S7): coaches assign and clear everything; parents claim fruit or
    // jersey duty for their own family; club admins read only.
    expect(byFeature("Duties: fruit, jerseys and the goalkeeper")).toMatchObject({ coach: "yes", parent: "own", club: "no", code: "yes" });
    expect(byFeature("Duties: fruit, jerseys and the goalkeeper").note).toMatch(/never the goalkeeper/);
    expect(byFeature("Edit fixtures, scores, squad, staff, team details").parent).toBe("no");
    expect(byFeature("Parents' contact details and family PINs").parent).toBe("own");
    expect(byFeature("Player ratings and coach notes").parent).toBe("no");
    expect(byFeature("Lineup rules and the coach PIN").parent).toBe("no");
    for (const f of ["Game plan before kick-off", "Live lineup and clock on game day", "Match record and minutes played"]) {
      expect(byFeature(f).parent).toBe("switch");
    }
  });

  it("coach-level rows are identical for coach and super admin, and the team code matches the coach outside /admin", () => {
    for (const r of allRows.filter((r) => r.group !== "Club")) {
      expect(r.coach, r.feature).toBe(r.admin);
      expect(r.code, r.feature).toBe(r.coach);
    }
  });
});

describe("<RoleMatrix />", () => {
  it("renders every role heading, every feature and the notes", () => {
    render(<RoleMatrix />);
    for (const r of ROLES) expect(screen.getByText(r.label)).toBeTruthy();
    for (const row of allRows) expect(screen.getByText(row.feature)).toBeTruthy();
    expect(screen.getAllByText("Own children").length).toBeGreaterThan(0);
    expect(screen.getAllByText("If the coach allows").length).toBeGreaterThan(0);
    expect(screen.getByText(ROLE_MATRIX_NOTES[0])).toBeTruthy();
  });
});
