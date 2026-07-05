// Player-list import parsing (Majestri exports + a simple one-per-line
// format), extracted from the dashboard's bulk-import sheet so the /admin
// team wizard can use the identical logic. Pure: text in, players out.
//
// Accepted inputs, detected automatically:
//  (a) Majestri CSV export with its header row (FirstName/Surname/...)
//  (b) Headerless Majestri copy out of Excel (wide tab-separated rows whose
//      first cell is Player/Coach/Manager/Volunteer)
//  (c) A simple list: "Name, number, position, parent, parent mobile, dob"
//
// Player rows only (coach/manager rows skipped); guardian names, emails and
// mobiles are captured (leading zeros restored), and any extra emails on the
// row are harvested into parentEmails — those drive parent account login.

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
  const lines = String(text || "").split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim());
  const splitRow = (line) => (line.includes("\t") ? line.split("\t").map((s) => s.trim()) : splitCSV(line));
  const rows = lines.map(splitRow);

  // Majestri detection, two flavours:
  //  (a) header row present (CSV file, or Excel copy including row 1)
  //  (b) headerless Excel copy: wide tab rows whose first cell is Player/Coach
  const headerIdx = rows.findIndex((r) => r.some((c) => /^firstname$/i.test(c)) && r.some((c) => /^surname$/i.test(c)));
  const looksPositional = headerIdx === -1 && rows.length > 0 &&
    rows.every((r) => r.length >= 14 && /^(player|coach|manager|volunteer)$/i.test(r[0] || ""));

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
    return {
      id: uid(),
      name: last ? `${first} ${last[0]}.` : first,
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
    const players = rows.slice(headerIdx + 1).map((v, i) => buildPlayer(v, (x) => (x >= 0 && x < v.length ? v[x] : ""), c, i)).filter(Boolean);
    return { isMajestri: true, players };
  }
  if (looksPositional) {
    // Majestri column order (0-based): Role0, First1, Surname2, DOB3, Gender4, Reg5,
    // FFA6, ATSI7, PlayingGroup8, School9, Medical10, MedicalNotes11,
    // PrimaryFirst12, PrimarySurname13, PrimaryEmail14, PrimaryMobile15, MediaRelease17,
    // EmergencyFirst18, EmergencySurname19, EmergencyEmail20, EmergencyMobile21
    const c = { role: 0, first: 1, last: 2, dob: 3, pFirst: 12, pLast: 13, pEmail: 14, pMob: 15, eFirst: 18, eLast: 19, eEmail: 20, eMob: 21 };
    const players = rows.map((v, i) => buildPlayer(v, (x) => (x >= 0 && x < v.length ? v[x] : ""), c, i)).filter(Boolean);
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
    return {
      id: uid(),
      name: String(p.name).trim().slice(0, 60),
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
