// Player-list import parsing (Majestri exports + a simple one-per-line
// format), extracted from the dashboard's bulk-import sheet so the /admin
// team wizard can use the identical logic. Pure: text in, players out.
//
// Accepted inputs, detected automatically:
//  (a) Majestri CSV export with its header row (FirstName/Surname/...)
//  (b) Headerless Majestri copy out of Excel (wide rows whose first cell is a
//      role: Player, Coach, Assistant Coach, Manager, ...)
//  (c) A simple list: "Name, number, position, parent, parent mobile, dob"
//
// Player rows only (coach/manager rows skipped); guardian names, emails and
// mobiles are captured (leading zeros restored), and any extra emails on the
// row are harvested into parentEmails — those drive parent account login.
//
// Names: a Majestri player is stored as a short display name ("Spencer M.",
// first name + initial, used where space is tight: replies, duties, the
// planner) plus the full last name in `surname`. The whole team sees the full
// name in the squad list and on the player's screen (playerFullName in
// lib/dashboardData.js).

// What a file picker should offer for a player list. Phones label CSV files
// inconsistently (text/csv, text/comma-separated-values, even Excel's type),
// so the list is generous; the parser decides what it can read.
export const PLAYER_FILE_ACCEPT = ".csv,text/csv,text/comma-separated-values,application/csv,application/vnd.ms-excel,text/plain";

const uid = () => Math.random().toString(36).slice(2, 9);
const POSITIONS = ["GK", "DEF", "MID", "FWD"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MONTHS = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

export function parseDob(s) {
  if (!s) return "";
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  let m = t.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/); // dd/mm/yyyy (AU)
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-](\d{2,4})$/); // "12 Mar 2018" (CSV) or "25-Oct-18" (Excel)
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    let y = m[3];
    if (y.length === 2) y = (parseInt(y, 10) <= 50 ? "20" : "19") + y; // kids' DOBs: 2-digit years are 20xx
    return `${y}-${MONTHS[m[2].slice(0, 3).toLowerCase()]}-${String(m[1]).padStart(2, "0")}`;
  }
  return "";
}

export function fixMobile(s) {
  const d = String(s || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 9 && d[0] === "4") return "0" + d; // leading zero stripped by spreadsheet
  if (d.length === 11 && d.startsWith("61")) return "0" + d.slice(2);
  return d.length >= 8 ? d : "";
}

