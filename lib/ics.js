// ICS generation for the live, subscribable calendar feed (/api/calendar) and
// the dashboard's one-off "whole season" download. Everything is scoped to the
// team's season window (lib/teamSetup teamSeason): weekly training runs from
// the season start to its end, fixtures inside the window are included and
// birthdays are generated for each year the window touches. Times are treated
// as Brisbane local. Pure — safe on the server and in the client bundle.
import { occurrences, isoLocal, addDays, activeOn, isCarnival, carnivalDescription, isCarnivalGame } from "@/lib/dashboardData";
import { teamSeason, seasonLabel, seasonYears } from "@/lib/teamSetup";

const TZ = "Australia/Brisbane";
const pad2 = (n) => String(n).padStart(2, "0");
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

function gameEv(f, team) {
  const title = `${f.homeAway === "H" ? team : f.opponent} v ${f.homeAway === "H" ? f.opponent : team}`;
  const res = f.status === "played" && f.us != null ? ` (${f.us}-${f.them})` : "";
  const cx = f.status === "cancelled" ? "CANCELLED — " : "";
  const desc = `${f.round ? `Round ${f.round}` : ""}${res}${f.status === "cancelled" ? " — CANCELLED" : ""}`.trim();
  return { uid: f.id, title: cx + "⚽ " + title, dateISO: f.dateISO, time: f.time, endTime: f.time ? addMin(f.time, 105) : null, location: f.venue, desc, allDay: !f.time };
}
// A carnival is ONE timed event across its whole window (start to end, six
// hours when no end is set) titled "Carnival: …", its linked games listed in
// the description — never one event per game (seasonICS skips the games'
// own fixtures). components/Dashboard.jsx's sessionEv mirrors this so the
// sheet's Add-to-calendar matches the feed.
function sessionEv(s, occ, data) {
  const d = occ || s.dateISO;
  if (isCarnival(s)) {
    return { uid: s.id + (occ || ""), title: `Carnival: ${s.title}`, dateISO: d, time: s.time, endTime: s.endTime || (s.time ? addMin(s.time, 360) : null), location: s.location, desc: carnivalDescription(s, data), allDay: !s.time };
  }
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
// One RRULE event per weekly session: DTSTART is the first occurrence inside
// the season (never before it), UNTIL the session's own end date or the season
// end, whichever comes first.
function veventWeekly(s, season) {
  const occ = seasonYears(season).flatMap((y) => occurrences(s, y, season));
  if (!occ.length) return [];
  const untilISO = s.untilISO && s.untilISO < season.endISO ? s.untilISO : season.endISO;
  const until = untilISO.replace(/-/g, "") + "T235959";
  const out = ["BEGIN:VEVENT", `UID:${s.id}@fqdash`, `DTSTAMP:${stamp()}`, `SUMMARY:${esc(s.title)}`,
    `DTSTART:${compact(occ[0], s.time)}`, `DTEND:${compact(occ[0], s.endTime || addMin(s.time, 90))}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[s.weekday]};UNTIL=${until}`];
  if (s.location) out.push(`LOCATION:${esc(s.location)}`);
  if (s.notes) out.push(`DESCRIPTION:${esc(s.notes)}`);
  out.push("END:VEVENT");
  return out;
}

export function seasonICS(data) {
  const season = teamSeason(data?.team);
  const inWindow = (iso) => iso >= season.startISO && iso <= season.endISO;
  const name = `${data?.team?.name || "Team"} ${seasonLabel(season)}`;
  const body = [];
  (data?.fixtures || []).forEach((f) => {
    if (isCarnivalGame(data, f)) return; // the carnival's own event covers the day
    if (f.dateISO && inWindow(f.dateISO)) body.push(...vevent(gameEv(f, data.team?.name || "Us")));
  });
  const years = seasonYears(season);
  // One-offs (activities, carnivals) are explicit dates like fixtures: any
  // date in the season's years is included, inside the window or not.
  (data?.sessions || []).forEach((s) => {
    if (s.recur === "weekly") body.push(...veventWeekly(s, season));
    else years.forEach((y) => occurrences(s, y).forEach((iso) => body.push(...vevent(sessionEv(s, iso, data)))));
  });
  (data?.players || []).forEach((p) => {
    if (!p.dob || p.dob.length < 10) return;
    years.forEach((y) => {
      const iso = `${y}-${p.dob.slice(5, 10)}`;
      if (isNaN(new Date(iso + "T00:00:00")) || !inWindow(iso)) return;
      if (!activeOn(p, iso)) return;
      const by = parseInt(p.dob.slice(0, 4), 10);
      const title = by > 1990 ? `🎂 ${p.name} turns ${y - by}` : `🎂 ${p.name}'s birthday`;
      body.push(...vevent({ uid: "bday" + p.id + y, title, dateISO: iso, allDay: true }));
    });
  });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FQ Team Dashboard//EN", "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`, `X-WR-TIMEZONE:${TZ}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H", ...body, "END:VCALENDAR"].join("\r\n");
}
