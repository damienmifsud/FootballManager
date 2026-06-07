"use client";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Home, CalendarDays, Users, Apple, BarChart3, ShieldCheck, Plus, Pencil,
  Trash2, X, Lock, Unlock, Trophy, MapPin, Clock, ChevronRight, Check,
  Settings as SettingsIcon, Star, Goal, Info,
  Calendar, ClipboardList, ChevronLeft, Dumbbell, Repeat, Play, ExternalLink, Download, Target
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, LabelList
} from "recharts";

/* ============================================================
   STORAGE
   Single shared key so every parent who opens the artifact
   sees the same dashboard. Coach edits behind a light PIN.
============================================================ */
const KEY = "fqdash_data_v1";
const POSITIONS = ["GK", "DEF", "MID", "FWD"];

const uid = () => Math.random().toString(36).slice(2, 9);

const ABSENCE_REASONS = ["Away", "Sick", "Injured", "School event", "Other"];

// Olympic FC core skill development areas (from the club's match cards).
const FOCUS_PRESETS = [
  { title: "Passing", question: "Can you pass safely to your teammate", points: "First touch away from pressure\nLook before you pass\nPlay to a teammate, not just kick it away" },
  { title: "Receiving", question: "Can you control the ball when an opponent is close", points: "Check your shoulders before the ball comes\nFirst touch into space\nStay calm on the ball" },
  { title: "Dribbling", question: "Commit defenders – beat them with purpose", points: "Positive 1st touch forward\nAttack the space in front of you\nUse change of direction or speed" },
  { title: "Finishing", question: "Be clinical – take your chance with confidence", points: "Head steady – eyes on the ball\nHit through the centre of the ball\nDecide early – finish quickly" },
  { title: "1v1 Defending", question: "Can you delay or stop the attacker when they are dribbling ball towards you", points: "Stay low & balanced\nShow them one way\nCan you time your tackle" }
];

function sampleData() {
  const names = [
    ["Jack", 1, "GK"], ["Leo", 2, "DEF"], ["Noah", 3, "DEF"], ["Hugo", 4, "DEF"],
    ["Max", 5, "DEF"], ["Spencer", 6, "MID"], ["Eli", 7, "MID"], ["Cooper", 8, "MID"],
    ["Archie", 9, "FWD"], ["Will", 10, "FWD"], ["Felix", 11, "FWD"], ["Sam", 12, "MID"]
  ];
  const players = names.map(([n, num, p]) => ({ id: uid(), name: n, number: num, position: p }));
  const g = (i, n) => [{ pid: players[i].id, n }];
  const today = new Date();
  const d = (offset) => {
    const x = new Date(today); x.setDate(today.getDate() + offset);
    return x.toISOString().slice(0, 10);
  };
  const fixtures = [
    { id: uid(), round: 1, dateISO: d(-28), time: "09:00", opponent: "Rovers", venue: "Home Ground", homeAway: "H", status: "played", us: 3, them: 1, fruit: players[1].id, gk: players[0].id, goals: g(8, 2).concat(g(9, 1)), assists: g(5, 1), notes: "" },
    { id: uid(), round: 2, dateISO: d(-21), time: "10:30", opponent: "United", venue: "United Park", homeAway: "A", status: "played", us: 1, them: 1, fruit: players[2].id, gk: players[0].id, goals: g(10, 1), assists: g(6, 1), notes: "" },
    { id: uid(), round: 3, dateISO: d(-14), time: "09:00", opponent: "Wanderers", venue: "Home Ground", homeAway: "H", status: "played", us: 4, them: 0, fruit: players[3].id, gk: players[0].id, goals: g(8, 1).concat(g(9, 2)).concat(g(10, 1)), assists: g(7, 2), notes: "Best game yet." },
    { id: uid(), round: 4, dateISO: d(-7), time: "11:00", opponent: "Athletic", venue: "Athletic Reserve", homeAway: "A", status: "played", us: 2, them: 3, fruit: players[4].id, gk: players[0].id, goals: g(9, 1).concat(g(8, 1)), assists: g(10, 1), notes: "" },
    { id: uid(), round: 5, dateISO: d(3), time: "09:00", opponent: "City", venue: "Home Ground", homeAway: "H", status: "upcoming", us: null, them: null, fruit: players[5].id, gk: players[0].id, goals: [], assists: [], notes: "" },
    { id: uid(), round: 6, dateISO: d(10), time: "10:30", opponent: "Strikers", venue: "Strikers Field", homeAway: "A", status: "upcoming", us: null, them: null, fruit: players[6].id, gk: players[1].id, goals: [], assists: [], notes: "" },
    { id: uid(), round: 7, dateISO: d(17), time: "09:00", opponent: "Rovers", venue: "Home Ground", homeAway: "H", status: "upcoming", us: null, them: null, fruit: players[7].id, gk: players[0].id, goals: [], assists: [], notes: "" }
  ];
  const sessions = [
    { id: uid(), title: "Training", kind: "training", recur: "weekly", weekday: 2, startISO: `${SEASON}-03-01`, untilISO: `${SEASON}-09-15`, time: "17:30", endTime: "19:00", location: "Home Ground", notes: "Bring boots, shin pads and a full water bottle." },
    { id: uid(), title: "Training", kind: "training", recur: "weekly", weekday: 4, startISO: `${SEASON}-03-01`, untilISO: `${SEASON}-09-15`, time: "17:30", endTime: "19:00", location: "Home Ground", notes: "" },
    { id: uid(), title: "Team photo day", kind: "event", recur: "once", dateISO: `${SEASON}-06-20`, time: "08:30", endTime: "09:30", location: "Clubhouse", notes: "Full kit, arrive 15 min early." }
  ];
  return {
    team: { name: "Olympic FC U8 Kangaroos White", ageGroup: "U8", division: "Kangaroos K1 Central Hub", headCoach: "Byron", assistantCoach: "Damien", coachPin: "" },
    players, fixtures, sessions, isSample: true
  };
}

/* ============================================================
   HELPERS
============================================================ */
function computeStats(data) {
  const played = data.fixtures.filter(f => f.status === "played" && f.us != null && f.them != null);
  let w = 0, dr = 0, l = 0, gf = 0, ga = 0;
  played.forEach(f => {
    gf += f.us; ga += f.them;
    if (f.us > f.them) w++; else if (f.us === f.them) dr++; else l++;
  });
  const pts = w * 3 + dr;
  const sorted = [...played].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const form = sorted.slice(-5).map(f => f.us > f.them ? "W" : f.us === f.them ? "D" : "L");

  const goalMap = {}, assistMap = {}, gpMap = {};
  played.forEach(f => {
    (f.goals || []).forEach(x => { goalMap[x.pid] = (goalMap[x.pid] || 0) + x.n; });
    (f.assists || []).forEach(x => { assistMap[x.pid] = (assistMap[x.pid] || 0) + x.n; });
  });
  const scorers = data.players
    .map(p => ({ ...p, goals: goalMap[p.id] || 0, assists: assistMap[p.id] || 0 }))
    .filter(p => p.goals > 0 || p.assists > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists);

  const perRound = sorted.map(f => ({ round: "R" + f.round, GF: f.us, GA: f.them }));
  return { played: played.length, w, dr, l, gf, ga, pts, form, scorers, perRound };
}

function nextFixture(data) {
  const up = data.fixtures
    .filter(f => f.status === "upcoming")
    .sort((a, b) => (a.dateISO + a.time).localeCompare(b.dateISO + b.time));
  return up[0] || null;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function countdown(iso, time) {
  if (!iso) return null;
  const t = new Date(iso + "T" + (time || "09:00") + ":00").getTime();
  const diff = t - Date.now();
  if (diff <= 0) return "Kicking off";
  const days = Math.floor(diff / 86400000);
  const hrs = Math.floor((diff % 86400000) / 3600000);
  if (days >= 1) return `${days}d ${hrs}h`;
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hrs}h ${mins}m`;
}

// Pull a YouTube video id out of any common URL shape (watch, youtu.be, embed, shorts)
function ytId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
  if (m) return m[1];
  const bare = url.trim().match(/^[\w-]{11}$/);
  return bare ? url.trim() : null;
}
// What kind of video link is this?
function videoKind(url) {
  if (!url || !url.trim()) return null;
  if (ytId(url)) return "youtube";
  if (/veo\.(co|com)/i.test(url)) return "veo";
  if (/^https?:\/\//i.test(url.trim())) return "other";
  return null;
}
const mapsUrl = (venue) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(venue);

// Guest players are only "active" within their from/until window; regular players always.
function activeOn(p, iso) {
  if (!p.guest) return true;
  const d = iso || isoLocal(new Date());
  if (p.fromISO && d < p.fromISO) return false;
  if (p.untilISO && d > p.untilISO) return false;
  return true;
}
// AU mobile to international format for wa.me links (0400… -> 61400…)
function intlPhone(ph) {
  let d = (ph || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "61" + d.slice(1);
  return d;
}
// Schedule changes detected by the Squadi sync, shown for 14 days.
const recentChanges = (f) => (f?.schedChanges || []).filter(c => Date.now() - (c.at || 0) < 14 * 86400000);
const secToClock = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`;
};
const clockToSec = (str) => {
  const parts = String(str).split(":").map(n => parseInt(n, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
};

// Local yyyy-mm-dd (avoids UTC off-by-one from toISOString)
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const SEASON = 2026;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; // JS getDay order
const FULLDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Expand a training/activity session into its 2026 dates
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

// All games + training occurrences for a given month (0-11) of the season
function monthItems(data, year, month) {
  const items = [];
  data.fixtures.forEach(f => {
    if (!f.dateISO) return;
    const dt = new Date(f.dateISO + "T00:00:00");
    if (dt.getFullYear() === year && dt.getMonth() === month)
      items.push({ key: f.id, dateISO: f.dateISO, time: f.time, kind: "game", title: "vs " + f.opponent, ref: f });
  });
  (data.sessions || []).forEach(s => {
    occurrences(s, year).forEach(iso => {
      const dt = new Date(iso + "T00:00:00");
      if (dt.getMonth() === month)
        items.push({ key: s.id + iso, dateISO: iso, time: s.time, kind: s.kind || "training", title: s.title, ref: s, occ: iso });
    });
  });
  return items.sort((a, b) => (a.dateISO + (a.time || "")).localeCompare(b.dateISO + (b.time || "")));
}

/* ============================================================
   CALENDAR EXPORT (.ics + Google/Outlook add links)
   No backend: these hand events to the user's calendar app.
   Times are treated as Brisbane local.
============================================================ */
const TZ = "Australia/Brisbane";
const pad2 = (n) => String(n).padStart(2, "0");
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d; };
function addMin(time, mins) {
  const [h, m] = (time || "00:00").split(":").map(Number);
  let total = (h * 60 + m + mins) % 1440; if (total < 0) total += 1440;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}
const compact = (iso, time) => iso.replace(/-/g, "") + (time ? "T" + time.replace(":", "") + "00" : "");
const esc = (s) => (s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

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
  const occ = occurrences(s); if (!occ.length) return [];
  const until = (s.untilISO || `${SEASON}-12-31`).replace(/-/g, "") + "T235959";
  const out = ["BEGIN:VEVENT", `UID:${s.id}@fqdash`, `DTSTAMP:${stamp()}`, `SUMMARY:${esc(s.title)}`,
    `DTSTART:${compact(occ[0], s.time)}`, `DTEND:${compact(occ[0], s.endTime || addMin(s.time, 90))}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[s.weekday]};UNTIL=${until}`];
  if (s.location) out.push(`LOCATION:${esc(s.location)}`);
  if (s.notes) out.push(`DESCRIPTION:${esc(s.notes)}`);
  out.push("END:VEVENT");
  return out;
}
const wrapICS = (name, body) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FQ Team Dashboard//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`, `X-WR-TIMEZONE:${TZ}`, ...body, "END:VCALENDAR"].join("\r\n");
const singleICS = (ev) => wrapICS(ev.title, vevent(ev));
function seasonICS(data) {
  const body = [];
  data.fixtures.forEach(f => { if (f.dateISO && new Date(f.dateISO + "T00:00:00").getFullYear() === SEASON) body.push(...vevent(gameEv(f, data.team.name))); });
  (data.sessions || []).forEach(s => {
    if (s.recur === "weekly") body.push(...veventWeekly(s));
    else occurrences(s).forEach(iso => body.push(...vevent(sessionEv(s, iso))));
  });
  return wrapICS(`${data.team.name} ${SEASON}`, body);
}
function downloadICS(filename, text) {
  try {
    const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename.replace(/[^\w.-]+/g, "_");
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 150);
  } catch (e) { console.error(e); }
}
function googleUrl(ev) {
  const dates = ev.allDay
    ? `${ev.dateISO.replace(/-/g, "")}/${isoLocal(addDays(ev.dateISO, 1)).replace(/-/g, "")}`
    : `${compact(ev.dateISO, ev.time)}/${compact(ev.dateISO, ev.endTime || addMin(ev.time, 90))}`;
  const p = new URLSearchParams({ action: "TEMPLATE", text: ev.title, dates, location: ev.location || "", details: ev.desc || "", ctz: TZ });
  return "https://calendar.google.com/calendar/render?" + p.toString();
}
function outlookUrl(ev) {
  const startdt = ev.allDay ? ev.dateISO : `${ev.dateISO}T${ev.time}:00`;
  const enddt = ev.allDay ? isoLocal(addDays(ev.dateISO, 1)) : `${ev.dateISO}T${ev.endTime || addMin(ev.time, 90)}:00`;
  const p = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: ev.title, startdt, enddt, location: ev.location || "", body: ev.desc || "", allday: ev.allDay ? "true" : "false" });
  return "https://outlook.office.com/calendar/0/deeplink/compose?" + p.toString();
}