// RFC-4180-ish CSV line splitter (handles quoted fields with commas)
export function splitCSV(line) {
  const out = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Parse pasted/uploaded text into { isMajestri, players }.
export function parsePlayerImport(text) {
  // An uploaded file can start with a byte-order mark; left in, it would hide
  // the first header ("Role") and let coach rows through as players.
  const lines = String(text || "").replace(/^\uFEFF/, "").split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim());
  const splitRow = (line) => (line.includes("\t") ? line.split("\t").map((s) => s.trim()) : splitCSV(line));
  const rows = lines.map(splitRow);

  // Majestri detection, two flavours:
  //  (a) header row present (CSV file, or Excel copy including row 1)
  //  (b) headerless Excel copy: wide tab rows whose first cell is Player/Coach
  const headerIdx = rows.findIndex((r) => r.some((c) => /^firstname$/i.test(c)) && r.some((c) => /^surname$/i.test(c)));
  // Any role wording counts ("Assistant Coach", "Team Manager"), as long as
  // every row is wide, starts with a role-like cell and one of them is a Player.
  const looksPositional = headerIdx === -1 && rows.length > 0 &&
    rows.every((r) => r.length >= 14 && /^[A-Za-z][A-Za-z ]{2,29}$/.test(r[0] || "")) &&
    rows.some((r) => /^player$/i.test(r[0] || ""));
  // Shirt numbers start as each player's place among the players, so coach
  // rows above them in the export don't leave the squad starting at 3.
  const numbered = (list) => list.map((p, k) => ({ ...p, number: k + 1 }));

  const buildPlayer = (v, get, c, i) => {
    if ((get(c.role) || "Player").toLowerCase() !== "player") return null; // skip coach/manager rows
    const first = get(c.first), last = get(c.last);
    if (!first) return null;
    // Build up to two guardians: primary contact + emergency contact.
    const mk = (fn, sn, em, mo) => {
      const name = [get(fn), get(sn)].filter(Boolean).join(" ");
      const email = EMAIL_RE.test((get(em) || "").trim()) ? get(em).trim().toLowerCase() : "";
      const mobile = fixMobile(get(mo));
      return (name || email || mobile) ? { name, email, mobile } : null;
    };
    const guardians = [mk(c.pFirst, c.pLast, c.pEmail, c.pMob), mk(c.eFirst, c.eLast, c.eEmail, c.eMob)].filter(Boolean);
    // Catch any other emails on the row that weren't in the mapped columns.
    const allEmails = [...new Set(v.filter((x) => EMAIL_RE.test((x || "").trim())).map((x) => x.trim().toLowerCase()))];
    const parentEmails = [...new Set([...guardians.map((g) => g.email).filter(Boolean), ...allEmails])];
    const surname = String(last || "").trim();
    return {
      id: uid(),
      name: surname ? `${first} ${surname[0]}.` : first,
      ...(surname ? { surname } : {}),
      number: i + 1, position: "MID",
      guardians,
      parentName: guardians[0]?.name || "",
      parentContact: guardians[0]?.mobile || "",
      parentEmails,
      dob: parseDob(get(c.dob))
    };
  };

  if (headerIdx !== -1) {
    const head = rows[headerIdx].map((h) => h.toLowerCase());
    const col = (name) => head.indexOf(name.toLowerCase());
    const c = {
      role: col("Role"), first: col("FirstName"), last: col("Surname"), dob: col("DateOfBirth"),
      pFirst: col("PrimaryContactFirstName"), pLast: col("PrimaryContactSurname"), pEmail: col("PrimaryContactEmailAddress"), pMob: col("PrimaryContactMobileNumber"),
      eFirst: col("EmergencyContactFirstName"), eLast: col("EmergencyContactSurname"), eEmail: col("EmergencyContactEmailAddress"), eMob: col("EmergencyContactMobileNumber")
    };
    const players = numbered(rows.slice(headerIdx + 1).map((v, i) => buildPlayer(v, (x) => (x >= 0 && x < v.length ? v[x] : ""), c, i)).filter(Boolean));
    return { isMajestri: true, players };
  }
  if (looksPositional) {
    // Majestri column order (0-based): Role0, First1, Surname2, DOB3, Gender4, Reg5,
    // FFA6, ATSI7, PlayingGroup8, School9, Medical10, MedicalNotes11,
    // PrimaryFirst12, PrimarySurname13, PrimaryEmail14, PrimaryMobile15, MediaRelease17,
    // EmergencyFirst18, EmergencySurname19, EmergencyEmail20, EmergencyMobile21
    const c = { role: 0, first: 1, last: 2, dob: 3, pFirst: 12, pLast: 13, pEmail: 14, pMob: 15, eFirst: 18, eLast: 19, eEmail: 20, eMob: 21 };
    const players = numbered(rows.map((v, i) => buildPlayer(v, (x) => (x >= 0 && x < v.length ? v[x] : ""), c, i)).filter(Boolean));
    return { isMajestri: true, players };
  }
  // Simple list: Name, number, position, parent, parent mobile, birthday
  const players = rows.map((parts, i) => {
    const [name, number, position, parentName, parentContact, dob] = parts.map((s) => (s || "").trim());
    const pos = POSITIONS.includes((position || "").toUpperCase()) ? position.toUpperCase() : "MID";
    return name ? {
      id: uid(), name, number: parseInt(number, 10) || i + 1, position: pos,
      parentName: parentName || "", parentContact: parentContact || "", dob: parseDob(dob)
    } : null;
  }).filter(Boolean);
  return { isMajestri: false, players };
}

