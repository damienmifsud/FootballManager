// Who can see and do what, per role. One table, rendered on /admin (the
// access-control page) and mirrored in README.md, so the answer to "what does
// a club admin actually get?" is written down once. Keep it in step with the
// enforcing code: lib/directory.js (roles), lib/viewer.js (the worn hat),
// lib/visibility.js (what non-coaches receive) and the route guards.
//
// Columns are the hats a session can wear. A coach-parent who has chosen the
// parent hat is, for that session, the Parent column. A player signed in with
// their own email is the same column, for their own record. A super admin
// "viewing as" someone gets that person's column with every write refused. The
// last column is legacy team-code mode, where there are no accounts and no roles.

export const ROLES = [
  { key: "admin", label: "Super admin", note: "ADMIN_EMAILS" },
  { key: "club", label: "Club admin", note: "CLUB_ADMIN_EMAILS or /admin" },
  { key: "coach", label: "Coach, assistant coach, manager", note: "coachEmails or a staff row with an email" },
  { key: "parent", label: "Parent or player", note: "emails on the player's record: a parent's, or the player's own" },
  { key: "code", label: "Team code", note: "legacy mode, no accounts" }
];

// The marks a cell can hold and how they read.
export const MARKS = {
  yes: { label: "Yes", tone: "yes" },
  any: { label: "Anyone", tone: "yes" },
  own: { label: "Own family", tone: "part" },
  switch: { label: "If the coach allows", tone: "part" },
  no: { label: "No", tone: "no" },
  na: { label: "Not available", tone: "muted" }
};

const row = (feature, admin, club, coach, parent, code, note) => ({ feature, admin, club, coach, parent, code, ...(note ? { note } : {}) });

export const ROLE_MATRIX = [
  {
    group: "See",
    rows: [
      row("Fixtures, results, calendar, training, duties", "yes", "yes", "yes", "yes", "yes"),
      row("Squad list, positions, photos, goals and assists", "yes", "yes", "yes", "yes", "yes"),
      row("Parents' contact details and family PINs", "yes", "no", "yes", "own", "yes"),
      row("Player ratings and coach notes", "yes", "no", "yes", "no", "yes"),
      row("Lineup rules and the coach PIN", "yes", "no", "yes", "no", "yes"),
      row("Game plan before kick-off", "yes", "switch", "yes", "switch", "yes", "Parents can see: lineup and sub plan before kick-off"),
      row("Live lineup and clock on game day", "yes", "switch", "yes", "switch", "yes", "Parents can see: who's on the pitch, live score and clock"),
      row("Match record and minutes played", "yes", "switch", "yes", "switch", "yes", "Parents can see: own child's minutes, or everyone's"),
      row("Ask the team assistant", "yes", "yes", "yes", "yes", "yes"),
      row("Calendar subscribe link", "yes", "yes", "yes", "yes", "yes")
    ]
  },
  {
    group: "Do",
    rows: [
      row("Reply In or Out for games and training", "any", "no", "any", "own", "any"),
      row("Duties: fruit, jerseys and the goalkeeper", "yes", "no", "yes", "own", "yes", "Coaches assign or clear any duty; parents and players claim fruit or jersey duty for their own family (never the goalkeeper) and can hand it back"),
      row("Edit fixtures, scores, squad, staff, team details", "yes", "no", "yes", "no", "yes"),
      row("Set the game plan and run the live match", "yes", "no", "yes", "no", "yes"),
      row("Settings: parents can see, match format, home shape, lineup rules", "yes", "no", "yes", "no", "yes"),
      row("Rate players and write coach notes", "yes", "no", "yes", "no", "yes"),
      row("Sync fixtures now", "yes", "no", "yes", "no", "yes", "Every visit still refreshes Squadi fixtures quietly for everyone; a draw on Dribl is refreshed when a coach visits"),
      row("Add web pages and PDFs to the assistant's knowledge", "yes", "no", "yes", "no", "yes"),
      row("League page setup", "yes", "no", "yes", "no", "yes"),
      row("Switch team or role, sign out", "yes", "yes", "yes", "yes", "yes", "Switch shows only when there is a choice")
    ]
  },
  {
    group: "Club",
    rows: [
      row("Open /admin", "yes", "yes", "no", "no", "na", "Club admins get the team wizard and this table"),
      row("Create and edit teams (the wizard)", "yes", "yes", "no", "no", "na", "Deleting a team stays super-admin only"),
      row("People: every login and what it is attached to", "yes", "no", "no", "no", "na", "Holds every family's email, so it is not shown to club admins"),
      row("Add or remove club admins", "yes", "no", "no", "no", "na"),
      row("Per-person per-team overrides (coach, parent, viewer, blocked)", "yes", "no", "no", "no", "na"),
      row("View as any user (read only)", "yes", "no", "no", "no", "na")
    ]
  }
];

export const ROLE_MATRIX_NOTES = [
  "A coach who is also a parent switches role from the chip in the header: as the parent, they get exactly the Parent or player column.",
  "Own family means a parent's children, and for a player signed in with their own email, themselves. A player's own email is entered on their record in the Squad tab; it suits adult teams and older players, and is seen only by the coaches and that family.",
  "My teams lists only the teams a person is on themselves: on its staff, on its roster, a child on its roster, or a role given there. Super admins and club admins open every other team from club admin, with the rights of their own column.",
  "A family on two or more teams can see them together on My teams and reply from there. Each of those replies is made as the parent on its own team, whatever role the person is acting in elsewhere.",
  "Super admins viewing as someone get that person's column, with every save refused.",
  "Overrides set at /admin can move one person to another column for one team; super admins are immune.",
  "In team-code mode there are no accounts: everyone with the code is the Team code column, and the coach PIN is a courtesy toggle, not security."
];
