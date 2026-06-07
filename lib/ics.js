// Server-side ICS generation for the live, subscribable calendar feed.
// Mirrors the dashboard's own export logic. Times are treated as Brisbane local.
const SEASON = 2026;
const TZ = "Australia/Brisbane";
const pad2 = (n) => String(n).padStart(2, "0");
const isoLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d; };
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function addMin(time, mins) {
  const [h, m] = (time || "00:00").split(":").map(Number);
  let total = (h * 60 + m + mins) % 1440;
  if (total < 0) total += 1440;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}
const compact = (iso, time) => iso.replace(/-/g, "") + (time ? "T" + time.replace(":", "") + "00" : "");
const esc = (s) => (s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function occurrences(s, year = SEASON) {
  if (!s) return [];
  if (s.recur !== "weekly") {
    if (!s.dateISO) return [];
    return new Date(s.dateISO + "T00:00:00").getFullYear() === year ? [s.dateISO] : [];
  }
  const yStart = new Date(`${year}-01-01T00:00:00`);
  const yEnd = new Date(`${year}-12-31T00:00:00`);
  let from = s.startISO ? new Date(s.startISO + "T00:00:00") : yStart;
  let to = s.untilISO ? new Date(s.untilISO + "T00:00:00") : yEnd;
  if (from < yStart) from = yStart;
  if (to > yEnd) to = yEnd;
  const out = [];
  const d = new Date(from);
  while (d.getDay() !== (s.weekday ?? 2)) d.setDate(d.getDate() + 1);
  let guard = 0;
  while (d <= to && guard++ < 60) { out.push(isoLocal(d)); d.setDate(d.getDate() + 7); }
  return out;
}

function gameEv(f, team) {
  const title = `${f.homeAway === "H" ? team : f.opponent} v ${f.homeAway === "H" ? f.opponent : team}`;
  const res = f.status === "played" && f.us != null ? ` (${f.us}-${f.them})` : "";
  return { uid: f.id, title: "⚽ " + title, dateISO: f.dateISO, time: f.time, endTime: f.time ? addMin(f.time, 105) : null, location: f.venue, desc: `Round ${f.round}${res}`, allDay: !f.time };
}
function sessionEv(s, occ) {
  const d = occ || s.dateISO;
  return { uid: s.id + (occ || ""), title: s.title, dateISO: d, time: s.time, endTime: s.endTime, location: s.location, desc: s.notes || "", allDay: !s.time };
}
function vevent(ev) {
  const out = ["BEGIN:VEVENT", `UID:${ev.uid}@fqdash`, `DTSTAMP:${stamp()}`, `SUMMARY:${esc(ev.title)}`];
  if (ev.allDay) {
    out.push(`DTSTART;VALUE=DATE:${ev.dateISO.replace(/-/g, "")}`);
    out.push(`DTEND;VALUE=DATE:${isoLocal(addDays(ev.dateISO, 1)).replace(/-/g, "")}`);
  } else {
    out.push(`DTSTART:${compact(ev.dateISO, ev.time)}`);
    out.push(`DTEND:${compact(ev.dateISO, ev.endTime || addMin(ev.time, 90))}`);
  }
  if (ev.location) out.push(`LOCATION:${esc(ev.location)}`);
  if (ev.desc) out.push(`DESCRIPTION:${esc(ev.desc)}`);
  out.push("END:VEVENT");
  return out;
}
function veventWeekly(s) {
  const occ = occurrences(s);
  if (!occ.length) return [];
  const until = (s.untilISO || `${SEASON}-12-31`).replace(/-/g, "") + "T235959";
  const out = ["BEGIN:VEVENT", `UID:${s.id}@fqdash`, `DTSTAMP:${stamp()}`, `SUMMARY:${esc(s.title)}`,
    `DTSTART:${compact(occ[0], s.time)}`, `DTEND:${compact(occ[0], s.endTime || addMin(s.time, 90))}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[s.weekday]};UNTIL=${until}`];
  if (s.location) out.push(`LOCATION:${esc(s.location)}`);
  if (s.notes) out.push(`DESCRIPTION:${esc(s.notes)}`);
  out.push("END:VEVENT");
  return out;
}

export function seasonICS(data) {
  const name = `${data?.team?.name || "Team"} ${SEASON}`;
  const body = [];
  (data.fixtures || []).forEach((f) => {
    if (f.dateISO && new Date(f.dateISO + "T00:00:00").getFullYear() === SEASON) body.push(...vevent(gameEv(f, data.team?.name || "Us")));
  });
  (data.sessions || []).forEach((s) => {
    if (s.recur === "weekly") body.push(...veventWeekly(s));
    else occurrences(s).forEach((iso) => body.push(...vevent(sessionEv(s, iso))));
  });
  (data.players || []).forEach((p) => {
    if (!p.dob || p.dob.length < 10) return;
    const iso = `${SEASON}-${p.dob.slice(5, 10)}`;
    if (isNaN(new Date(iso + "T00:00:00"))) return;
    if (p.guest && ((p.fromISO && iso < p.fromISO) || (p.untilISO && iso > p.untilISO))) return;
    const by = parseInt(p.dob.slice(0, 4), 10);
    const title = by > 1990 ? `🎂 ${p.name} turns ${SEASON - by}` : `🎂 ${p.name}'s birthday`;
    body.push(...vevent({ uid: "bday" + p.id, title, dateISO: iso, allDay: true }));
  });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FQ Team Dashboard//EN", "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`, `X-WR-TIMEZONE:${TZ}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H", ...body, "END:VCALENDAR"].join("\r\n");
}