// Server-side guard for imported rosters: keep only known fields, cap sizes.
export function sanitizePlayers(input, max = 200) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, max).map((p, i) => {
    if (!p || !String(p.name || "").trim()) return null;
    const emails = (Array.isArray(p.parentEmails) ? p.parentEmails : [])
      .map((e) => String(e || "").trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)).slice(0, 6);
    const guardians = (Array.isArray(p.guardians) ? p.guardians : []).slice(0, 3).map((g) => ({
      name: String(g?.name || "").slice(0, 80),
      email: EMAIL_RE.test(String(g?.email || "").trim()) ? String(g.email).trim().toLowerCase() : "",
      mobile: String(g?.mobile || "").replace(/\D/g, "").slice(0, 15)
    })).filter((g) => g.name || g.email || g.mobile);
    const surname = String(p.surname || "").trim().slice(0, 60);
    return {
      id: uid(),
      name: String(p.name).trim().slice(0, 60),
      ...(surname ? { surname } : {}),
      number: Number(p.number) || i + 1,
      position: POSITIONS.includes(String(p.position || "").toUpperCase()) ? String(p.position).toUpperCase() : "MID",
      guardians,
      parentName: String(p.parentName || "").slice(0, 80),
      parentContact: String(p.parentContact || "").replace(/\D/g, "").slice(0, 15),
      parentEmails: emails,
      dob: /^\d{4}-\d{2}-\d{2}$/.test(p.dob || "") ? p.dob : ""
    };
  }).filter(Boolean);
}

// Fold a freshly parsed list into the squad without doubling anyone up.
//
// A parsed player who is already in the squad is updated instead of added,
// and only where the squad's record is blank: last name, birthday, and the
// family's details when the record has none at all. So pasting the same list
// twice is safe, and pasting it again after an import that kept no last names
// fills them in. A player's id, name, number, position, photo, PIN and coach
// notes are never touched.
//
// "Already in the squad" means the same display name ("Leo K." = "leo k"),
// or a pasted full name that shortens to it ("Leo Kelly" for a squad "Leo K."
// with no last name yet), and no clash of birthdays when both have one. Each
// squad player is matched at most once. Pure: returns
// { players, added: [names], updated: [names], unchanged }.
const nameKey = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
export function mergeImportedPlayers(existing, parsed) {
  const squad = Array.isArray(existing) ? existing : [];
  const out = [...squad];
  const taken = new Set();
  const added = [], updated = [];
  let unchanged = 0;

  for (const p of Array.isArray(parsed) ? parsed : []) {
    if (!p || !String(p.name || "").trim()) continue;
    const key = nameKey(p.name);
    // A pasted full name ("Leo Kelly", "Ana van Dyk"): first name + the rest,
    // which may be the long form of a squad player stored as "Leo K.".
    const words = String(p.name).trim().split(/\s+/);
    const typedSurname = !p.surname && words.length > 1 ? words.slice(1).join(" ") : "";
    const shortKey = typedSurname ? nameKey(`${words[0]} ${typedSurname[0]}`) : "";

    const exact = (x) => nameKey(x.name) === key;
    // The last name this paste carries for squad player x: the export's own
    // column, or the typed one when x is matched through its short form.
    const surnameFor = (x) => p.surname || (exact(x) ? "" : typedSurname);
    const sameName = (x) => {
      if (!exact(x) && !(shortKey && nameKey(x.name) === shortKey)) return false;
      const sn = surnameFor(x);
      return !x.surname || !sn || nameKey(x.surname) === nameKey(sn); // two different last names: two players
    };
    const dobFits = (x) => !x.dob || !p.dob || x.dob === p.dob;
    const candidates = squad.map((x, k) => k).filter((k) => !taken.has(k) && squad[k] && sameName(squad[k]) && dobFits(squad[k]));
    // Prefer an exact birthday match, then an exact name, then the first that fits.
    const i = candidates.find((k) => p.dob && squad[k].dob === p.dob)
      ?? candidates.find((k) => exact(squad[k]))
      ?? candidates[0];
    if (i === undefined) { out.push(p); added.push(p.name); continue; }

    taken.add(i);
    const cur = squad[i];
    const patch = {};
    const sn = surnameFor(cur);
    if (!cur.surname && sn) patch.surname = sn;
    if (!cur.dob && p.dob) patch.dob = p.dob;
    const hasFamily = (cur.guardians || []).length || cur.parentName || cur.parentContact || (cur.parentEmails || []).length;
    if (!hasFamily) {
      if ((p.guardians || []).length) patch.guardians = p.guardians;
      if (p.parentName) patch.parentName = p.parentName;
      if (p.parentContact) patch.parentContact = p.parentContact;
      if ((p.parentEmails || []).length) patch.parentEmails = p.parentEmails;
    }
    if (Object.keys(patch).length) { out[i] = { ...cur, ...patch }; updated.push(cur.name); }
    else unchanged += 1;
  }
  return { players: out, added, updated, unchanged };
}