/* ============================================================
   STYLES — "matchday programme": light editorial body,
   one dark floodlit scoreboard hero, pitch green + lime + amber.
============================================================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=DM+Mono:wght@500&display=swap');
:root{
  --pitch:#C8102E; --pitch-d:#7A0A1B; --ink:#1A1012; --muted:#6b5a5d;
  --lime:#FFFFFF; --amber:#F6A623; --paper:#F4F4F3; --card:#ffffff;
  --line:#e7e3e3; --red:#E5484D; --soft:#f1edee; --win:#1E9E57;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
.fqd{font-family:'DM Sans',system-ui,sans-serif;color:var(--ink);background:var(--paper);
  min-height:100vh;max-width:560px;margin:0 auto;position:relative;padding-bottom:92px;
  background-image:radial-gradient(circle at 50% 0,rgba(200,16,46,.06),transparent 60%);}
.fqd h1,.fqd h2,.fqd h3,.disp{font-family:'Anton',sans-serif;font-weight:400;letter-spacing:.01em;text-transform:uppercase;}
.num{font-family:'DM Mono',monospace;}
.head{background:linear-gradient(160deg,var(--pitch) 0%,var(--pitch-d) 100%);color:#fff;
  padding:18px 20px 22px;position:sticky;top:0;z-index:20;
  border-bottom:3px solid var(--lime);}
.head .kicker{font-size:11px;letter-spacing:.18em;color:var(--lime);text-transform:uppercase;font-weight:700;}
.head .tname{font-size:30px;line-height:.95;margin:4px 0 2px;}
.head .sub{font-size:12px;color:rgba(255,255,255,.7);font-weight:500;}
.coachbtn{position:absolute;top:18px;right:18px;display:flex;align-items:center;gap:6px;
  background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);color:#fff;
  padding:7px 11px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;}
.coachbtn.on{background:var(--lime);color:var(--pitch-d);border-color:var(--lime);}
.wrap{padding:16px 16px 8px;}
.banner{background:#fff8e6;border:1px solid #f3dca0;color:#7a5a12;border-radius:14px;
  padding:11px 13px;font-size:12.5px;display:flex;gap:9px;align-items:flex-start;margin-bottom:14px;}
.banner button{margin-left:auto;background:var(--amber);color:#fff;border:none;border-radius:8px;
  padding:6px 10px;font-weight:700;font-size:11px;cursor:pointer;white-space:nowrap;}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;
  box-shadow:0 1px 2px rgba(10,30,18,.04);margin-bottom:14px;}
.label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700;}
/* scoreboard hero */
.hero{background:linear-gradient(155deg,#2a0810,#120406);color:#fff;border-radius:20px;
  padding:18px;position:relative;overflow:hidden;border:1px solid #45121d;margin-bottom:14px;}
.hero:before{content:"";position:absolute;inset:0;
  background:repeating-linear-gradient(90deg,transparent,transparent 26px,rgba(255,255,255,.025) 26px,rgba(255,255,255,.025) 52px);}
.hero .topline{display:flex;justify-content:space-between;align-items:center;position:relative;}
.hero .ha{font-size:11px;font-weight:700;letter-spacing:.12em;color:var(--lime);text-transform:uppercase;}
.hero .cd{font-size:11px;color:rgba(255,255,255,.65);display:flex;align-items:center;gap:5px;}
.matchup{display:flex;align-items:center;justify-content:center;gap:14px;margin:16px 0 6px;position:relative;}
.matchup .side{flex:1;text-align:center;}
.matchup .side .nm{font-family:'Anton';font-size:20px;line-height:1;}
.matchup .vs{font-family:'Anton';font-size:14px;color:var(--lime);}
.hero .meta{display:flex;justify-content:center;gap:16px;font-size:12px;color:rgba(255,255,255,.75);position:relative;margin-top:8px;}
.hero .meta span{display:flex;align-items:center;gap:5px;}
.duties{display:flex;gap:10px;margin-bottom:14px;}
.duty{flex:1;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:13px;}
.duty .ic{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;}
.duty.fruit .ic{background:#fff1da;color:var(--amber);}
.duty.gk .ic{background:#fdeaec;color:var(--pitch);}
.duty .who{font-family:'Anton';font-size:17px;margin-top:1px;}
.duty .rnd{font-size:10.5px;color:var(--muted);margin-top:2px;}
.statgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
.stat{background:var(--soft);border-radius:14px;padding:12px 8px;text-align:center;}
.stat .v{font-family:'Anton';font-size:24px;line-height:1;}
.stat .k{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:4px;font-weight:700;}
.form{display:flex;gap:6px;margin-top:10px;}
.fp{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;
  font-weight:700;font-size:12px;color:#fff;}
.fp.W{background:var(--win);} .fp.D{background:#9aa3a6;} .fp.L{background:var(--red);}
/* fixtures */
.fx{display:flex;align-items:center;gap:12px;padding:13px 4px;border-bottom:1px solid var(--line);}
.fx:last-child{border-bottom:none;}
.fx .rd{width:40px;text-align:center;}
.fx .rd .r{font-family:'Anton';font-size:18px;line-height:1;}
.fx .rd .dt{font-size:9.5px;color:var(--muted);margin-top:2px;}
.fx .mid{flex:1;min-width:0;}
.fx .opp{font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.fx .ven{font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:4px;margin-top:2px;}
.fx .res{text-align:right;}
.fx .score{font-family:'Anton';font-size:20px;}
.fx .score.w{color:var(--win);} .fx .score.l{color:var(--red);} .fx .score.d{color:var(--muted);}
.fx .upc{font-size:11px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.06em;}
.hatag{display:inline-block;font-size:9px;font-weight:800;padding:2px 5px;border-radius:5px;margin-left:6px;vertical-align:middle;}
.hatag.H{background:#fdeaec;color:var(--pitch);} .hatag.A{background:#eef0f2;color:#5b6b61;}
/* squad */
.pcard{display:flex;align-items:center;gap:13px;padding:12px 4px;border-bottom:1px solid var(--line);cursor:pointer;}
.pcard:last-child{border-bottom:none;}
.pnum{width:42px;height:42px;border-radius:12px;background:var(--pitch);color:#fff;
  display:flex;align-items:center;justify-content:center;font-family:'Anton';font-size:20px;flex-shrink:0;}
.pos-pill{font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;letter-spacing:.04em;}
.pos-GK{background:#fff1da;color:#b3760a;} .pos-DEF{background:#e6f0ff;color:#2563a8;}
.pos-MID{background:#e6f6ec;color:#1f8a4c;} .pos-FWD{background:#ffe6e6;color:#c0393d;}
.pstat{display:flex;gap:18px;margin-left:auto;}
.pstat .v{font-family:'Anton';font-size:18px;text-align:center;line-height:1;}
.pstat .l{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;text-align:center;}
.scorer-row{display:flex;align-items:center;gap:11px;padding:10px 2px;border-bottom:1px solid var(--line);}
.scorer-row:last-child{border-bottom:none;}
.rank{width:24px;font-family:'Anton';font-size:16px;color:var(--muted);text-align:center;}
.rank.gold{color:var(--amber);}
/* nav */
.nav{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);width:calc(100% - 28px);max-width:532px;
  background:rgba(24,8,12,.95);backdrop-filter:blur(12px);border-radius:20px;display:flex;
  padding:8px 6px;z-index:30;box-shadow:0 10px 30px rgba(20,6,10,.4);border:1px solid #45121d;}
.nav button{flex:1;background:none;border:none;color:rgba(255,255,255,.55);display:flex;
  flex-direction:column;align-items:center;gap:3px;padding:6px 2px;cursor:pointer;font-size:9.5px;
  font-weight:700;letter-spacing:.03em;border-radius:13px;transition:.18s;}
.nav button.active{color:var(--pitch-d);background:var(--lime);}
.nav button span{text-transform:uppercase;}
/* modal */
.ov{position:fixed;inset:0;background:rgba(6,18,11,.5);z-index:50;display:flex;align-items:flex-end;
  justify-content:center;animation:fade .2s;}
@keyframes fade{from{opacity:0}to{opacity:1}}
.sheet{background:#fff;width:100%;max-width:560px;border-radius:22px 22px 0 0;max-height:90vh;overflow-y:auto;
  padding:20px 18px 30px;animation:rise .26s cubic-bezier(.2,.8,.2,1);}
@keyframes rise{from{transform:translateY(40px)}to{transform:translateY(0)}}
.sheet .sh-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}
.sheet h2{font-size:22px;}
.xbtn{background:var(--soft);border:none;border-radius:10px;width:34px;height:34px;display:flex;
  align-items:center;justify-content:center;cursor:pointer;color:var(--ink);}
.field{margin-bottom:13px;}
.field label{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:5px;}
.inp{width:100%;border:1px solid var(--line);border-radius:11px;padding:11px 12px;font-size:15px;
  font-family:inherit;background:#fafbfa;color:var(--ink);}
.inp:focus{outline:none;border-color:var(--pitch);}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
.seg{display:flex;gap:6px;}
.seg button{flex:1;border:1px solid var(--line);background:#fafbfa;border-radius:10px;padding:9px;
  font-weight:700;font-size:13px;cursor:pointer;color:var(--muted);}
.seg button.sel{background:var(--pitch);color:#fff;border-color:var(--pitch);}
.btn{background:var(--pitch);color:#fff;border:none;border-radius:13px;padding:14px;font-weight:700;
  font-size:15px;width:100%;cursor:pointer;font-family:inherit;margin-top:6px;}
.btn.ghost{background:var(--soft);color:var(--ink);}
.btn.danger{background:#fdecec;color:var(--red);}
.addfab{display:flex;align-items:center;justify-content:center;gap:7px;background:var(--pitch);
  color:#fff;border:none;border-radius:13px;padding:13px;font-weight:800;width:100%;
  font-size:14px;cursor:pointer;margin-bottom:14px;text-transform:uppercase;letter-spacing:.04em;}
.editbar{display:flex;gap:8px;margin-left:auto;}
.iconbtn{background:var(--soft);border:none;width:32px;height:32px;border-radius:9px;display:flex;
  align-items:center;justify-content:center;cursor:pointer;color:var(--muted);}
.stepper{display:flex;align-items:center;gap:8px;}
.stepper button{width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:#fafbfa;
  font-size:18px;font-weight:700;cursor:pointer;color:var(--ink);display:flex;align-items:center;justify-content:center;}
.stepper .val{font-family:'Anton';font-size:17px;width:22px;text-align:center;}
.gscroll{max-height:230px;overflow-y:auto;border:1px solid var(--line);border-radius:12px;padding:4px 10px;}
.grow{display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid var(--line);}
.grow:last-child{border-bottom:none;}
.grow .gnm{flex:1;font-size:14px;font-weight:600;}
.empty{text-align:center;padding:34px 16px;color:var(--muted);}
.empty .disp{font-size:20px;color:var(--ink);margin-bottom:6px;}
.section-title{display:flex;align-items:center;gap:8px;margin:18px 2px 8px;}
.section-title .disp{font-size:16px;}
.dutyrow{display:flex;align-items:center;gap:11px;padding:12px 4px;border-bottom:1px solid var(--line);}
.dutyrow:last-child{border-bottom:none;}
.dutyrow .rbadge{width:34px;height:34px;border-radius:10px;background:var(--soft);font-family:'Anton';
  display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;}
.note{font-size:12px;color:var(--muted);line-height:1.5;}
.playtag{display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:800;padding:2px 6px;
  border-radius:5px;background:#ffe6e6;color:#c0393d;margin-left:6px;vertical-align:middle;}
.vidwrap{position:relative;width:100%;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:#000;margin-bottom:12px;}
.vidwrap iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}
.vidempty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;
  color:rgba(255,255,255,.55);gap:6px;font-size:12px;text-align:center;padding:18px;}
.chips{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:6px;}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:#fafbfa;
  border-radius:999px;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer;color:var(--ink);}
.chip .t{font-family:'DM Mono';font-size:11px;color:var(--pitch);font-weight:500;}
.chip.act{background:var(--pitch);color:#fff;border-color:var(--pitch);} .chip.act .t{color:var(--lime);}
.chip.add{border-style:dashed;color:var(--muted);}
.chrow{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.chrow input.lab{flex:1;}
.chrow input.tm{width:78px;text-align:center;font-family:'DM Mono';}
.matchscore{text-align:center;margin-bottom:14px;}
.matchscore .big{font-family:'Anton';font-size:44px;line-height:1;}
.matchscore .vs{font-size:13px;color:var(--muted);font-weight:700;margin-bottom:4px;}
.copybox{background:var(--soft);border-radius:12px;padding:12px;font-family:'DM Mono';font-size:12px;
  white-space:pre-wrap;line-height:1.7;margin-bottom:8px;color:var(--ink);}
/* calendar */
.calhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
.calhead .mname{font-family:'Anton';font-size:24px;line-height:1;}
.calhead .yr{font-size:11px;color:var(--muted);font-weight:700;letter-spacing:.12em;}
.calnav{display:flex;gap:8px;}
.calnav button{width:38px;height:38px;border-radius:12px;border:1px solid var(--line);background:#fafbfa;
  display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--ink);}
.calnav button:disabled{opacity:.3;cursor:default;}
.grid7{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;}
.dow{text-align:center;font-size:10px;font-weight:800;letter-spacing:.04em;color:var(--muted);text-transform:uppercase;padding-bottom:7px;}
.daycell{aspect-ratio:1/1;border-radius:11px;display:flex;flex-direction:column;align-items:center;
  padding-top:6px;font-size:13px;font-weight:600;cursor:pointer;color:var(--ink);background:transparent;border:1px solid transparent;}
.daycell.blank{cursor:default;}
.daycell.today{border-color:var(--pitch);}
.daycell.sel{background:var(--pitch);color:#fff;border-color:var(--pitch);}
.daycell .dots{display:flex;gap:3px;margin-top:4px;height:6px;}
.cdot{width:6px;height:6px;border-radius:50%;}
.cdot.game{background:var(--pitch);} .cdot.training{background:var(--amber);} .cdot.event{background:#2563a8;}
.daycell.sel .cdot.game{background:var(--lime);} .daycell.sel .cdot.training{background:#ffd27a;} .daycell.sel .cdot.event{background:#9cc2f5;}
.legend{display:flex;gap:16px;justify-content:center;margin-top:14px;font-size:11px;color:var(--muted);font-weight:600;}
.legend span{display:flex;align-items:center;gap:6px;}
.agenda-title{display:flex;align-items:center;gap:8px;margin:6px 2px 4px;}
.agenda-title .disp{font-size:16px;}
.agitem{display:flex;align-items:stretch;gap:11px;padding:12px 2px;border-bottom:1px solid var(--line);cursor:pointer;}
.agitem:last-child{border-bottom:none;}
.agbar{width:4px;border-radius:3px;flex-shrink:0;}
.agbar.game{background:var(--pitch);} .agbar.training{background:var(--amber);} .agbar.event{background:#2563a8;}
.agtime{width:50px;font-family:'DM Mono';font-size:12px;color:var(--muted);flex-shrink:0;padding-top:1px;}
.kpill{font-size:9px;font-weight:800;padding:2px 6px;border-radius:5px;text-transform:uppercase;letter-spacing:.04em;}
.kpill.game{background:#fdeaec;color:var(--pitch);} .kpill.training{background:#fff1da;color:#b3760a;} .kpill.event{background:#e6f0ff;color:#2563a8;}
.recur-line{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--muted);margin-top:2px;}
.veocard{display:flex;align-items:center;gap:13px;text-decoration:none;color:#fff;margin-bottom:12px;
  background:linear-gradient(135deg,#2a0810,#120406);border:1px solid #45121d;border-radius:16px;padding:15px;}
.veoplay{width:46px;height:46px;border-radius:50%;background:var(--lime);color:var(--pitch-d);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.veocard .vtitle{font-weight:700;font-size:15px;}
.veocard .vsub{color:rgba(255,255,255,.6);font-size:12px;margin-top:1px;}
.veocard .ext{margin-left:auto;color:rgba(255,255,255,.55);flex-shrink:0;}
.chip.lnk{text-decoration:none;}
.wabtn{display:flex;align-items:center;justify-content:center;gap:8px;background:#25D366;color:#fff;
  border:none;border-radius:13px;padding:12px;font-weight:800;width:100%;font-size:14px;cursor:pointer;
  text-decoration:none;margin-bottom:14px;}
.washare{display:inline-flex;align-items:center;gap:6px;background:#25D366;color:#fff;border-radius:999px;
  padding:7px 12px;font-size:12.5px;font-weight:700;text-decoration:none;}
/* weekly focus card — echoes the club's Match Card */
.focus{background:linear-gradient(150deg,#1d2440,#11162b);border-radius:18px;overflow:hidden;
  margin-bottom:14px;border:1px solid #2a3357;color:#fff;}
.focus .strip{background:#f2f0ea;color:#1d2440;display:flex;align-items:center;gap:10px;padding:11px 15px;}
.focus .strip .klabel{font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:#5b6076;}
.focus .strip .area{font-family:'Anton';font-size:19px;line-height:1;text-transform:uppercase;}
.focus .body{background:linear-gradient(150deg,var(--pitch),var(--pitch-d));padding:15px 17px;}
.focus .q{font-weight:800;font-size:14.5px;text-transform:uppercase;letter-spacing:.02em;text-align:center;margin-bottom:11px;line-height:1.35;}
.focus .pt{display:flex;gap:9px;font-size:13.5px;font-weight:600;padding:5px 0;align-items:baseline;}
.focus .pt:before{content:"•";flex-shrink:0;}
/* availability */
.avsum{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;}
.avpill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:800;}
.avpill.in{background:#e6f6ec;color:#1f8a4c;} .avpill.out{background:#fdecec;color:var(--red);}
.avpill.nr{background:var(--soft);color:var(--muted);}
.avrow{display:flex;align-items:center;gap:9px;padding:9px 2px;border-bottom:1px solid var(--line);flex-wrap:wrap;}
.avrow:last-child{border-bottom:none;}
.avname{flex:1;font-weight:600;font-size:14px;min-width:110px;}
.avbtn{border:1px solid var(--line);background:#fafbfa;border-radius:9px;padding:7px 13px;font-weight:800;font-size:12.5px;cursor:pointer;color:var(--muted);}
.avbtn.selin{background:#1E9E57;color:#fff;border-color:#1E9E57;}
.avbtn.selout{background:var(--red);color:#fff;border-color:var(--red);}
.avsel{border:1px solid var(--line);border-radius:9px;padding:7px 9px;font-size:12.5px;background:#fafbfa;color:var(--ink);}
.guesttag{font-size:9px;font-weight:800;padding:2px 6px;border-radius:5px;background:#e6f0ff;color:#2563a8;
  text-transform:uppercase;letter-spacing:.05em;margin-left:6px;vertical-align:middle;}
.guesttag.ended{background:#eef0f2;color:#8a8f94;}
.updtag{display:inline-block;font-size:9px;font-weight:800;padding:2px 6px;border-radius:5px;
  background:var(--red);color:#fff;text-transform:uppercase;letter-spacing:.05em;margin-left:6px;vertical-align:middle;}
.chgcard{background:#fdf1f1;border:1px solid #f3c8ca;border-radius:14px;padding:13px 15px;margin-bottom:14px;}
.chgcard .label{color:var(--red);}
.chgrow{display:flex;gap:8px;align-items:baseline;padding:4px 0;font-size:13.5px;flex-wrap:wrap;}
.chgrow .fld{font-weight:800;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#9b5b5e;min-width:64px;}
.chg-old{text-decoration:line-through;color:var(--muted);}
.chg-new{color:var(--red);font-weight:800;}
.remindrow{display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid var(--line);}
.remindrow:last-child{border-bottom:none;}
`;

/* ============================================================
   APP
============================================================ */
export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("home");
  const [isCoach, setIsCoach] = useState(false);
  const [modal, setModal] = useState(null); // {type, payload}

  // load
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(KEY, true);
        if (r && r.value) setData(JSON.parse(r.value));
        else { const s = sampleData(); setData(s); await window.storage.set(KEY, JSON.stringify(s), true); }
      } catch {
        const s = sampleData();
        setData(s);
        try { await window.storage.set(KEY, JSON.stringify(s), true); } catch {}
      } finally { setLoading(false); }
    })();
  }, []);

  const persist = useCallback(async (next) => {
    setData(next);
    try { await window.storage.set(KEY, JSON.stringify(next), true); } catch (e) { console.error(e); }
  }, []);

  const stats = useMemo(() => data ? computeStats(data) : null, [data]);
  const next = useMemo(() => data ? nextFixture(data) : null, [data]);
  const pname = useCallback((id) => data?.players.find(p => p.id === id)?.name || "—", [data]);

  if (loading || !data) {
    return (
      <div className="fqd"><style>{CSS}</style>
        <div className="empty" style={{ paddingTop: 120 }}><div className="disp">Loading…</div></div>
      </div>
    );
  }

  const toggleCoach = () => {
    if (isCoach) { setIsCoach(false); return; }
    if (data.team.coachPin) setModal({ type: "pin" });
    else setIsCoach(true);
  };

  return (
    <div className="fqd">
      <style>{CSS}</style>

      <div className="head">
        <div className="kicker">{data.team.division} · {data.team.ageGroup}</div>
        <div className="tname">{data.team.name}</div>
        <div className="sub">Coach {data.team.headCoach} · Asst {data.team.assistantCoach}</div>
        <button className={"coachbtn" + (isCoach ? " on" : "")} onClick={toggleCoach}>
          {isCoach ? <Unlock size={13} /> : <Lock size={13} />}{isCoach ? "Coach" : "View"}
        </button>
      </div>

      <div className="wrap">
        {data.isSample && (
          <div className="banner">
            <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>This is example data so you can see the layout. Switch to <b>Coach</b> mode (top right) to edit your real squad, fixtures and duties.</span>
          </div>
        )}

        {tab === "home" && <HomeTab {...{ data, stats, next, pname, setModal }} />}
        {tab === "calendar" && <CalendarTab {...{ data, isCoach, setModal }} />}
        {tab === "fixtures" && <FixturesTab {...{ data, isCoach, pname, setModal, persist }} />}
        {tab === "squad" && <SquadTab {...{ data, stats, isCoach, setModal, persist }} />}
        {tab === "duties" && <DutiesTab {...{ data, isCoach, pname, setModal }} />}
        {tab === "stats" && <StatsTab {...{ data, stats, pname }} />}
        {tab === "settings" && <SettingsTab {...{ data, isCoach, persist, setIsCoach, setModal }} />}
      </div>

      <nav className="nav" style={{ padding: "8px 4px" }}>
        {[["home", Home, "Home"], ["calendar", Calendar, "Calendar"], ["fixtures", ClipboardList, "Results"],
        ["squad", Users, "Squad"], ["duties", Apple, "Duties"], ["stats", BarChart3, "Stats"]].map(([id, Ic, lbl]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)} style={{ fontSize: 9 }}>
            <Ic size={19} /><span>{lbl}</span>
          </button>
        ))}
      </nav>

      {modal && <Modal {...{ modal, setModal, data, persist, isCoach, setIsCoach }} />}
    </div>
  );
}

/* ---------------- HOME ---------------- */
function HomeTab({ data, stats, next, pname, setModal }) {
  const avail = next?.availability || {};
  const activePlayers = next ? data.players.filter(p => activeOn(p, next.dateISO)) : [];
  const counts = next ? activePlayers.reduce((c, p) => {
    const s = avail[p.id]?.status;
    if (s === "in") c.in++; else if (s === "out") c.out++; else c.nr++;
    return c;
  }, { in: 0, out: 0, nr: 0 }) : null;
  return (
    <>
      {next ? (
        <div className="hero">
          <div className="topline">
            <span className="ha">{next.homeAway === "H" ? "Home" : "Away"} · Round {next.round}</span>
            <span className="cd"><Clock size={12} />{countdown(next.dateISO, next.time)}</span>
          </div>
          <div className="matchup">
            <div className="side"><div className="nm">{next.homeAway === "H" ? data.team.name : next.opponent}</div></div>
            <div className="vs">VS</div>
            <div className="side"><div className="nm">{next.homeAway === "H" ? next.opponent : data.team.name}</div></div>
          </div>
          <div className="meta">
            <span><CalendarDays size={13} />{fmtDate(next.dateISO)} · {next.time}</span>
            <span><MapPin size={13} />{next.venue}</span>
          </div>
          {recentChanges(next).length > 0 && (
            <div style={{ position: "relative", textAlign: "center", marginTop: 10 }}>
              <span className="updtag" style={{ fontSize: 10, padding: "4px 10px" }}>⚠ Schedule updated — tap fixture for details</span>
            </div>
          )}
        </div>
      ) : (
        <div className="card"><div className="empty"><div className="disp">No upcoming match</div><div className="note">Add fixtures in the Fixtures tab.</div></div></div>
      )}

      {next && (
        <div className="duties">
          <div className="duty fruit">
            <div className="ic"><Apple size={18} /></div>
            <div className="label">Fruit duty</div>
            <div className="who">{pname(next.fruit)}</div>
            <div className="rnd">Round {next.round}</div>
          </div>
          <div className="duty gk">
            <div className="ic"><ShieldCheck size={18} /></div>
            <div className="label">In goal</div>
            <div className="who">{pname(next.gk)}</div>
            <div className="rnd">Round {next.round}</div>
          </div>
        </div>
      )}

      {next && counts && activePlayers.length > 0 && (
        <div className="card" onClick={() => setModal({ type: "match", payload: next })} style={{ cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div className="label">Who's playing Round {next.round}?</div>
            <ChevronRight size={15} color="var(--muted)" style={{ marginLeft: "auto" }} />
          </div>
          <div className="avsum" style={{ marginBottom: 0 }}>
            <span className="avpill in"><Check size={13} />{counts.in} in</span>
            <span className="avpill out"><X size={13} />{counts.out} out</span>
            <span className="avpill nr">{counts.nr} no reply</span>
          </div>
          {counts.nr > 0 && <div className="note" style={{ marginTop: 8 }}>Tap to mark your player in or out.</div>}
        </div>
      )}

      {next && <FocusCard f={next} />}

      <div className="card">
        <div className="label" style={{ marginBottom: 12 }}>Season so far</div>
        <div className="statgrid">
          {[[stats.w, "Won"], [stats.dr, "Drew"], [stats.l, "Lost"], [stats.pts, "Pts"]].map(([v, k]) => (
            <div className="stat" key={k}><div className="v">{v}</div><div className="k">{k}</div></div>
          ))}
        </div>
        <div className="statgrid" style={{ marginTop: 8 }}>
          {[[stats.played, "Played"], [stats.gf, "For"], [stats.ga, "Against"], [stats.gf - stats.ga >= 0 ? "+" + (stats.gf - stats.ga) : stats.gf - stats.ga, "Diff"]].map(([v, k]) => (
            <div className="stat" key={k}><div className="v">{v}</div><div className="k">{k}</div></div>
          ))}
        </div>
        {stats.form.length > 0 && (<>
          <div className="label" style={{ marginTop: 14 }}>Recent form</div>
          <div className="form">{stats.form.map((r, i) => <div key={i} className={"fp " + r}>{r}</div>)}</div>
        </>)}
      </div>

      {stats.scorers[0] && (
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Top scorer</div>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div className="pnum" style={{ background: "var(--amber)" }}><Trophy size={20} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{stats.scorers[0].name}</div>
              <div className="note">#{stats.scorers[0].number} · {stats.scorers[0].position}</div>
            </div>
            <div className="disp" style={{ fontSize: 30 }}>{stats.scorers[0].goals}<span style={{ fontSize: 13, color: "var(--muted)" }}> goals</span></div>
          </div>
        </div>
      )}

      {data.team.whatsapp && (
        <a className="wabtn" href={data.team.whatsapp} target="_blank" rel="noopener noreferrer">
          Team WhatsApp group
        </a>
      )}
    </>
  );
}

/* ---------------- CALENDAR ---------------- */
function CalendarTab({ data, isCoach, setModal }) {
  const today = new Date();
  const inSeason = today.getFullYear() === SEASON;
  const [month, setMonth] = useState(inSeason ? today.getMonth() : 0);
  const [selISO, setSelISO] = useState(inSeason ? isoLocal(today) : `${SEASON}-01-01`);

  const items = useMemo(() => monthItems(data, SEASON, month), [data, month]);
  const byDay = useMemo(() => {
    const m = {}; items.forEach(it => { (m[it.dateISO] = m[it.dateISO] || []).push(it); }); return m;
  }, [items]);

  // build the month grid (Monday-first)
  const first = new Date(SEASON, month, 1);
  const lead = (first.getDay() + 6) % 7; // days before the 1st
  const daysInMonth = new Date(SEASON, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const monthName = first.toLocaleDateString("en-AU", { month: "long" });
  const todayISO = isoLocal(today);
  const selItems = (byDay[selISO] || []);

  const open = (it) => it.kind === "game"
    ? setModal({ type: "match", payload: it.ref })
    : setModal({ type: "session", payload: it.ref, occ: it.occ });

  return (
    <>
      {isCoach && <button className="addfab" onClick={() => setModal({ type: "sessionEdit", payload: null })}><Plus size={17} />Add training / activity</button>}

      <div className="card">
        <div className="calhead">
          <div><div className="mname">{monthName}</div><div className="yr">{SEASON} Season</div></div>
          <div className="calnav">
            <button disabled={month === 0} onClick={() => setMonth(m => Math.max(0, m - 1))}><ChevronLeft size={18} /></button>
            <button disabled={month === 11} onClick={() => setMonth(m => Math.min(11, m + 1))}><ChevronRight size={18} /></button>
          </div>
        </div>

        <div className="grid7">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => <div className="dow" key={d}>{d[0]}</div>)}
          {cells.map((d, i) => {
            if (d == null) return <div className="daycell blank" key={i} />;
            const iso = `${SEASON}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const evs = byDay[iso] || [];
            const cls = "daycell" + (iso === selISO ? " sel" : iso === todayISO ? " today" : "");
            const kinds = [...new Set(evs.map(e => e.kind))].slice(0, 3);
            return (
              <div className={cls} key={i} onClick={() => setSelISO(iso)}>
                {d}
                <div className="dots">{kinds.map(k => <span key={k} className={"cdot " + k} />)}</div>
              </div>
            );
          })}
        </div>

        <div className="legend">
          <span><span className="cdot game" />Game</span>
          <span><span className="cdot training" />Training</span>
          <span><span className="cdot event" />Event</span>
        </div>
      </div>

      <button className="btn ghost" style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        onClick={() => downloadICS(`${data.team.name}-${SEASON}-season.ics`, seasonICS(data))}>
        <Download size={16} />Export 2026 season to my calendar
      </button>

      <div className="agenda-title">
        <Calendar size={16} color="var(--pitch)" />
        <div className="disp">{fmtDate(selISO)}</div>
      </div>
      <div className="card" style={{ padding: "4px 14px" }}>
        {selItems.length === 0
          ? <div className="empty" style={{ padding: "26px 10px" }}><div className="note">Nothing scheduled this day.</div></div>
          : selItems.map(it => (
            <div className="agitem" key={it.key} onClick={() => open(it)}>
              <div className={"agbar " + it.kind} />
              <div className="agtime">{it.time || "—"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{it.title}</div>
                <div className="ven" style={{ marginTop: 2 }}><MapPin size={11} />{it.ref.venue || it.ref.location || "—"}</div>
              </div>
              <span className={"kpill " + it.kind}>{it.kind === "game" ? "Game" : it.kind === "training" ? "Train" : "Event"}</span>
              <ChevronRight size={16} color="var(--muted)" style={{ alignSelf: "center" }} />
            </div>
          ))}
      </div>
    </>
  );
}

/* ---------------- FIXTURES ---------------- */
function FixturesTab({ data, isCoach, pname, setModal, persist }) {
  const fixtures = [...data.fixtures].sort((a, b) => a.round - b.round);
  const del = (id) => persist({ ...data, fixtures: data.fixtures.filter(f => f.id !== id), isSample: false });
  return (
    <>
      {isCoach && <button className="addfab" onClick={() => setModal({ type: "fixture", payload: null })}><Plus size={17} />Add fixture</button>}
      <div className="card" style={{ padding: "6px 14px" }}>
        {fixtures.length === 0 && <div className="empty"><div className="disp">No fixtures yet</div></div>}
        {fixtures.map(f => {
          const won = f.us > f.them, drew = f.us === f.them;
          const hasVid = !!videoKind(f.video);
          return (
            <div className="fx" key={f.id} onClick={() => setModal({ type: "match", payload: f })} style={{ cursor: "pointer" }}>
              <div className="rd"><div className="r">{f.round}</div><div className="dt">{fmtDate(f.dateISO)}</div></div>
              <div className="mid">
                <div className="opp">{f.opponent}<span className={"hatag " + f.homeAway}>{f.homeAway}</span>{hasVid && <span className="playtag"><Goal size={9} />Watch</span>}{recentChanges(f).length > 0 && <span className="updtag">Updated</span>}</div>
                <div className="ven"><MapPin size={11} />{f.venue} · {f.time}</div>
              </div>
              {f.status === "played" && f.us != null
                ? <div className="res"><div className={"score " + (won ? "w" : drew ? "d" : "l")}>{f.us}–{f.them}</div></div>
                : <div className="res"><div className="upc">Upcoming</div></div>}
              {isCoach && (
                <div className="editbar">
                  <button className="iconbtn" onClick={(e) => { e.stopPropagation(); setModal({ type: "fixture", payload: f }); }}><Pencil size={14} /></button>
                  <button className="iconbtn" onClick={(e) => { e.stopPropagation(); del(f.id); }}><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------------- SQUAD ---------------- */
function SquadTab({ data, stats, isCoach, setModal, persist }) {
  const sm = {};
  stats.scorers.forEach(s => { sm[s.id] = s; });
  const todayISO = isoLocal(new Date());
  const players = [...data.players]
    .filter(p => isCoach || activeOn(p, todayISO))
    .sort((a, b) => (a.guest === b.guest ? a.number - b.number : a.guest ? 1 : -1));
  const del = (id) => persist({ ...data, players: data.players.filter(p => p.id !== id), isSample: false });
  return (
    <>
      {isCoach && <button className="addfab" onClick={() => setModal({ type: "player", payload: null })}><Plus size={17} />Add player</button>}
      <div className="card" style={{ padding: "6px 14px" }}>
        {players.length === 0 && <div className="empty"><div className="disp">No players yet</div></div>}
        {players.map(p => {
          const s = sm[p.id] || { goals: 0, assists: 0 };
          const ended = p.guest && p.untilISO && todayISO > p.untilISO;
          return (
            <div className="pcard" key={p.id} onClick={() => setModal({ type: "playerView", payload: p })}>
              <div className="pnum" style={p.guest ? { background: "#2563a8" } : undefined}>{p.number}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}
                  {p.guest && <span className={"guesttag" + (ended ? " ended" : "")}>{ended ? "Guest · ended" : "Guest"}</span>}
                </div>
                <span className={"pos-pill pos-" + p.position}>{p.position}</span>
                {isCoach && p.guest && (p.fromISO || p.untilISO) && (
                  <span className="note" style={{ marginLeft: 8, fontSize: 10.5 }}>{p.fromISO ? fmtDate(p.fromISO) : "…"} → {p.untilISO ? fmtDate(p.untilISO) : "…"}</span>
                )}
              </div>
              <div className="pstat">
                <div><div className="v">{s.goals}</div><div className="l">G</div></div>
                <div><div className="v">{s.assists}</div><div className="l">A</div></div>
              </div>
              {isCoach && (
                <div className="editbar">
                  <button className="iconbtn" onClick={(e) => { e.stopPropagation(); setModal({ type: "player", payload: p }); }}><Pencil size={14} /></button>
                  <button className="iconbtn" onClick={(e) => { e.stopPropagation(); del(p.id); }}><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------------- DUTIES ---------------- */
function DutiesTab({ data, isCoach, pname, setModal }) {
  const fixtures = [...data.fixtures].sort((a, b) => a.round - b.round);
  return (
    <>
      <div className="card">
        <div className="label" style={{ marginBottom: 4 }}>Roster</div>
        <div className="note">Fruit and goalkeeper duty by round. {isCoach ? "Tap a round to assign." : "Tap into Coach mode to edit."}</div>
      </div>
      <div className="section-title"><Apple size={16} color="var(--amber)" /><div className="disp">Fruit duty</div></div>
      <div className="card" style={{ padding: "6px 14px" }}>
        {fixtures.map(f => (
          <div className="dutyrow" key={f.id} onClick={() => isCoach && setModal({ type: "fixture", payload: f })} style={{ cursor: isCoach ? "pointer" : "default" }}>
            <div className="rbadge">{f.round}</div>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{pname(f.fruit)}</div><div className="note">{fmtDate(f.dateISO)} · vs {f.opponent}</div></div>
            {isCoach && <ChevronRight size={16} color="var(--muted)" />}
          </div>
        ))}
      </div>
      <div className="section-title"><ShieldCheck size={16} color="var(--pitch)" /><div className="disp">Goalkeeper</div></div>
      <div className="card" style={{ padding: "6px 14px" }}>
        {fixtures.map(f => (
          <div className="dutyrow" key={f.id} onClick={() => isCoach && setModal({ type: "fixture", payload: f })} style={{ cursor: isCoach ? "pointer" : "default" }}>
            <div className="rbadge">{f.round}</div>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{pname(f.gk)}</div><div className="note">{fmtDate(f.dateISO)} · vs {f.opponent}</div></div>
            {isCoach && <ChevronRight size={16} color="var(--muted)" />}
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- STATS ---------------- */
function StatsTab({ data, stats, pname }) {
  return (
    <>
      <div className="card">
        <div className="label" style={{ marginBottom: 12 }}>Goals by round</div>
        {stats.perRound.length === 0 ? <div className="note">No completed matches yet.</div> : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.perRound} barGap={2}>
              <XAxis dataKey="round" tick={{ fontSize: 11, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={20} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e4e9e3", fontSize: 12 }} />
              <Bar dataKey="GF" name="For" fill="#C8102E" radius={[5, 5, 0, 0]} />
              <Bar dataKey="GA" name="Against" fill="#3a2e30" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card">
        <div className="label" style={{ marginBottom: 6 }}>Top scorers</div>
        {stats.scorers.length === 0 ? <div className="note" style={{ paddingTop: 6 }}>No goals recorded yet.</div> :
          stats.scorers.map((s, i) => (
            <div className="scorer-row" key={s.id}>
              <div className={"rank" + (i === 0 ? " gold" : "")}>{i + 1}</div>
              <div className="pnum" style={{ width: 34, height: 34, fontSize: 16, background: i === 0 ? "var(--amber)" : "var(--pitch)" }}>{s.number}</div>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{s.name}</div><span className={"pos-pill pos-" + s.position}>{s.position}</span></div>
              <div className="pstat">
                <div><div className="v">{s.goals}</div><div className="l">Goals</div></div>
                <div><div className="v">{s.assists}</div><div className="l">Asst</div></div>
              </div>
            </div>
          ))}
      </div>
    </>
  );
}

/* ---------------- SETTINGS ---------------- */
function SettingsTab({ data, isCoach, persist, setIsCoach, setModal }) {
  const [t, setT] = useState(data.team);
  useEffect(() => setT(data.team), [data.team]);
  const save = () => persist({ ...data, team: t, isSample: false });
  return (
    <>
      {!isCoach && <div className="banner"><Lock size={15} /><span>Switch to Coach mode (top-right lock) to edit team details and manage data.</span></div>}
      <div className="card">
        <div className="label" style={{ marginBottom: 12 }}>Team details</div>
        <div className="field"><label>Team name</label><input className="inp" disabled={!isCoach} value={t.name} onChange={e => setT({ ...t, name: e.target.value })} /></div>
        <div className="row2">
          <div className="field"><label>Age group</label><input className="inp" disabled={!isCoach} value={t.ageGroup} onChange={e => setT({ ...t, ageGroup: e.target.value })} /></div>
          <div className="field"><label>Division</label><input className="inp" disabled={!isCoach} value={t.division} onChange={e => setT({ ...t, division: e.target.value })} /></div>
        </div>
      </div>

      <div className="card">
        <div className="label" style={{ marginBottom: 12 }}>Team staff</div>
        {isCoach ? <>
          <div className="row2">
            <div className="field"><label>Head coach</label><input className="inp" value={t.headCoach} onChange={e => setT({ ...t, headCoach: e.target.value })} /></div>
            <div className="field"><label>Contact</label><input className="inp" value={t.headCoachContact || ""} onChange={e => setT({ ...t, headCoachContact: e.target.value })} placeholder="0400 000 000" /></div>
          </div>
          <div className="row2">
            <div className="field"><label>Assistant coach</label><input className="inp" value={t.assistantCoach} onChange={e => setT({ ...t, assistantCoach: e.target.value })} /></div>
            <div className="field"><label>Contact</label><input className="inp" value={t.assistantCoachContact || ""} onChange={e => setT({ ...t, assistantCoachContact: e.target.value })} placeholder="0400 000 000" /></div>
          </div>
          <div className="row2">
            <div className="field"><label>Manager</label><input className="inp" value={t.manager || ""} onChange={e => setT({ ...t, manager: e.target.value })} /></div>
            <div className="field"><label>Contact</label><input className="inp" value={t.managerContact || ""} onChange={e => setT({ ...t, managerContact: e.target.value })} placeholder="0400 000 000" /></div>
          </div>
        </> : <>
          {[["Head coach", t.headCoach, t.headCoachContact], ["Assistant coach", t.assistantCoach, t.assistantCoachContact], ["Manager", t.manager, t.managerContact]]
            .filter(([, name]) => name)
            .map(([role, name, contact]) => (
              <div key={role} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{name}</div>
                  <div className="note">{role}</div>
                </div>
                {contact && <a href={"tel:" + contact.replace(/\s+/g, "")} style={{ color: "var(--pitch)", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>{contact}</a>}
              </div>
            ))}
        </>}
      </div>

      <div className="card">
        {isCoach ? <>
          <div className="label" style={{ marginBottom: 12 }}>Sharing & access</div>
          <div className="field"><label>WhatsApp group invite link</label><input className="inp" value={t.whatsapp || ""} onChange={e => setT({ ...t, whatsapp: e.target.value })} placeholder="https://chat.whatsapp.com/…" /></div>
          <div className="field"><label>Coach PIN (guards editing)</label><input className="inp" value={t.coachPin} onChange={e => setT({ ...t, coachPin: e.target.value })} placeholder="e.g. 1234 — leave blank for none" /></div>
          <button className="btn" onClick={save}>Save team details</button>
        </> : <div className="note">Parent contact details for each player are kept in the Squad list, visible to coaches only.</div>}
      </div>

      {isCoach && (
        <div className="card">
          <div className="label" style={{ marginBottom: 8 }}>Import & data</div>
          <button className="btn ghost" style={{ marginBottom: 8 }} onClick={() => setModal({ type: "import" })}>Paste fixtures from Squadi</button>
          <button className="btn danger" onClick={() => setModal({ type: "reset" })}>Clear everything & start fresh</button>
        </div>
      )}

      <div className="card">
        <div className="label" style={{ marginBottom: 8 }}>How sharing works</div>
        <div className="note">
          Everyone who opens this dashboard sees the same data, and it's saved automatically. Only people in <b>Coach mode</b> should make changes — set a PIN above so parents can't edit by accident (it's a courtesy guard, not real security). Squadi stays your source of truth: after each game, jump into Coach mode and pop the score in.
        </div>
      </div>

      <div className="card">
        <div className="label" style={{ marginBottom: 8 }}>Match videos</div>
        <div className="note">
          Two easy options per fixture (edit it in Coach mode):<br /><br />
          <b>Veo link (simplest)</b> — in Veo, set the recording to <b>Public</b> and your Clubhouse to <b>Unlisted</b>, copy the share link, and paste it in. No download, no re-upload, no login for parents; it opens in Veo in a new tab. You don't need a special Veo user — public links need no account.<br /><br />
          <b>YouTube link</b> — download the match from Veo (Team plan), upload to YouTube as <b>Unlisted</b>, and paste the link. This one plays inside the dashboard and supports jump-to-half chapters. More setup, but tidier for special games.<br /><br />
          Either way it's children's footage, so keep it link-only (Unlisted) and check your club's consent policy.
        </div>
      </div>

      <div className="card">
        <div className="label" style={{ marginBottom: 8 }}>Sync with Gmail / Microsoft 365</div>
        <div className="note">
          Each game and training has <b>Add to Google / Outlook / .ics</b> buttons, and you can export the whole season below. These drop events straight into a parent's calendar — but they're a <b>one-time copy</b>, not a live link, so a later time change won't follow.<br /><br />
          For a calendar that stays in sync for everyone, keep one <b>shared Google Calendar</b> as the master: Gmail parents add it directly, and Outlook/Microsoft 365 parents use <b>Add calendar → Subscribe from web</b> with its internet (ICS) address. Both then auto-update from the one calendar. Use this dashboard as the front-end and the buttons as the on-ramp.
        </div>
        <button className="btn ghost" style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          onClick={() => downloadICS(`${data.team.name}-${SEASON}-season.ics`, seasonICS(data))}>
          <Download size={16} />Export full 2026 season (.ics)
        </button>
      </div>
    </>
  );
}

/* ============================================================
   MODALS
============================================================ */
function Modal({ modal, setModal, data, persist, isCoach, setIsCoach }) {
  const close = () => setModal(null);
  return (
    <div className="ov" onClick={(e) => { if (e.target.classList.contains("ov")) close(); }}>
      <div className="sheet">
        {modal.type === "pin" && <PinSheet {...{ data, setIsCoach, close }} />}
        {modal.type === "fixture" && <FixtureSheet {...{ data, persist, payload: modal.payload, close }} />}
        {modal.type === "match" && <MatchSheet {...{ data, persist, payload: modal.payload, isCoach, close }} />}
        {modal.type === "session" && <SessionSheet {...{ data, persist, payload: modal.payload, occ: modal.occ, isCoach, setModal, close }} />}
        {modal.type === "sessionEdit" && <SessionEditSheet {...{ data, persist, payload: modal.payload, close }} />}
        {modal.type === "player" && <PlayerSheet {...{ data, persist, payload: modal.payload, close }} />}
        {modal.type === "playerView" && <PlayerViewSheet {...{ data, payload: modal.payload, isCoach, close }} />}
        {modal.type === "import" && <ImportSheet {...{ data, persist, close }} />}
        {modal.type === "reset" && <ResetSheet {...{ data, persist, close }} />}
      </div>
    </div>
  );
}

function SheetHead({ title, close }) {
  return <div className="sh-head"><h2>{title}</h2><button className="xbtn" onClick={close}><X size={18} /></button></div>;
}

// Weekly focus card (training + game), styled after the club's Match Card.
function FocusCard({ f, label = "This week's focus" }) {
  if (!f?.focusTitle) return null;
  const points = (f.focusPoints || "").split("\n").map(s => s.trim()).filter(Boolean);
  return (
    <div className="focus">
      <div className="strip">
        <Target size={22} />
        <div>
          <div className="klabel">{label} · Round {f.round}</div>
          <div className="area">{f.focusTitle}</div>
        </div>
      </div>
      {(f.focusQuestion || points.length > 0) && (
        <div className="body">
          {f.focusQuestion && <div className="q">{f.focusQuestion}</div>}
          {points.map((p, i) => <div className="pt" key={i}>{p}</div>)}
        </div>
      )}
    </div>
  );
}

// Add-to-calendar chips. `icsText` overrides the .ics payload (e.g. a recurring series).
function CalAdd({ ev, icsText, label = "Add to your calendar" }) {
  if (!ev || !ev.dateISO) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="label" style={{ marginBottom: 8 }}>{label}</div>
      <div className="chips">
        <a className="chip lnk" href={googleUrl(ev)} target="_blank" rel="noopener noreferrer"><Calendar size={13} />Google</a>
        <a className="chip lnk" href={outlookUrl(ev)} target="_blank" rel="noopener noreferrer"><Calendar size={13} />Outlook</a>
        <button className="chip" onClick={() => downloadICS(`${ev.title}.ics`, icsText || singleICS(ev))}><Download size={13} />.ics</button>
      </div>
    </div>
  );
}

function PinSheet({ data, setIsCoach, close }) {
  const [v, setV] = useState(""); const [err, setErr] = useState(false);
  const go = () => { if (v === data.team.coachPin) { setIsCoach(true); close(); } else setErr(true); };
  return (<>
    <SheetHead title="Coach PIN" close={close} />
    <div className="field"><label>Enter PIN to edit</label>
      <input className="inp" type="tel" value={v} autoFocus onChange={e => { setV(e.target.value); setErr(false); }} />
    </div>
    {err && <div className="note" style={{ color: "var(--red)", marginBottom: 8 }}>Incorrect PIN.</div>}
    <button className="btn" onClick={go}>Unlock</button>
  </>);
}

function FixtureSheet({ data, persist, payload, close }) {
  const blank = { id: uid(), round: data.fixtures.length + 1, dateISO: "", time: "09:00", opponent: "", venue: "", homeAway: "H", status: "upcoming", us: null, them: null, fruit: "", gk: "", goals: [], assists: [], notes: "", video: "", chapters: [], manual: true };
  const [f, setF] = useState(payload ? JSON.parse(JSON.stringify(payload)) : blank);
  const players = data.players.filter(p => activeOn(p, f.dateISO)).sort((a, b) => a.number - b.number);

  const cnt = (arr, pid) => arr.find(x => x.pid === pid)?.n || 0;
  const bump = (key, pid, d) => {
    const arr = [...(f[key] || [])]; const i = arr.findIndex(x => x.pid === pid);
    if (i === -1) { if (d > 0) arr.push({ pid, n: 1 }); }
    else { arr[i] = { ...arr[i], n: Math.max(0, arr[i].n + d) }; if (arr[i].n === 0) arr.splice(i, 1); }
    setF({ ...f, [key]: arr });
  };

  const save = () => {
    const exists = data.fixtures.some(x => x.id === f.id);
    const fixtures = exists ? data.fixtures.map(x => x.id === f.id ? f : x) : [...data.fixtures, f];
    persist({ ...data, fixtures, isSample: false }); close();
  };

  return (<>
    <SheetHead title={payload ? "Edit fixture" : "Add fixture"} close={close} />
    <div className="row2">
      <div className="field"><label>Round</label><input className="inp" type="number" value={f.round} onChange={e => setF({ ...f, round: +e.target.value })} /></div>
      <div className="field"><label>Time</label><input className="inp" type="time" value={f.time} onChange={e => setF({ ...f, time: e.target.value })} /></div>
    </div>
    <div className="field"><label>Date</label><input className="inp" type="date" value={f.dateISO} onChange={e => setF({ ...f, dateISO: e.target.value })} /></div>
    <div className="field"><label>Opponent</label><input className="inp" value={f.opponent} onChange={e => setF({ ...f, opponent: e.target.value })} /></div>
    <div className="field"><label>Venue</label><input className="inp" value={f.venue} onChange={e => setF({ ...f, venue: e.target.value })} /></div>
    <div className="field"><label>Home / Away</label>
      <div className="seg">{["H", "A"].map(h => <button key={h} className={f.homeAway === h ? "sel" : ""} onClick={() => setF({ ...f, homeAway: h })}>{h === "H" ? "Home" : "Away"}</button>)}</div>
    </div>
    <div className="field"><label>Status</label>
      <div className="seg">{["upcoming", "played"].map(s => <button key={s} className={f.status === s ? "sel" : ""} onClick={() => setF({ ...f, status: s })}>{s === "upcoming" ? "Upcoming" : "Played"}</button>)}</div>
    </div>

    {f.status === "played" && (
      <div className="row2">
        <div className="field"><label>Our score</label><input className="inp" type="number" value={f.us ?? ""} onChange={e => setF({ ...f, us: e.target.value === "" ? null : +e.target.value })} /></div>
        <div className="field"><label>Their score</label><input className="inp" type="number" value={f.them ?? ""} onChange={e => setF({ ...f, them: e.target.value === "" ? null : +e.target.value })} /></div>
      </div>
    )}

    <div className="row2">
      <div className="field"><label>Fruit duty</label>
        <select className="inp" value={f.fruit} onChange={e => setF({ ...f, fruit: e.target.value })}>
          <option value="">— none —</option>{players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="field"><label>Goalkeeper</label>
        <select className="inp" value={f.gk} onChange={e => setF({ ...f, gk: e.target.value })}>
          <option value="">— none —</option>{players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
    </div>

    {f.status === "played" && players.length > 0 && (
      <div className="field"><label>Goals & assists</label>
        <div className="gscroll">
          {players.map(p => (
            <div className="grow" key={p.id}>
              <div className="gnm">{p.number}. {p.name}</div>
              <div style={{ textAlign: "center" }}>
                <div className="l" style={{ fontSize: 9, color: "var(--muted)", marginBottom: 2 }}>G</div>
                <div className="stepper"><button onClick={() => bump("goals", p.id, -1)}>–</button><div className="val">{cnt(f.goals, p.id)}</div><button onClick={() => bump("goals", p.id, 1)}>+</button></div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div className="l" style={{ fontSize: 9, color: "var(--muted)", marginBottom: 2 }}>A</div>
                <div className="stepper"><button onClick={() => bump("assists", p.id, -1)}>–</button><div className="val">{cnt(f.assists, p.id)}</div><button onClick={() => bump("assists", p.id, 1)}>+</button></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}

    <div className="field" style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <label>Focus this week — training & game (optional)</label>
      <select className="inp" style={{ marginBottom: 8 }}
        value={FOCUS_PRESETS.some(p => p.title === f.focusTitle) ? f.focusTitle : (f.focusTitle ? "__custom" : "")}
        onChange={e => {
          const v = e.target.value;
          if (v === "") { setF({ ...f, focusTitle: "", focusQuestion: "", focusPoints: "" }); return; }
          if (v === "__custom") { setF({ ...f, focusTitle: f.focusTitle || "Custom focus" }); return; }
          const p = FOCUS_PRESETS.find(x => x.title === v);
          setF({ ...f, focusTitle: p.title, focusQuestion: p.question, focusPoints: p.points });
        }}>
        <option value="">— no focus set —</option>
        {FOCUS_PRESETS.map(p => <option key={p.title} value={p.title}>{p.title}</option>)}
        <option value="__custom">Custom…</option>
      </select>
      {f.focusTitle && <>
        <input className="inp" value={f.focusTitle || ""} placeholder="Focus area"
          onChange={e => setF({ ...f, focusTitle: e.target.value })} style={{ marginBottom: 8 }} />
        <input className="inp" value={f.focusQuestion || ""} placeholder="Headline question"
          onChange={e => setF({ ...f, focusQuestion: e.target.value })} style={{ marginBottom: 8 }} />
        <textarea className="inp" rows={3} value={f.focusPoints || ""} placeholder={"Coaching points, one per line"}
          onChange={e => setF({ ...f, focusPoints: e.target.value })} />
      </>}
    </div>

    <div className="field"><label>Notes (optional)</label><textarea className="inp" rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>

    {f.status === "played" && (
      <div className="field"><label>Match report / Veo AI summary</label>
        <textarea className="inp" rows={6} value={f.report || ""} placeholder="Paste the Veo match summary here…"
          onChange={e => setF({ ...f, report: e.target.value })} />
      </div>
    )}

    <VideoEditor f={f} setF={setF} />

    <button className="btn" onClick={save}>Save fixture</button>
  </>);
}

function VideoEditor({ f, setF }) {
  const chapters = f.chapters || [];
  const setCh = (ch) => setF({ ...f, chapters: ch });
  const kind = videoKind(f.video);
  const addCh = () => setCh([...chapters, { label: chapters.length === 0 ? "Kick-off" : "New chapter", t: chapters.length === 0 ? 0 : "" }]);
  const updCh = (i, key, val) => { const c = [...chapters]; c[i] = { ...c[i], [key]: val }; setCh(c); };
  const delCh = (i) => setCh(chapters.filter((_, x) => x !== i));

  const ytText = ["0:00 " + (chapters[0]?.label || "Kick-off")]
    .concat([...chapters].sort((a, b) => clockToSec(a.t) - clockToSec(b.t)).slice(chapters[0] && clockToSec(chapters[0].t) === 0 ? 1 : 0)
      .map(c => `${secToClock(clockToSec(c.t))} ${c.label}`))
    .join("\n");

  return (
    <div className="field" style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <label>Match video — paste a Veo or YouTube link</label>
      <input className="inp" value={f.video || ""} placeholder="https://app.veo.co/…  or  https://youtu.be/…"
        onChange={e => setF({ ...f, video: e.target.value })} />
      {f.video && !kind && <div className="note" style={{ color: "var(--red)", marginTop: 5 }}>That doesn't look like a link yet.</div>}

      {kind === "veo" && (
        <div className="note" style={{ marginTop: 7 }}>
          <b>Veo link.</b> Shows as a “Watch on Veo” button that opens in a new tab. Set the recording to Public so it opens without a login. (Veo can't play inside the dashboard or jump to chapters — that's YouTube only.)
        </div>
      )}
      {kind === "other" && (
        <div className="note" style={{ marginTop: 7 }}>Shows as a “Watch” button that opens this link in a new tab.</div>
      )}

      {kind === "youtube" && (<>
        <label style={{ marginTop: 14 }}>Chapters (jump-to buttons inside the player)</label>
        {chapters.map((c, i) => (
          <div className="chrow" key={i}>
            <input className="inp lab" value={c.label} placeholder="e.g. 2nd half" onChange={e => updCh(i, "label", e.target.value)} />
            <input className="inp tm" value={typeof c.t === "number" ? secToClock(c.t) : c.t} placeholder="mm:ss"
              onChange={e => updCh(i, "t", e.target.value)} onBlur={e => updCh(i, "t", clockToSec(e.target.value))} />
            <button className="iconbtn" onClick={() => delCh(i)}><Trash2 size={14} /></button>
          </div>
        ))}
        <button className="chip add" onClick={addCh}><Plus size={13} />Add chapter</button>

        {chapters.length >= 2 && (<>
          <label style={{ marginTop: 14 }}>Paste this into your YouTube description</label>
          <div className="copybox">{ytText}</div>
          <button className="chip" onClick={() => { navigator.clipboard?.writeText(ytText); }}><Check size={13} />Copy chapter text</button>
        </>)}
      </>)}
    </div>
  );
}

function MatchSheet({ data, persist, payload: f, isCoach, close }) {
  const [seek, setSeek] = useState(null);
  const [avail, setAvail] = useState(f.availability || {});
  const kind = videoKind(f.video);
  const id = ytId(f.video);
  const chapters = [...(f.chapters || [])].sort((a, b) => (a.t || 0) - (b.t || 0));
  const pname = (pid) => data.players.find(p => p.id === pid)?.name || "—";
  const scorers = (f.goals || []).map(g => ({ name: pname(g.pid), n: g.n }));
  const us = data.team.name, them = f.opponent;
  const home = f.homeAway === "H";
  const src = id
    ? `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1${seek != null ? `&start=${seek}&autoplay=1` : ""}`
    : null;

  const setAv = (pid, patch) => {
    const cur = avail[pid] || {};
    const entry = { ...cur, ...patch };
    const next = { ...avail };
    if (entry.status == null) delete next[pid]; else next[pid] = entry;
    setAvail(next);
    const fixtures = data.fixtures.map(x => x.id === f.id ? { ...x, availability: next } : x);
    persist({ ...data, fixtures, isSample: false });
  };

  const players = data.players.filter(p => activeOn(p, f.dateISO)).sort((a, b) => a.number - b.number);
  const counts = players.reduce((c, p) => {
    const s = avail[p.id]?.status;
    if (s === "in") c.in++; else if (s === "out") c.out++; else c.nr++;
    return c;
  }, { in: 0, out: 0, nr: 0 });
  const nonResponders = players.filter(p => !avail[p.id]?.status);
  const remindText = (p) =>
    `Hi${p.parentName ? " " + p.parentName.split(" ")[0] : ""}! Quick one — could you mark ${p.name} In or Out for Round ${f.round} vs ${f.opponent} (${fmtDate(f.dateISO)}) on the team page? Thanks! ⚽`;
  const groupNudge = `⚽ Round ${f.round} vs ${f.opponent} — ${fmtDate(f.dateISO)} ${f.time}\nStill need In/Out from: ${nonResponders.map(p => p.name).join(", ")}\nPlease respond on the team page 🙏`;

  return (<>
    <SheetHead title={`Round ${f.round}`} close={close} />
    <div className="matchscore">
      <div className="vs">{home ? us : them} vs {home ? them : us}</div>
      {f.status === "played" && f.us != null
        ? <div className="big">{home ? f.us : f.them}–{home ? f.them : f.us}</div>
        : <div className="big" style={{ fontSize: 22, color: "var(--amber)" }}>Upcoming</div>}
      <div className="note">{fmtDate(f.dateISO)} · {f.time} · {f.venue
        ? <a href={mapsUrl(f.venue)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--pitch)", fontWeight: 700, textDecoration: "underline" }}>{f.venue}</a>
        : "—"}</div>
    </div>

    <FocusCard f={f} label={f.status === "played" ? "Focus that week" : "This week's focus"} />

    {recentChanges(f).length > 0 && (
      <div className="chgcard">
        <div className="label" style={{ marginBottom: 6 }}>⚠ Schedule changed</div>
        {recentChanges(f).map((c, i) => (
          <div className="chgrow" key={i}>
            <span className="fld">{c.field}</span>
            {c.oldText && <span className="chg-old">{c.oldText}</span>}
            <span className="chg-new">{c.newText}</span>
          </div>
        ))}
        {isCoach && (
          <button className="chip" style={{ marginTop: 8 }} onClick={() => {
            const fixtures = data.fixtures.map(x => x.id === f.id ? { ...x, schedChanges: [] } : x);
            persist({ ...data, fixtures, isSample: false });
            close();
          }}><Check size={13} />Dismiss</button>
        )}
      </div>
    )}

    {f.status === "upcoming" && players.length > 0 && (
      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Who's playing? Tap your player</div>
        <div className="avsum">
          <span className="avpill in"><Check size={13} />{counts.in} in</span>
          <span className="avpill out"><X size={13} />{counts.out} out</span>
          <span className="avpill nr">{counts.nr} no reply</span>
        </div>
        {players.map(p => {
          const a = avail[p.id] || {};
          return (
            <div className="avrow" key={p.id}>
              <div className="avname">{p.number}. {p.name}</div>
              <button className={"avbtn" + (a.status === "in" ? " selin" : "")}
                onClick={() => setAv(p.id, { status: a.status === "in" ? null : "in", reason: undefined })}>In</button>
              <button className={"avbtn" + (a.status === "out" ? " selout" : "")}
                onClick={() => setAv(p.id, { status: a.status === "out" ? null : "out", reason: a.reason || "Away" })}>Out</button>
              {a.status === "out" && (
                <select className="avsel" value={a.reason || "Away"} onChange={e => setAv(p.id, { status: "out", reason: e.target.value })}>
                  {ABSENCE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
            </div>
          );
        })}
        <div className="note" style={{ marginTop: 10 }}>Tap In or Out for your child — it saves instantly and replaces the weekly poll. Tap again to clear.</div>

        {isCoach && nonResponders.length > 0 && (
          <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <div className="label" style={{ marginBottom: 8 }}>Coach tools — chase non-responders</div>
            {nonResponders.map(p => (
              <div className="remindrow" key={p.id}>
                <div style={{ flex: 1, fontSize: 13.5 }}>
                  <b>{p.name}</b>{p.parentName ? <span className="note"> · {p.parentName}</span> : ""}
                </div>
                {p.parentContact ? (
                  <a className="washare" style={{ padding: "5px 10px", fontSize: 11.5 }}
                    href={`https://wa.me/${intlPhone(p.parentContact)}?text=${encodeURIComponent(remindText(p))}`}
                    target="_blank" rel="noopener noreferrer">Remind</a>
                ) : <span className="note" style={{ fontSize: 11 }}>no contact</span>}
              </div>
            ))}
            <a className="washare" style={{ marginTop: 10 }}
              href={"https://wa.me/?text=" + encodeURIComponent(groupNudge)}
              target="_blank" rel="noopener noreferrer">Nudge the group</a>
          </div>
        )}
      </div>
    )}

    {f.status === "played" && Object.values(avail).some(a => a?.status === "out") && (
      <div className="card">
        <div className="label" style={{ marginBottom: 6 }}>Unavailable this game</div>
        {players.filter(p => avail[p.id]?.status === "out").map(p => (
          <div key={p.id} style={{ display: "flex", gap: 8, padding: "5px 0", fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>{p.name}</span>
            <span className="note">{avail[p.id]?.reason || ""}</span>
          </div>
        ))}
      </div>
    )}

    {kind === "youtube" && (<>
      <div className="vidwrap">
        <iframe key={seek} src={src} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title="Match video" />
      </div>
      {chapters.length > 0 && (
        <div className="chips">
          {chapters.map((c, i) => (
            <button key={i} className={"chip" + (seek === (c.t || 0) ? " act" : "")} onClick={() => setSeek(c.t || 0)}>
              {c.label}<span className="t">{secToClock(c.t || 0)}</span>
            </button>
          ))}
        </div>
      )}
    </>)}

    {(kind === "veo" || kind === "other") && (
      <a className="veocard" href={f.video} target="_blank" rel="noopener noreferrer">
        <div className="veoplay"><Play size={22} fill="currentColor" /></div>
        <div>
          <div className="vtitle">{kind === "veo" ? "Watch full match on Veo" : "Watch match video"}</div>
          <div className="vsub">Opens in a new tab</div>
        </div>
        <ExternalLink size={18} className="ext" />
      </a>
    )}

    {!kind && (
      <div className="vidwrap"><div className="vidempty"><Goal size={26} /><div>No match video linked yet.{"\n"}Add a Veo or YouTube link in Coach mode.</div></div></div>
    )}

    {scorers.length > 0 && (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="label" style={{ marginBottom: 8 }}>Goal scorers</div>
        {scorers.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 15 }}>
            <Goal size={15} color="var(--pitch)" /><span style={{ fontWeight: 600 }}>{s.name}</span>
            {s.n > 1 && <span className="note">×{s.n}</span>}
          </div>
        ))}
      </div>
    )}

    {f.report && (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="label" style={{ marginBottom: 8 }}>Match report</div>
        <div className="note" style={{ fontSize: 13.5, whiteSpace: "pre-wrap", color: "var(--ink)" }}>{f.report}</div>
        <div className="note" style={{ marginTop: 8, fontSize: 11 }}>AI-generated summary from the Veo match camera.</div>
      </div>
    )}

    {f.notes && <div className="card" style={{ marginTop: 6 }}><div className="label" style={{ marginBottom: 6 }}>Notes</div><div className="note" style={{ fontSize: 13.5 }}>{f.notes}</div></div>}

    {f.dateISO && <CalAdd ev={gameEv(f, data.team.name)} />}

    <div style={{ marginTop: 12 }}>
      <a className="washare" target="_blank" rel="noopener noreferrer"
        href={"https://wa.me/?text=" + encodeURIComponent(
          `⚽ ${data.team.name} — Round ${f.round} vs ${f.opponent}\n` +
          (f.status === "played" && f.us != null
            ? `Result: ${f.us}–${f.them}` +
              ((f.goals || []).length ? `\nGoals: ${(f.goals || []).map(g => `${pname(g.pid)}${g.n > 1 ? " ×" + g.n : ""}`).join(", ")}` : "")
            : `${fmtDate(f.dateISO)} · ${f.time}\n📍 ${f.venue || "TBC"}`) +
          (f.focusTitle ? `\n🎯 Focus: ${f.focusTitle}` : "") +
          (f.fruit ? `\n🍊 Fruit: ${pname(f.fruit)}` : "")
        )}>
        Share to WhatsApp
      </a>
    </div>
  </>);
}

function PlayerSheet({ data, persist, payload, close }) {
  const [p, setP] = useState(payload || { id: uid(), name: "", number: "", position: "MID" });
  const save = () => {
    if (!p.name) return;
    const np = { ...p, number: +p.number || 0 };
    const exists = data.players.some(x => x.id === p.id);
    const players = exists ? data.players.map(x => x.id === p.id ? np : x) : [...data.players, np];
    persist({ ...data, players, isSample: false }); close();
  };
  return (<>
    <SheetHead title={payload ? "Edit player" : "Add player"} close={close} />
    <div className="field"><label>Name</label><input className="inp" value={p.name} autoFocus onChange={e => setP({ ...p, name: e.target.value })} /></div>
    <div className="field"><label>Squad number</label><input className="inp" type="number" value={p.number} onChange={e => setP({ ...p, number: e.target.value })} /></div>
    <div className="field"><label>Position</label>
      <div className="seg">{POSITIONS.map(pos => <button key={pos} className={p.position === pos ? "sel" : ""} onClick={() => setP({ ...p, position: pos })}>{pos}</button>)}</div>
    </div>
    <div className="row2">
      <div className="field"><label>Parent / guardian</label><input className="inp" value={p.parentName || ""} onChange={e => setP({ ...p, parentName: e.target.value })} /></div>
      <div className="field"><label>Parent contact</label><input className="inp" value={p.parentContact || ""} onChange={e => setP({ ...p, parentContact: e.target.value })} placeholder="0400 000 000" /></div>
    </div>
    <div className="note" style={{ marginTop: -6, marginBottom: 10 }}>Parent details show to coaches only.</div>

    <div className="field" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <label>Player type</label>
      <div className="seg">
        <button className={!p.guest ? "sel" : ""} onClick={() => setP({ ...p, guest: false })}>Regular squad</button>
        <button className={p.guest ? "sel" : ""} onClick={() => setP({ ...p, guest: true })}>Guest / temporary</button>
      </div>
    </div>
    {p.guest && <>
      <div className="row2">
        <div className="field"><label>Playing from</label><input className="inp" type="date" value={p.fromISO || ""} onChange={e => setP({ ...p, fromISO: e.target.value })} /></div>
        <div className="field"><label>Until</label><input className="inp" type="date" value={p.untilISO || ""} onChange={e => setP({ ...p, untilISO: e.target.value })} /></div>
      </div>
      <div className="note" style={{ marginTop: -6, marginBottom: 10 }}>Guests only appear in the squad, availability lists and duty pickers for games inside this window. Afterwards they drop out automatically (their goals stay in the history).</div>
    </>}
    <button className="btn" onClick={save}>Save player</button>
  </>);
}

function PlayerViewSheet({ data, payload, isCoach, close }) {
  const played = data.fixtures.filter(f => f.status === "played");
  let g = 0, a = 0;
  played.forEach(f => { g += (f.goals || []).filter(x => x.pid === payload.id).reduce((s, x) => s + x.n, 0); a += (f.assists || []).filter(x => x.pid === payload.id).reduce((s, x) => s + x.n, 0); });
  return (<>
    <SheetHead title={payload.name} close={close} />
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
      <div className="pnum" style={{ width: 56, height: 56, fontSize: 26 }}>{payload.number}</div>
      <div><span className={"pos-pill pos-" + payload.position}>{payload.position}</span></div>
    </div>
    <div className="statgrid" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <div className="stat"><div className="v">{g}</div><div className="k">Goals</div></div>
      <div className="stat"><div className="v">{a}</div><div className="k">Assists</div></div>
    </div>
    {isCoach && (payload.parentName || payload.parentContact) && (
      <div className="card" style={{ marginTop: 14, marginBottom: 0 }}>
        <div className="label" style={{ marginBottom: 6 }}>Parent / guardian (coach view)</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>{payload.parentName || "—"}</div>
          {payload.parentContact && <a href={"tel:" + payload.parentContact.replace(/\s+/g, "")} style={{ color: "var(--pitch)", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>{payload.parentContact}</a>}
        </div>
      </div>
    )}
  </>);
}

function ImportSheet({ data, persist, close }) {
  const [txt, setTxt] = useState("");
  const parse = () => {
    const lines = txt.split("\n").map(l => l.trim()).filter(Boolean);
    const start = data.fixtures.length;
    const add = lines.map((l, i) => ({
      id: uid(), round: start + i + 1, dateISO: "", time: "09:00",
      opponent: l.replace(/\s+vs\s+/i, " ").slice(0, 60), venue: "", homeAway: "H",
      status: "upcoming", us: null, them: null, fruit: "", gk: "", goals: [], assists: [], notes: "Imported — tidy up", manual: true
    }));
    persist({ ...data, fixtures: [...data.fixtures, ...add], isSample: false }); close();
  };
  return (<>
    <SheetHead title="Paste from Squadi" close={close} />
    <div className="note" style={{ marginBottom: 12 }}>
      Squadi can't feed in live, but you can copy your fixture list from the Squadi page and paste it below — one match per line. Each line becomes a draft fixture you then tap to add dates, venue and scores. Rough by design; tidy each up afterwards.
    </div>
    <div className="field"><textarea className="inp" rows={7} placeholder={"Round 5 vs City\nRound 6 vs Strikers\n..."} value={txt} onChange={e => setTxt(e.target.value)} /></div>
    <button className="btn" onClick={parse} disabled={!txt.trim()}>Create draft fixtures</button>
  </>);
}

function ResetSheet({ data, persist, close }) {
  return (<>
    <SheetHead title="Start fresh?" close={close} />
    <div className="note" style={{ marginBottom: 16 }}>This wipes all players, fixtures, training and duties for everyone using this dashboard and gives you an empty team to set up. This can't be undone.</div>
    <button className="btn danger" onClick={() => { persist({ team: { ...data.team, name: "Your Team Name" }, players: [], fixtures: [], sessions: [], isSample: false }); close(); }}>Yes, clear everything</button>
    <button className="btn ghost" style={{ marginTop: 8 }} onClick={close}>Cancel</button>
  </>);
}

function SessionSheet({ data, persist, payload: s, occ, isCoach, setModal, close }) {
  const showISO = occ || s.dateISO;
  const Icon = s.kind === "event" ? Star : Dumbbell;
  const del = () => { persist({ ...data, sessions: (data.sessions || []).filter(x => x.id !== s.id), isSample: false }); close(); };
  return (<>
    <SheetHead title={s.title} close={close} />
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <div className="ic" style={{ width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: s.kind === "event" ? "#e6f0ff" : "#fff1da", color: s.kind === "event" ? "#2563a8" : "var(--amber)" }}><Icon size={19} /></div>
      <span className={"kpill " + (s.kind || "training")}>{s.kind === "event" ? "Activity" : "Training"}</span>
    </div>

    <div className="card" style={{ marginTop: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}><CalendarDays size={15} color="var(--pitch)" /><b>{fmtDate(showISO)}</b></div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}><Clock size={15} color="var(--pitch)" />{s.time}{s.endTime ? ` – ${s.endTime}` : ""}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}><MapPin size={15} color="var(--pitch)" />{s.location
        ? <a href={mapsUrl(s.location)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--pitch)", fontWeight: 700, textDecoration: "underline" }}>{s.location}</a>
        : "—"}</div>
      {s.recur === "weekly" && (
        <div className="recur-line"><Repeat size={14} />Every {FULLDAYS[s.weekday]} during the season</div>
      )}
    </div>

    {s.notes && <div className="card"><div className="label" style={{ marginBottom: 6 }}>Notes</div><div className="note" style={{ fontSize: 13.5 }}>{s.notes}</div></div>}

    <CalAdd
      ev={sessionEv(s, showISO)}
      icsText={s.recur === "weekly" ? wrapICS(s.title, veventWeekly(s)) : undefined}
      label={s.recur === "weekly" ? "Add to your calendar (.ics adds every week)" : "Add to your calendar"}
    />
    {s.recur === "weekly" && <div className="note" style={{ marginTop: 6 }}>Google/Outlook buttons add this one session; the .ics adds the whole weekly series.</div>}

    {isCoach && (
      <div className="row2" style={{ marginTop: 14 }}>
        <button className="btn ghost" onClick={() => setModal({ type: "sessionEdit", payload: s })}>Edit</button>
        <button className="btn danger" onClick={del}>Delete</button>
      </div>
    )}
  </>);
}

function SessionEditSheet({ data, persist, payload, close }) {
  const blank = { id: uid(), title: "Training", kind: "training", recur: "weekly", weekday: 2, startISO: `${SEASON}-02-01`, untilISO: `${SEASON}-09-15`, dateISO: "", time: "17:30", endTime: "19:00", location: "", notes: "" };
  const [s, setS] = useState(payload ? { ...blank, ...payload } : blank);
  const save = () => {
    const exists = (data.sessions || []).some(x => x.id === s.id);
    const sessions = exists ? data.sessions.map(x => x.id === s.id ? s : x) : [...(data.sessions || []), s];
    persist({ ...data, sessions, isSample: false }); close();
  };
  const MIN = `${SEASON}-01-01`, MAX = `${SEASON}-12-31`;
  return (<>
    <SheetHead title={payload ? "Edit activity" : "Add training / activity"} close={close} />
    <div className="field"><label>Type</label>
      <div className="seg">
        <button className={s.kind === "training" ? "sel" : ""} onClick={() => setS({ ...s, kind: "training", title: s.title === "Team event" ? "Training" : s.title })}>Training</button>
        <button className={s.kind === "event" ? "sel" : ""} onClick={() => setS({ ...s, kind: "event", title: s.title === "Training" ? "Team event" : s.title })}>Activity / event</button>
      </div>
    </div>
    <div className="field"><label>Title</label><input className="inp" value={s.title} onChange={e => setS({ ...s, title: e.target.value })} /></div>
    <div className="field"><label>Location</label><input className="inp" value={s.location} onChange={e => setS({ ...s, location: e.target.value })} /></div>
    <div className="row2">
      <div className="field"><label>Start time</label><input className="inp" type="time" value={s.time} onChange={e => setS({ ...s, time: e.target.value })} /></div>
      <div className="field"><label>End time</label><input className="inp" type="time" value={s.endTime} onChange={e => setS({ ...s, endTime: e.target.value })} /></div>
    </div>

    <div className="field"><label>Repeats</label>
      <div className="seg">
        <button className={s.recur === "once" ? "sel" : ""} onClick={() => setS({ ...s, recur: "once" })}>One-off</button>
        <button className={s.recur === "weekly" ? "sel" : ""} onClick={() => setS({ ...s, recur: "weekly" })}>Weekly</button>
      </div>
    </div>

    {s.recur === "once" ? (
      <div className="field"><label>Date</label><input className="inp" type="date" min={MIN} max={MAX} value={s.dateISO} onChange={e => setS({ ...s, dateISO: e.target.value })} /></div>
    ) : (<>
      <div className="field"><label>Day of week</label>
        <select className="inp" value={s.weekday} onChange={e => setS({ ...s, weekday: +e.target.value })}>
          {[1, 2, 3, 4, 5, 6, 0].map(w => <option key={w} value={w}>{FULLDAYS[w]}</option>)}
        </select>
      </div>
      <div className="row2">
        <div className="field"><label>From</label><input className="inp" type="date" min={MIN} max={MAX} value={s.startISO} onChange={e => setS({ ...s, startISO: e.target.value })} /></div>
        <div className="field"><label>Until</label><input className="inp" type="date" min={MIN} max={MAX} value={s.untilISO} onChange={e => setS({ ...s, untilISO: e.target.value })} /></div>
      </div>
      <div className="note" style={{ marginTop: -4, marginBottom: 12 }}>Shows on every {FULLDAYS[s.weekday]} between these dates (2026 only).</div>
    </>)}

    <div className="field"><label>Notes (optional)</label><textarea className="inp" rows={2} value={s.notes} onChange={e => setS({ ...s, notes: e.target.value })} /></div>
    <button className="btn" onClick={save}>Save</button>
  </>);
}
