"use client";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Home, CalendarDays, Users, Apple, BarChart3, ShieldCheck, Plus, Pencil,
  Trash2, X, Lock, Unlock, Trophy, MapPin, Clock, ChevronRight, Check,
  Settings as SettingsIcon, Star, Goal, Info,
  Calendar, ClipboardList, ChevronLeft, Dumbbell, Repeat, Play, ExternalLink, Download, Target,
  Send, Phone, MessageSquare, Mail, Sparkles, FileText, Cake, Shirt, Flag, GripVertical,
  ChevronDown, Eye, User
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, LabelList
} from "recharts";
// Pure data/display helpers live in lib/dashboardData.js so they can be unit
// tested; everything below (ICS export, components) uses them from here.
import {
  isoLocal, SEASON, addDays, computeStats, nextFixture, isPastGame, fmtDate,
  countdown, ytId, videoKind, mapsUrl, activeOn, intlPhone, recentChanges,
  initials, secToClock, clockToSec, occurrences, monthItems, upcomingItems,
  nextBirthdays
} from "@/lib/dashboardData";
import MatchDayPlanner from "@/components/MatchDayPlanner";
import { parsePlayerImport } from "@/lib/majestri";
import { teamFeatures, teamParentsSee, PARENTS_SEE_LABELS, PARENTS_SEE_GROUPS, teamRules } from "@/lib/teamSetup";
import {
  FORMATION_PRESETS, fallbackFormation, defaultFormatForAgeGroup, resolveFormat, parseFormation,
  makePositions, computeAutoSubs, computeSegments, sanitizeAssignments, rosterForFixture
} from "@/lib/planner";
import { shapeCall } from "@/lib/shapes";
import { downscaleImage } from "@/lib/clientImage";
import { hatLabel, joinNames as joinKidNames } from "@/lib/hats";

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
// computeStats, nextFixture, isPastGame, fmtDate, countdown, ytId, videoKind,
// mapsUrl, activeOn, intlPhone and recentChanges now live in lib/dashboardData.js.

// Per-device "who's responding" identity. On the deployed site a small shim
// (window.identityGet/Set) persists this in a cookie; in the preview it's
// session-only. We never store credentials — this scopes editing and stamps
// responses, gated behind the team code parents already hold.
function readIdentity() {
  try { return (typeof window !== "undefined" && window.identityGet) ? window.identityGet() : null; } catch { return null; }
}
function saveIdentity(v) {
  try { if (typeof window !== "undefined" && window.identitySet) window.identitySet(v); } catch {}
}
const fmtWhen = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("en-AU", { weekday: "short" }) + " " + d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
};

// Extract text from a PDF in the browser via pdf.js (loaded from CDN on demand).
// We store the extracted text (not the PDF) so the Ask feature stays small/fast.
let _pdfjs;
function ensurePdfjs() {
  return new Promise((resolve, reject) => {
    if (_pdfjs) return resolve(_pdfjs);
    if (typeof window !== "undefined" && window.pdfjsLib) {
      _pdfjs = window.pdfjsLib;
      _pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      return resolve(_pdfjs);
    }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      _pdfjs = window.pdfjsLib;
      _pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(_pdfjs);
    };
    s.onerror = () => reject(new Error("Could not load the PDF reader"));
    document.head.appendChild(s);
  });
}
async function pdfToText(file) {
  const pdfjsLib = await ensurePdfjs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const c = await page.getTextContent();
    text += c.items.map(i => i.str).join(" ") + "\n";
  }
  return text.replace(/\s+\n/g, "\n").trim();
}

// Staff list, tolerant of the older flat team fields.
function getStaff(team) {
  if (Array.isArray(team.staff)) return team.staff;
  return [
    { role: "Head coach", name: team.headCoach || "", mobile: team.headCoachContact || "", email: "", photo: "" },
    { role: "Assistant coach", name: team.assistantCoach || "", mobile: team.assistantCoachContact || "", email: "", photo: "" },
    { role: "Manager", name: team.manager || "", mobile: team.managerContact || "", email: "", photo: "" }
  ].filter(s => s.name);
}

// downscaleImage moved to lib/clientImage.js (shared with the /admin wizard).
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; // JS getDay order
const FULLDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// occurrences, monthItems, upcomingItems and nextBirthdays now live in
// lib/dashboardData.js.

/* ============================================================
   CALENDAR EXPORT (.ics + Google/Outlook add links)
   No backend: these hand events to the user's calendar app.
   Times are treated as Brisbane local.
============================================================ */
const TZ = "Australia/Brisbane";
const pad2 = (n) => String(n).padStart(2, "0");
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
  (data.players || []).forEach(p => {
    if (!p.dob || p.dob.length < 10) return;
    const iso = `${SEASON}-${p.dob.slice(5, 10)}`;
    if (isNaN(new Date(iso + "T00:00:00"))) return;
    if (!activeOn(p, iso)) return;
    const by = parseInt(p.dob.slice(0, 4), 10);
    const title = by > 1990 ? `🎂 ${p.name} turns ${SEASON - by}` : `🎂 ${p.name}'s birthday`;
    body.push(...vevent({ uid: "bday" + p.id, title, dateISO: iso, allDay: true }));
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
.head .htop{display:flex;align-items:center;gap:12px;}
.head .hlogo{width:46px;height:46px;object-fit:contain;flex-shrink:0;
  filter:drop-shadow(0 2px 6px rgba(0,0,0,.35));}
.head .kicker{font-size:11px;letter-spacing:.18em;color:var(--lime);text-transform:uppercase;font-weight:700;}
.head .tname{font-size:30px;line-height:.95;margin:4px 0 2px;}
.head .sub{font-size:12px;color:rgba(255,255,255,.7);font-weight:500;}
.coachbtn{position:absolute;top:18px;right:18px;display:flex;align-items:center;gap:6px;
  background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);color:#fff;
  padding:7px 11px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;}
.coachbtn.on{background:var(--lime);color:var(--pitch-d);border-color:var(--lime);}
.whoami{position:absolute;top:52px;right:18px;display:flex;align-items:center;gap:5px;
  background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;
  padding:5px 10px;border-radius:999px;font-size:11px;font-weight:600;cursor:pointer;}
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
.pnum.photo{object-fit:cover;}
.numbadge{position:absolute;bottom:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;
  background:var(--pitch);color:#fff;font-family:'Anton';font-size:11px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;}
.crest{width:30px;height:30px;object-fit:contain;flex-shrink:0;vertical-align:middle;}
.crest-lg{width:40px;height:40px;object-fit:contain;flex-shrink:0;}
.askmsg{padding:11px 14px;border-radius:14px;margin-bottom:10px;font-size:14px;line-height:1.5;max-width:90%;white-space:pre-wrap;}
.askmsg.you{background:var(--pitch);color:#fff;margin-left:auto;border-bottom-right-radius:4px;}
.askmsg.bot{background:var(--soft);color:var(--ink);border-bottom-left-radius:4px;}
.askmsg.bot .src{display:block;margin-top:6px;font-size:11px;color:var(--muted);}
.askchip{display:inline-block;background:var(--soft);border:1px solid var(--line);border-radius:999px;
  padding:7px 12px;font-size:12.5px;margin:0 6px 8px 0;cursor:pointer;color:var(--ink);}
.kdoc{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);}
.kdoc:last-child{border-bottom:none;}
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
.cdot.game{background:var(--pitch);} .cdot.training{background:var(--amber);} .cdot.event{background:#2563a8;} .cdot.birthday{background:#d6409f;}
.daycell.sel .cdot.game{background:var(--lime);} .daycell.sel .cdot.training{background:#ffd27a;} .daycell.sel .cdot.event{background:#9cc2f5;}
.legend{display:flex;gap:16px;justify-content:center;margin-top:14px;font-size:11px;color:var(--muted);font-weight:600;}
.legend span{display:flex;align-items:center;gap:6px;}
.agenda-title{display:flex;align-items:center;gap:8px;margin:6px 2px 4px;}
.agenda-title .disp{font-size:16px;}
.agitem{display:flex;align-items:stretch;gap:11px;padding:12px 2px;border-bottom:1px solid var(--line);cursor:pointer;}
.agitem:last-child{border-bottom:none;}
.agbar{width:4px;border-radius:3px;flex-shrink:0;}
.agbar.game{background:var(--pitch);} .agbar.training{background:var(--amber);} .agbar.event{background:#2563a8;} .agbar.birthday{background:#d6409f;}
.agtime{width:50px;font-family:'DM Mono';font-size:12px;color:var(--muted);flex-shrink:0;padding-top:1px;}
.kpill{font-size:9px;font-weight:800;padding:2px 6px;border-radius:5px;text-transform:uppercase;letter-spacing:.04em;}
.kpill.game{background:#fdeaec;color:var(--pitch);} .kpill.training{background:#fff1da;color:#b3760a;} .kpill.event{background:#e6f0ff;color:#2563a8;} .kpill.birthday{background:#fde7f3;color:#d6409f;}
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
.staffrow{display:flex;gap:12px;padding:12px 2px;border-bottom:1px solid var(--line);align-items:flex-start;}
.staffrow:last-child{border-bottom:none;}
.savatar{width:48px;height:48px;border-radius:50%;flex-shrink:0;object-fit:cover;background:var(--pitch);
  color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;}
.staffrole{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--pitch);}
/* Squadi-style results rows (home · score · away) */
.sqrow{padding:13px 4px;border-bottom:1px solid var(--line);cursor:pointer;}
.sqrow:last-child{border-bottom:none;}
.sqmatch{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;}
.sqteam{display:flex;align-items:center;gap:9px;min-width:0;}
.sqteam.away{flex-direction:row-reverse;text-align:right;}
.sqcrest{width:34px;height:34px;border-radius:9px;flex:0 0 34px;object-fit:contain;background:#fff;}
.sqcrest-ph{display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:var(--muted);background:var(--soft);}
.sqname{flex:1;min-width:0;font-weight:700;font-size:14.5px;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.squs .sqname{color:var(--pitch);}
.squs .sqcrest{box-shadow:0 0 0 2px #fff,0 0 0 4px rgba(200,16,46,.25);}
.sqscore{font-family:'Anton';font-size:23px;line-height:1;padding:4px 10px;border-radius:9px;white-space:nowrap;min-width:58px;text-align:center;}
.sqscore.win{color:var(--win);background:rgba(30,158,87,.10);}
.sqscore.loss{color:var(--red);background:rgba(229,72,77,.09);}
.sqscore.draw{color:var(--muted);background:rgba(107,90,93,.10);}
.sqscore.state{font-family:'DM Sans',sans-serif;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:6px 9px;}
.sqscore.up{color:var(--amber);background:rgba(246,166,35,.12);}
.sqscore.canc{color:var(--red);background:rgba(229,72,77,.10);}
.sqscore.none{color:var(--muted);background:var(--soft);}
.sqmeta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;}
.sqwhen{flex:1;min-width:0;font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sqwhen b{color:#56535a;font-weight:700;}
.sqtags{display:flex;align-items:center;gap:6px;flex:0 0 auto;}
.sqtag{font-size:9.5px;font-weight:800;letter-spacing:.04em;padding:3px 7px;border-radius:999px;white-space:nowrap;text-transform:uppercase;}
.sqtag.ha{background:#f0ebed;color:#6b6770;}
.sqtag.watch{background:rgba(200,16,46,.10);color:var(--pitch);}
.sqtag.upd{background:var(--red);color:#fff;}
.sqrow.canc .sqname,.sqrow.canc .sqcrest{opacity:.5;}
/* Match-day hub stage strip */
.stages{display:grid;grid-template-columns:repeat(4,1fr);margin:14px 0 4px;position:relative}
.stages::before{content:"";position:absolute;left:12.5%;right:12.5%;top:13px;height:2px;background:var(--line)}
.stg{position:relative;text-align:center;font-size:11px;font-weight:700;color:var(--muted)}
.stg .dot{width:28px;height:28px;border-radius:50%;margin:0 auto 6px;display:flex;align-items:center;justify-content:center;background:var(--soft);color:var(--muted);position:relative;z-index:1;border:2px solid var(--paper)}
.stg.done .dot{background:#e6f6ec;color:var(--win)} .stg.now .dot{background:var(--pitch);color:#fff} .stg.now{color:var(--ink)}
.stg .st{display:block;font-weight:500;font-size:10.5px;color:var(--muted);margin-top:2px;line-height:1.3} .stg.now .st{color:var(--pitch);font-weight:700}
.rdot{position:absolute;width:9px;height:9px;border-radius:50%;background:var(--red);border:2px solid #fff;top:-3px;right:-3px}
.sw{width:38px;height:22px;border-radius:999px;background:#D9D3D4;position:relative;flex-shrink:0;transition:background .18s}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .18s cubic-bezier(.2,.8,.2,1)}
.sw.on{background:var(--pitch)} .sw.on::after{transform:translateX(16px)}
.pips{display:flex;gap:6px;flex:1} .pips i{width:26px;height:26px;border-radius:50%;background:var(--soft);display:block} .pips i.on{background:var(--pitch)}
.coachonly{display:inline-flex;align-items:center;gap:5px;background:#fdeaec;color:var(--pitch);border-radius:999px;padding:4px 9px;font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}
/* small helpers for the coach settings cards and ratings */
button.sw{border:none;padding:0;cursor:pointer}
.pips i{cursor:pointer}
.swrow{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)} .swrow:last-child{border-bottom:none}
.rule{display:flex;align-items:center;gap:9px;padding:9px 0;border-bottom:1px solid var(--line)} .rule .n{width:22px;font-family:'Anton';font-size:15px;color:var(--muted);text-align:center} .rule .bi{font-size:9.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;background:var(--soft);color:var(--muted);border-radius:999px;padding:2px 7px} .rule.off{opacity:.5} .rdotwrap{position:relative;display:inline-block}
`;

/* ============================================================
   SHARED BITS FOR THE COACH FEATURES
   Nothing here touches window.storage: every write goes through its own
   narrow JSON route (team-settings, player-coach, plan).
============================================================ */
// POST a JSON body; resolves to the parsed response and throws (with the
// server's error message when it sent one) on a non-2xx status.
async function fetchJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(json?.error || ("Request failed (" + res.status + ")"));
    err.status = res.status;
    throw err;
  }
  return json;
}
const SAVE_ERROR = "Couldn't save — try again.";
// A refusal (403: read-only view-as, or not a coach) carries a message written
// for the user; anything else is a transient failure worth retrying.
const saveErrorText = (e) => (e?.status === 403 && e.message ? e.message : SAVE_ERROR);
const MAX_RULES = 20;

function Switch({ on, label, onClick, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} disabled={disabled}
      className={"sw" + (on ? " on" : "")} onClick={onClick} />
  );
}

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";
// "Seyjan" / "Seyjan and Milo" / "Seyjan, Milo and Ada"
const joinNames = (names) => names.length <= 1 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];

// Where a fixture sits on the Availability -> Plan -> Live -> Record path.
// Pure (reads only the team document) so the MatchSheet hub renders straight
// from data and tests can drive every state through the UI.
function matchDayStages(data, f, todayISO) {
  // Availability follows rosterForFixture: an RSVP or a coach override in the
  // planner (plan.overrides) settles a player, so the red dot and the "hasn't
  // replied" line drop the moment the coach marks a no-reply player in or out.
  const roster = rosterForFixture(data, f, f.plan?.overrides || {});
  const byId = Object.fromEntries((data?.players || []).map((p) => [p.id, p]));
  const counts = { in: 0, out: 0, nr: 0 };
  const noReply = [];
  roster.forEach((r) => {
    if (r.noReply) { counts.nr++; noReply.push(byId[r.id] || r); }
    else if (r.available) counts.in++;
    else counts.out++;
  });
  const availDone = roster.length > 0 && counts.nr === 0;

  const format = resolveFormat(data, f);
  const outfield = (Number(format.playersOnField) || 0) - (format.hasGK ? 1 : 0);
  let rows = parseFormation(format.formation);
  if (rows.reduce((s, n) => s + n, 0) !== outfield) rows = parseFormation(fallbackFormation(outfield));
  const positions = makePositions(rows, !!format.hasGK);
  const subTimes = f.plan?.subTimes ?? computeAutoSubs(format.gameLength, format.periods, format.subInterval);
  const segments = computeSegments(format.gameLength, format.periods, subTimes);
  const blocks = sanitizeAssignments(f.plan?.assignments, segments, positions, roster);
  const rawBlocks = Array.isArray(f.plan?.assignments) ? f.plan.assignments : null;
  const planExists = !!rawBlocks && rawBlocks.some((b) => Object.keys(b || {}).length > 0);
  const planDone = !!rawBlocks && blocks.length > 0 && blocks.every((b) => positions.every((p) => !!b[p.key]));
  const planState = planDone ? "done" : planExists ? "now" : "upcoming";

  const hasRecord = !!f.record;
  const isToday = !!f.dateISO && f.dateISO === todayISO;
  return {
    counts, noReply, isToday,
    stages: [
      {
        key: "availability", name: "Availability", state: availDone ? "done" : "now",
        sub: availDone ? `${counts.in} in · ${counts.out} out` : `${counts.in} in · ${counts.out} out · ${counts.nr} no reply`
      },
      {
        key: "plan", name: "Plan", state: planState,
        sub: planDone ? `Lineup set · ${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}` : planExists ? "Gaps to fill" : "Not started"
      },
      {
        key: "live", name: "Live", state: hasRecord ? "done" : isToday ? "now" : "upcoming",
        sub: f.time ? "Kick-off " + f.time : "Kick-off time not set"
      },
      { key: "record", name: "Record", state: hasRecord ? "done" : "upcoming", sub: hasRecord ? "Saved" : "After full time" }
    ]
  };
}

/* ============================================================
   APP
============================================================ */
export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("home");
  const [isCoach, setIsCoach] = useState(false);
  const [viewer, setViewerState] = useState(() => readIdentity() || { kind: "guest" });
  const setViewer = (v) => { setViewerState(v); saveIdentity(v); };
  const [modal, setModal] = useState(null); // {type, payload}
  // Server-side identity/role (account mode). undefined until /api/me has
  // answered; null in legacy team-code mode (or when the call failed); the
  // account payload otherwise. Nothing coach-shaped renders while undefined,
  // so a slow answer can't expose the legacy PIN toggle to a parent.
  const [me, setMe] = useState(undefined);
  // One-line status under the header: a refused write, an undone save.
  const [notice, setNotice] = useState(null);
  // Latest data for optimistic writes to roll back to (persist/savePlan are
  // stable callbacks, so they read it through a ref rather than a dep).
  const dataRef = useRef(null);
  dataRef.current = data;

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
    // In account mode the server knows who we are; use the real role instead
    // of the client-side PIN toggle (which the server would refuse anyway).
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setMe(j?.mode === "account" ? j : null))
      .catch(() => setMe(null));
  }, []);

  const saveFailed = (e) => {
    const msg = e && e.message ? String(e.message) : "";
    setNotice("Couldn't save — your change was undone." + (msg ? " " + msg : ""));
  };

  // Whole-document write. Optimistic, but undone (and announced) when storage
  // refuses; a super admin viewing as someone else never writes at all.
  const persist = useCallback(async (next) => {
    if (me?.viewingAs) { setNotice(`Read only while viewing as ${me.viewingAs}.`); return; }
    const prev = dataRef.current;
    setData(next);
    try { await window.storage.set(KEY, JSON.stringify(next), true); }
    catch (e) { console.error(e); setData(prev); saveFailed(e); }
  }, [me]);

  // Local-only patch: the narrow routes have already written the field, so
  // only React state needs to catch up (never a whole-document storage write).
  const patchLocal = useCallback((fn) => setData((d) => (d ? fn(d) : d)), []);

  // Game-plan autosave: update local state and write ONLY this fixture's plan
  // through the narrow /api/plan endpoint (never the whole team document, so a
  // mid-game save can't clobber an RSVP that landed moments earlier).
  // The plan's first-block keeper writes back to the fixture's in-goal duty
  // (gk) when the planner passes one.
  const savePlan = useCallback(async (fixtureId, plan, gk) => {
    if (me?.viewingAs) { setNotice(`Read only while viewing as ${me.viewingAs}.`); return; }
    const prev = dataRef.current;
    setData((d) => d ? {
      ...d,
      fixtures: (d.fixtures || []).map((f) => f.id === fixtureId ? { ...f, plan, ...(gk !== undefined ? { gk } : {}) } : f)
    } : d);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixtureId, plan, ...(gk !== undefined ? { gk } : {}) })
      });
      if (!res.ok) throw new Error("plan save " + res.status);
    } catch (e) { console.error("Could not save game plan:", e); setData(prev); saveFailed(e); }
  }, [me]);

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

  // Account mode: the server-resolved role decides who can even see the coach
  // toggle (parents, viewers and club admins are read-only; the server blocks
  // their writes regardless). The coach PIN is a legacy-mode device.
  const account = !!me;
  const canCoach = me === undefined ? false : (me ? me.role === "coach" : true);
  // The hat being worn on this team (account mode), for the header chip.
  const currentHat = me
    ? ((me.hats || []).find((h) => h.role === me.role) || { role: me.role, playerNames: me.playerNames, staffRole: me.staffRole, admin: me.admin })
    : null;
  const hatText = me ? (me.role || !me.admin ? hatLabel(currentHat) : "Super admin") : "";
  const toggleCoach = () => {
    if (isCoach) { setIsCoach(false); return; }
    if (me) { if (me.role === "coach") setIsCoach(true); return; } // verified server-side, no PIN
    if (data.team.coachPin) setModal({ type: "pin" });
    else setIsCoach(true);
  };

  const exitViewAs = async () => {
    try { await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clearViewAs" }) }); } catch {}
    window.location.href = "/";
  };

  return (
    <div className="fqd">
      <style>{CSS}</style>

      {me?.viewingAs && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 400, background: "#E07B1F", color: "#fff", fontFamily: "system-ui,sans-serif", fontWeight: 700, fontSize: 12.5, padding: "8px 12px", display: "flex", justifyContent: "center", alignItems: "center", gap: 12, boxShadow: "0 2px 10px rgba(0,0,0,.25)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Eye size={14} />Viewing as {me.viewingAs} — read only</span>
          <button onClick={exitViewAs} style={{ background: "#fff", color: "#E07B1F", border: "none", borderRadius: 999, padding: "3px 12px", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>Exit</button>
        </div>
      )}

      <div className="head">
        <div className="htop">
          {(data.team.logo || true) && (
            <img className="hlogo" src={data.team.logo || "/logo.png"} alt=""
              onError={(e) => { e.currentTarget.style.display = "none"; }} />
          )}
          <div style={{ minWidth: 0 }}>
            <div className="kicker">{data.team.division} · {data.team.ageGroup}</div>
            <div className="tname">{data.team.name}</div>
            <div className="sub">{(() => {
              const st = getStaff(data.team);
              const hc = st.find(s => /head/i.test(s.role))?.name || data.team.headCoach;
              const ac = st.find(s => /assist/i.test(s.role))?.name || data.team.assistantCoach;
              return [hc && `Coach ${hc}`, ac && `Asst ${ac}`].filter(Boolean).join(" · ");
            })()}{me?.admin && (
              <a href="/admin" style={{ color: "inherit", fontWeight: 700, marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 3, textDecoration: "none", borderBottom: "1px solid rgba(255,255,255,.4)" }}>
                <SettingsIcon size={11} />Club admin
              </a>
            )}</div>
          </div>
        </div>
        {canCoach && (
          <button className={"coachbtn" + (isCoach ? " on" : "")} onClick={toggleCoach}>
            {isCoach ? <Unlock size={13} /> : <Lock size={13} />}{isCoach ? "Coach" : "View"}
          </button>
        )}
        {account ? (
          me.canSwitch ? (
            <button className="whoami" aria-label="Switch team or role" onClick={() => setModal({ type: "hats" })}>
              <User size={12} /><span>Viewing as {hatText}</span><ChevronDown size={12} />
            </button>
          ) : (
            <span className="whoami" style={{ cursor: "default" }}>
              <User size={12} /><span>Viewing as {hatText}</span>
            </span>
          )
        ) : (me === null && !isCoach && (
          <button className="whoami" onClick={() => setModal({ type: "signin" })}>
            {viewer.kind === "parent" ? <><User size={12} />{viewer.label}</> : "Sign in to respond"}
          </button>
        ))}
      </div>

      <div className="wrap">
        {notice && (
          <div className="banner" role="status">
            <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{notice}</span>
            <button aria-label="Dismiss" onClick={() => setNotice(null)} style={{ padding: "4px 6px", display: "flex" }}><X size={14} /></button>
          </div>
        )}
        {data.isSample && (
          <div className="banner">
            <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>This is example data so you can see the layout. Switch to <b>Coach</b> mode (top right) to edit your real squad, fixtures and duties.</span>
          </div>
        )}

        {tab === "home" && <HomeTab {...{ data, stats, next, pname, setModal, viewer }} />}
        {tab === "calendar" && <CalendarTab {...{ data, isCoach, setModal }} />}
        {tab === "fixtures" && <FixturesTab {...{ data, isCoach, pname, setModal, persist }} />}
        {tab === "squad" && <SquadTab {...{ data, stats, isCoach, setModal, persist }} />}
        {tab === "duties" && <DutiesTab {...{ data, isCoach, pname, setModal }} />}
        {tab === "stats" && <StatsTab {...{ data, stats, pname }} />}
        {tab === "ask" && <AskTab {...{ data, viewer, isCoach, account }} />}
        {tab === "settings" && <SettingsTab {...{ data, isCoach, persist, patchLocal, setIsCoach, setModal, account }} />}
      </div>

      <nav className="nav" style={{ padding: "8px 2px" }}>
        {[["home", Home, "Home"], ["calendar", Calendar, "Calendar"], ["fixtures", ClipboardList, "Results"],
        ["squad", Users, "Squad"], ["duties", Apple, "Duties"], ["stats", BarChart3, "Stats"], ["ask", Sparkles, "Ask"],
        ...(isCoach ? [["settings", SettingsIcon, "Settings"]] : [])].map(([id, Ic, lbl]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)} style={{ fontSize: 8.5 }}>
            <Ic size={18} /><span>{lbl}</span>
          </button>
        ))}
      </nav>

      {modal && modal.type === "plan" ? (
        <MatchDayPlanner
          data={data}
          fixture={(data.fixtures || []).find((x) => x.id === modal.payload?.id) || modal.payload}
          isCoach={isCoach}
          onSavePlan={savePlan}
          close={() => setModal(null)}
        />
      ) : modal ? (
        <Modal {...{ modal, setModal, data, persist, patchLocal, isCoach, setIsCoach, viewer, setViewer, me }} />
      ) : null}
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
  const week = upcomingItems(data, isoLocal(new Date()), 7);
  const bdays = nextBirthdays(data, isoLocal(new Date()), 2);
  const weekCounts = (av, iso) => data.players.filter(p => activeOn(p, iso)).reduce((c, p) => {
    const st = av?.[p.id]?.status; if (st === "in") c.in++; else if (st === "out") c.out++; else c.nr++; return c;
  }, { in: 0, out: 0, nr: 0 });
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

      {next && (() => {
        // Duty tiles honour the team's feature flags (wizard/Settings).
        const feats = teamFeatures(data.team);
        const tiles = [
          feats.fruitDuty && { cls: "fruit", Icon: Apple, label: "Fruit duty", who: pname(next.fruit) },
          feats.gkDuty && { cls: "gk", Icon: ShieldCheck, label: "In goal", who: pname(next.gk) },
          feats.jerseyDuty && { cls: "fruit", Icon: Shirt, label: "Jerseys", who: pname(next.jersey) }
        ].filter(Boolean);
        if (!tiles.length) return null;
        return (
          <div className="duties">
            {tiles.map(({ cls, Icon, label, who }) => (
              <div className={"duty " + cls} key={label}>
                <div className="ic"><Icon size={18} /></div>
                <div className="label">{label}</div>
                <div className="who">{who}</div>
                <div className="rnd">Round {next.round}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {next && counts && activePlayers.length > 0 && (
        <div className="card" onClick={() => setModal({ type: "match", payload: next })} style={{ cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
            {next.opponentLogo && <img className="crest" src={next.opponentLogo} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ marginTop: 2 }} />}
            <div style={{ minWidth: 0 }}>
              <div className="label">Who's playing?</div>
              <div style={{ fontWeight: 800, fontSize: 16, marginTop: 3 }}>
                Round {next.round} {next.homeAway === "H" ? "vs" : "@"} {next.opponent}
              </div>
              <div className="note" style={{ marginTop: 2, display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
                <span><CalendarDays size={12} style={{ verticalAlign: "-2px" }} /> {fmtDate(next.dateISO)} · {next.time}</span>
                {next.venue && <span><MapPin size={12} style={{ verticalAlign: "-2px" }} /> {next.venue}</span>}
                {next.strip && <span style={{ fontWeight: 800, color: next.strip === "Blue" ? "#2563a8" : "var(--pitch)" }}>👕 {next.strip} strip</span>}
              </div>
            </div>
            <ChevronRight size={15} color="var(--muted)" style={{ marginLeft: "auto", flexShrink: 0, marginTop: 3 }} />
          </div>
          <div className="avsum" style={{ marginBottom: 0 }}>
            <span className="avpill in"><Check size={13} />{counts.in} in</span>
            <span className="avpill out"><X size={13} />{counts.out} out</span>
            <span className="avpill nr">{counts.nr} no reply</span>
          </div>
          {counts.nr > 0 && <div className="note" style={{ marginTop: 8 }}>Tap to mark your player in or out.</div>}
        </div>
      )}

      {week.length > 0 && (
        <div className="card">
          <div className="label" style={{ marginBottom: 4 }}>Next 7 days</div>
          {week.map(it => {
            const isGame = it.kind === "game";
            const isBday = it.kind === "birthday";
            const av = isGame ? it.ref.availability : (it.ref.availability && it.ref.availability[it.occ]);
            const c = isBday ? null : weekCounts(av, it.dateISO);
            const d = new Date(it.dateISO + "T00:00:00");
            const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
            const Ic = isGame ? Trophy : isBday ? Cake : it.kind === "event" ? Star : Dumbbell;
            const place = isGame ? it.ref.venue : isBday ? "" : it.ref.location;
            const title = isGame ? ((it.ref.homeAway === "H" ? "vs " : "@ ") + it.ref.opponent) : it.title;
            const cancelled = isGame && it.ref.status === "cancelled";
            const open = () => isGame ? setModal({ type: "match", payload: it.ref })
              : isBday ? setModal({ type: "playerView", payload: it.ref })
              : setModal({ type: "session", payload: it.ref, occ: it.occ });
            return (
              <div key={it.key}
                onClick={open}
                style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderTop: "1px solid var(--line)", cursor: "pointer" }}>
                <div style={{ width: 36, textAlign: "center", flexShrink: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>{dow}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{d.getDate()}</div>
                </div>
                <div className="ic" style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: isGame ? "#fdeaec" : isBday ? "#fde7f3" : it.kind === "event" ? "#e6f0ff" : "#fff1da", color: isGame ? "var(--pitch)" : isBday ? "#d6409f" : it.kind === "event" ? "#2563a8" : "#b3760a" }}>
                  <Ic size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: cancelled ? "line-through" : "none", color: cancelled ? "var(--muted)" : "inherit" }}>{title}</div>
                  {isBday ? (
                    <div className="note" style={{ fontSize: 11.5, marginTop: 1 }}>Birthday 🎂</div>
                  ) : (<>
                    <div className="note" style={{ fontSize: 11.5, marginTop: 1 }}>{it.time || "Time TBC"}{place ? " · " + place : ""}</div>
                    {cancelled
                      ? <div style={{ fontSize: 11, marginTop: 3, fontWeight: 800, color: "var(--red)" }}>Cancelled</div>
                      : <div style={{ fontSize: 11, marginTop: 3, display: "flex", gap: 9, fontWeight: 700 }}>
                        <span style={{ color: "#1f8a4c" }}>{c.in} in</span>
                        <span style={{ color: "var(--red)" }}>{c.out} out</span>
                        <span style={{ color: "var(--muted)" }}>{c.nr} no reply</span>
                      </div>}
                  </>)}
                </div>
                <ChevronRight size={15} color="var(--muted)" style={{ flexShrink: 0 }} />
              </div>
            );
          })}
        </div>
      )}

      {bdays.length > 0 && (
        <div className="card">
          <div className="label" style={{ marginBottom: 4 }}>Upcoming birthdays</div>
          {bdays.map(({ p, iso, age }) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderTop: "1px solid var(--line)" }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "#fde7f3", fontSize: 16 }}>🎂</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}{age != null ? ` turns ${age}` : ""}</div>
                <div className="note" style={{ fontSize: 11.5, marginTop: 1 }}>{fmtDate(iso)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {next && teamFeatures(data.team).focus && <FocusCard f={next} />}

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
// One-tap calendar subscription. The feed URL comes from the website's
// /api/feedinfo endpoint; in environments without it (e.g. the chat artifact)
// the card simply doesn't render.
function SubscribeCard() {
  const [feed, setFeed] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetch("/api/feedinfo", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.feedUrl) setFeed(j.feedUrl); })
      .catch(() => {});
  }, []);
  if (!feed) return null;
  const webcal = feed.replace(/^https?:/, "webcal:");
  const copy = () => { navigator.clipboard?.writeText(feed); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="card">
      <div className="label" style={{ marginBottom: 6 }}>Subscribe to the team calendar</div>
      <div className="note" style={{ marginBottom: 10 }}>
        Subscribe once and every game, training, birthday — and any schedule change — updates in your own calendar automatically. Better than importing: it stays in sync.
      </div>
      <div className="chips">
        <a className="chip lnk" target="_blank" rel="noopener noreferrer"
          href={"https://calendar.google.com/calendar/render?cid=" + encodeURIComponent(webcal)}>
          <Calendar size={13} />Google Calendar
        </a>
        <a className="chip lnk" target="_blank" rel="noopener noreferrer"
          href={"https://outlook.office.com/calendar/0/addfromweb?url=" + encodeURIComponent(feed) + "&name=" + encodeURIComponent("Team Calendar")}>
          <Calendar size={13} />Outlook
        </a>
        <a className="chip lnk" href={webcal}><Calendar size={13} />Apple / other</a>
        <button className="chip" onClick={copy}><Check size={13} />{copied ? "Copied!" : "Copy link"}</button>
      </div>
      <div className="note" style={{ marginTop: 8, fontSize: 11 }}>
        Calendars refresh on their own schedule (typically a few hours). Treat the link as team-private.
      </div>
    </div>
  );
}

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
    : it.kind === "birthday"
      ? setModal({ type: "playerView", payload: it.ref })
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
          <span><span className="cdot birthday" />Birthday</span>
        </div>
      </div>

      <SubscribeCard />

      <button className="btn ghost" style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        onClick={() => downloadICS(`${data.team.name}-${SEASON}-season.ics`, seasonICS(data))}>
        <Download size={16} />One-off download (.ics) instead
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
              <span className={"kpill " + it.kind}>{it.kind === "game" ? "Game" : it.kind === "training" ? "Train" : it.kind === "birthday" ? "🎂" : "Event"}</span>
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
  const usName = data.team.name;
  const usLogo = data.team.logo || "/logo.png";

  // Crest as image when we have one, else a soft tile with the team's initials.
  const crest = (logo, name) => logo
    ? <img className="sqcrest" src={logo} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
    : <span className="sqcrest sqcrest-ph">{initials(name)}</span>;

  return (
    <>
      {isCoach && <button className="addfab" onClick={() => setModal({ type: "fixture", payload: null })}><Plus size={17} />Add fixture</button>}
      <div className="card" style={{ padding: "2px 12px" }}>
        {fixtures.length === 0 && <div className="empty"><div className="disp">No fixtures yet</div></div>}
        {fixtures.map(f => {
          const home = f.homeAway === "H";
          const won = f.us > f.them, drew = f.us === f.them;
          const hasVid = !!videoKind(f.video);
          const updated = recentChanges(f).length > 0;
          const cancelled = f.status === "cancelled";
          // Home team sits left, away right — flip when Olympic is away.
          const homeName = home ? usName : f.opponent;
          const awayName = home ? f.opponent : usName;
          const homeLogo = home ? usLogo : (f.opponentLogo || "");
          const awayLogo = home ? (f.opponentLogo || "") : usLogo;
          const hs = home ? f.us : f.them;
          const as = home ? f.them : f.us;
          return (
            <div className={"sqrow" + (cancelled ? " canc" : "")} key={f.id} onClick={() => setModal({ type: "match", payload: f })}>
              <div className="sqmatch">
                <div className={"sqteam" + (home ? " squs" : "")}>
                  {crest(homeLogo, homeName)}
                  <span className="sqname">{homeName}</span>
                </div>
                {cancelled
                  ? <div className="sqscore state canc">Canc</div>
                  : f.us != null
                  ? <div className={"sqscore " + (won ? "win" : drew ? "draw" : "loss")}>{hs}–{as}</div>
                  : isPastGame(f)
                    ? <div className="sqscore state none">No score</div>
                    : <div className="sqscore state up">Upcoming</div>}
                <div className={"sqteam away" + (!home ? " squs" : "")}>
                  {crest(awayLogo, awayName)}
                  <span className="sqname">{awayName}</span>
                </div>
              </div>
              <div className="sqmeta">
                <span className="sqwhen"><b>Round {f.round}</b> · {fmtDate(f.dateISO)}{f.time ? " · " + f.time : ""}</span>
                <div className="sqtags">
                  {hasVid && <span className="sqtag watch">▶ Watch</span>}
                  {updated && <span className="sqtag upd">Updated</span>}
                  <span className="sqtag ha">{home ? "Home" : "Away"}</span>
                  {isCoach && (<>
                    <button className="iconbtn" style={{ width: 28, height: 28 }} onClick={(e) => { e.stopPropagation(); setModal({ type: "fixture", payload: f }); }}><Pencil size={13} /></button>
                    <button className="iconbtn" style={{ width: 28, height: 28 }} onClick={(e) => { e.stopPropagation(); del(f.id); }}><Trash2 size={13} /></button>
                  </>)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------------- SQUAD ---------------- */
function StaffStrip({ team }) {
  const staff = getStaff(team).filter(s => s.name);
  if (!staff.length) return null;
  return (
    <div className="card" style={{ padding: "4px 14px" }}>
      <div className="label" style={{ margin: "10px 2px 4px" }}>Team staff</div>
      {staff.map((s, i) => (
        <div className="staffrow" key={i}>
          {s.photo ? <img className="savatar" src={s.photo} alt={s.name} /> : <div className="savatar">{initials(s.name)}</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="staffrole">{s.role}</div>
            <div style={{ fontWeight: 700, fontSize: 15.5 }}>{s.name}</div>
            <div className="chips" style={{ marginTop: 7 }}>
              {s.mobile && <a className="washare" href={`https://wa.me/${intlPhone(s.mobile)}`} target="_blank" rel="noopener noreferrer"><Send size={13} />WhatsApp</a>}
              {s.mobile && <a className="chip lnk" href={"tel:" + s.mobile.replace(/\s+/g, "")}><Phone size={13} />Call</a>}
              {s.mobile && <a className="chip lnk" href={"sms:" + s.mobile.replace(/\s+/g, "")}><MessageSquare size={13} />Text</a>}
              {s.email && <a className="chip lnk" href={"mailto:" + s.email}><Mail size={13} />Email</a>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

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
      <StaffStrip team={data.team} />
      {isCoach && <>
        <button className="addfab" onClick={() => setModal({ type: "player", payload: null })}><Plus size={17} />Add player</button>
        <button className="btn ghost" style={{ marginTop: -6, marginBottom: 14 }} onClick={() => setModal({ type: "playersImport" })}>Paste player list (bulk import)</button>
      </>}
      <div className="card" style={{ padding: "6px 14px" }}>
        {players.length === 0 && <div className="empty"><div className="disp">No players yet</div></div>}
        {players.map(p => {
          const s = sm[p.id] || { goals: 0, assists: 0 };
          const ended = p.guest && p.untilISO && todayISO > p.untilISO;
          return (
            <div className="pcard" key={p.id} onClick={() => setModal({ type: "playerView", payload: p })}>
              <div style={{ position: "relative", flexShrink: 0 }}>
                {p.photo
                  ? <img className="pnum photo" src={p.photo} alt={p.name} />
                  : <div className="pnum" style={p.guest ? { background: "#2563a8" } : undefined}>{p.number}</div>}
                {p.photo && <span className="numbadge">{p.number}</span>}
              </div>
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
  const feats = teamFeatures(data.team);
  const sections = [
    feats.fruitDuty && { key: "fruit", label: "Fruit duty", Icon: Apple, color: "var(--amber)" },
    feats.gkDuty && { key: "gk", label: "Goalkeeper", Icon: ShieldCheck, color: "var(--pitch)" },
    feats.jerseyDuty && { key: "jersey", label: "Jersey washing", Icon: Shirt, color: "var(--pitch)" }
  ].filter(Boolean);
  if (!sections.length) {
    return (
      <div className="card"><div className="empty"><div className="disp">Duties are turned off</div><div className="note">Fruit, jersey and goalkeeper duty can be switched on for this team from the club admin page.</div></div></div>
    );
  }
  return (
    <>
      <div className="card">
        <div className="label" style={{ marginBottom: 4 }}>Roster</div>
        <div className="note">{sections.map(s => s.label).join(", ")} by round. {isCoach ? "Tap a round to assign." : "Tap into Coach mode to edit."}</div>
      </div>
      {sections.map(({ key, label, Icon, color }) => (
        <div key={key}>
          <div className="section-title"><Icon size={16} color={color} /><div className="disp">{label}</div></div>
          <div className="card" style={{ padding: "6px 14px" }}>
            {fixtures.map(f => (
              <div className="dutyrow" key={f.id} onClick={() => isCoach && setModal({ type: "fixture", payload: f })} style={{ cursor: isCoach ? "pointer" : "default" }}>
                <div className="rbadge">{f.round}</div>
                <div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{pname(f[key])}</div><div className="note">{fmtDate(f.dateISO)} · vs {f.opponent}</div></div>
                {isCoach && <ChevronRight size={16} color="var(--muted)" />}
              </div>
            ))}
          </div>
        </div>
      ))}
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
function KnowledgeEditor({ data, persist, isCoach }) {
  const docs = data.knowledge || [];
  const [busy, setBusy] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pName, setPName] = useState(""); const [pText, setPText] = useState("");

  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");

  const addUrl = async () => {
    if (!url.trim()) return;
    setBusy("Fetching page…");
    try {
      const res = await fetch("/api/fetchdoc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim() }) });
      const j = await res.json();
      if (!res.ok) { setBusy(j.error || "Couldn't fetch that page."); return; }
      saveDocs([...docs, { id: uid(), name: j.name, text: j.text, chars: j.text.length, sourceUrl: url.trim(), addedAt: Date.now() }]);
      setUrl(""); setUrlOpen(false); setBusy("");
    } catch { setBusy("Couldn't fetch that page (this only works on the live website)."); }
  };

  const saveDocs = (next) => persist({ ...data, knowledge: next, isSample: false });
  const onPdf = async (file) => {
    if (!file) return;
    setBusy("Reading " + file.name + "…");
    try {
      const text = await pdfToText(file);
      if (!text || text.length < 20) { setBusy("Couldn't read text from that PDF (it may be a scan/image)."); return; }
      saveDocs([...docs, { id: uid(), name: file.name.replace(/\.pdf$/i, ""), text, chars: text.length, addedAt: Date.now() }]);
      setBusy("");
    } catch (e) { setBusy("Couldn't read that PDF: " + e.message); }
  };
  const addPaste = () => {
    if (!pName.trim() || !pText.trim()) return;
    saveDocs([...docs, { id: uid(), name: pName.trim(), text: pText.trim(), chars: pText.trim().length, addedAt: Date.now() }]);
    setPName(""); setPText(""); setPasteOpen(false);
  };
  const del = (id) => saveDocs(docs.filter(d => d.id !== id));

  if (!isCoach) {
    return <div className="note">{docs.length ? `${docs.length} document${docs.length > 1 ? "s" : ""} loaded for the Ask feature.` : "No documents loaded yet."}</div>;
  }

  return (<>
    <div className="note" style={{ marginBottom: 10 }}>Upload Football QLD or club PDFs (rules, by-laws, policies). The text is extracted and used to answer questions in the Ask tab. Keep it to a few key documents.</div>
    <div className="kdoc" style={{ opacity: .8 }}>
      <FileText size={16} color="#1E9E57" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>MiniRoos playing formats <span className="guesttag" style={{ background: "#e6f6ec", color: "#1f8a4c" }}>Built-in</span></div>
        <div className="note" style={{ fontSize: 11 }}>U6–U11 team sizes, ball/field/goal sizes, durations — always on</div>
      </div>
    </div>
    {docs.map(d => (
      <div className="kdoc" key={d.id}>
        <FileText size={16} color="var(--pitch)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{d.name}</div>
          <div className="note" style={{ fontSize: 11 }}>{Math.round((d.chars || 0) / 1000)}k characters</div>
        </div>
        <button className="chip" onClick={() => del(d.id)}><Trash2 size={13} /></button>
      </div>
    ))}
    {busy && <div className="note" style={{ margin: "8px 0", color: "var(--pitch)" }}>{busy}</div>}
    <div className="chips" style={{ marginTop: 12 }}>
      <label className="chip" style={{ cursor: "pointer" }}>
        <Plus size={13} />Upload PDF
        <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={e => onPdf(e.target.files?.[0])} />
      </label>
      <button className="chip" onClick={() => setPasteOpen(!pasteOpen)}><Plus size={13} />Paste text</button>
      <button className="chip" onClick={() => setUrlOpen(!urlOpen)}><Plus size={13} />Add from web page</button>
    </div>
    {urlOpen && (
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <input className="inp" placeholder="https://olympicfc.com.au/?p=12792" value={url} onChange={e => setUrl(e.target.value)} style={{ flex: 1 }} />
        <button className="btn" style={{ width: "auto", padding: "0 16px" }} onClick={addUrl} disabled={!url.trim()}>Fetch</button>
      </div>
    )}
    {pasteOpen && (
      <div style={{ marginTop: 10 }}>
        <input className="inp" placeholder="Document name" value={pName} onChange={e => setPName(e.target.value)} style={{ marginBottom: 8 }} />
        <textarea className="inp" rows={4} placeholder="Paste the text…" value={pText} onChange={e => setPText(e.target.value)} />
        <button className="btn" style={{ marginTop: 8 }} onClick={addPaste} disabled={!pName.trim() || !pText.trim()}>Add document</button>
      </div>
    )}
  </>);
}

function AskTab({ data, viewer, isCoach, account }) {
  // Account mode: the server already knows who is asking. Legacy mode still
  // needs the device identity or coach mode.
  const allowed = account ? true : (isCoach || viewer?.kind === "parent");
  const [q, setQ] = useState("");
  const [msgs, setMsgs] = useState([]);
  const [busy, setBusy] = useState(false);
  const docs = data.knowledge || [];

  const suggestions = [
    "When and where is our next game?",
    "What are this season's match focuses?",
    "How long are the halves at U8?",
    "What's the wet weather / cancellation policy?"
  ];

  const ask = async (text) => {
    const question = (text ?? q).trim();
    if (!question || busy) return;
    setQ("");
    const next = [...msgs, { role: "you", text: question }];
    setMsgs(next);
    setBusy(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history: msgs.slice(-6) })
      });
      const j = await res.json();
      setMsgs([...next, { role: "bot", text: j.answer || j.error || "Sorry, I couldn't answer that right now." }]);
    } catch {
      setMsgs([...next, { role: "bot", text: "The Ask feature only works on the live website (it needs the team's secure connection to Claude). Try it there." }]);
    } finally { setBusy(false); }
  };

  if (!allowed) {
    return <div className="empty"><Sparkles size={26} color="var(--muted)" /><div className="disp" style={{ marginTop: 8 }}>Sign in to ask</div>
      <div className="note">Tap “Sign in to respond” at the top to use the team assistant.</div></div>;
  }

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <Sparkles size={18} color="var(--pitch)" /><div className="label">Ask the team assistant</div>
        </div>
        <div className="note">Answers come from the team's documents{docs.length ? ` (${docs.length} loaded)` : " (none loaded yet — ask your coach to add club & Football QLD PDFs)"} plus our live fixtures, squad and focuses. It won't make up rules.</div>
      </div>

      <div style={{ marginBottom: 12 }}>
        {msgs.length === 0 && suggestions.map((s, i) => (
          <span className="askchip" key={i} onClick={() => ask(s)}>{s}</span>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginBottom: 12 }}>
        {msgs.map((m, i) => <div key={i} className={"askmsg " + m.role}>{m.text}</div>)}
        {busy && <div className="askmsg bot">Thinking…</div>}
      </div>

      <div style={{ display: "flex", gap: 8, position: "sticky", bottom: 8 }}>
        <input className="inp" value={q} placeholder="Ask a question…" onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === "Enter" && ask()} style={{ flex: 1 }} />
        <button className="btn" style={{ width: "auto", padding: "0 18px" }} onClick={() => ask()} disabled={busy || !q.trim()}>
          <Send size={16} />
        </button>
      </div>
    </>
  );
}

function StaffEditor({ t, setT, isCoach }) {
  const staff = t.staff || getStaff(t).map(s => ({ ...s }));
  const update = (next) => setT({ ...t, staff: next });
  const setS = (i, patch) => update(staff.map((s, j) => j === i ? { ...s, ...patch } : s));
  const add = () => update([...staff, { role: "", name: "", mobile: "", email: "", photo: "" }]);
  const del = (i) => update(staff.filter((_, j) => j !== i));
  const onPhoto = async (i, file) => { if (!file) return; try { setS(i, { photo: await downscaleImage(file) }); } catch {} };

  if (!isCoach) {
    return (<>
      {staff.filter(s => s.name).map((s, i) => (
        <div className="staffrow" key={i}>
          {s.photo ? <img className="savatar" src={s.photo} alt={s.name} /> : <div className="savatar">{initials(s.name)}</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="staffrole">{s.role}</div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{s.name}</div>
            <div className="chips" style={{ marginTop: 6 }}>
              {s.mobile && <a className="washare" href={`https://wa.me/${intlPhone(s.mobile)}`} target="_blank" rel="noopener noreferrer"><Send size={13} />WhatsApp</a>}
              {s.mobile && <a className="chip lnk" href={"tel:" + s.mobile.replace(/\s+/g, "")}><Phone size={13} />Call</a>}
              {s.email && <a className="chip lnk" href={"mailto:" + s.email}><Mail size={13} />Email</a>}
            </div>
          </div>
        </div>
      ))}
    </>);
  }

  return (<>
    {staff.map((s, i) => (
      <div key={i} style={{ borderTop: i ? "1px solid var(--line)" : "none", paddingTop: i ? 12 : 0, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "center" }}>
          {s.photo ? <img className="savatar" src={s.photo} alt="" /> : <div className="savatar">{initials(s.name || "?")}</div>}
          <label className="chip" style={{ cursor: "pointer" }}>
            <Plus size={13} />Photo
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => onPhoto(i, e.target.files?.[0])} />
          </label>
          {s.photo && <button className="chip" onClick={() => setS(i, { photo: "" })}>Remove</button>}
          <button className="chip" style={{ marginLeft: "auto" }} onClick={() => del(i)}><Trash2 size={13} /></button>
        </div>
        <div className="row2">
          <div className="field"><label>Role</label><input className="inp" value={s.role} onChange={e => setS(i, { role: e.target.value })} placeholder="Head coach" /></div>
          <div className="field"><label>Name</label><input className="inp" value={s.name} onChange={e => setS(i, { name: e.target.value })} /></div>
        </div>
        <div className="row2">
          <div className="field"><label>Mobile</label><input className="inp" value={s.mobile || ""} onChange={e => setS(i, { mobile: e.target.value })} placeholder="0400 000 000" /></div>
          <div className="field"><label>Email</label><input className="inp" value={s.email || ""} onChange={e => setS(i, { email: e.target.value })} /></div>
        </div>
      </div>
    ))}
    <button className="chip" onClick={add}><Plus size={13} />Add staff member</button>
  </>);
}

// team.* fields owned by the narrow /api/team-settings route. They never sit in
// the Team-details draft, so "Save team details" can't rewrite them with a
// stale copy and a card's patch can't be mistaken for an edit to the draft.
const NARROW_TEAM_KEYS = ["parentsSee", "matchFormat", "rules"];
const teamDetails = (team) => {
  const d = { ...(team || {}) };
  NARROW_TEAM_KEYS.forEach((k) => delete d[k]);
  return d;
};

function SettingsTab({ data, isCoach, persist, patchLocal, setIsCoach, setModal, account }) {
  // Draft of the Team-details fields only (name, age group, division, logo,
  // staff, WhatsApp, PIN). data.team also changes when a settings card writes
  // parentsSee/matchFormat/rules through its narrow route, so the draft only
  // resyncs the detail keys whose value actually changed — an unsaved edit in
  // the Team name box survives flipping a switch or tapping a format chip.
  const [t, setT] = useState(() => teamDetails(data.team));
  const prevTeamRef = useRef(data.team);
  useEffect(() => {
    const prev = prevTeamRef.current;
    prevTeamRef.current = data.team;
    if (prev === data.team) return;
    const was = teamDetails(prev), now = teamDetails(data.team);
    const changed = Object.keys({ ...was, ...now }).filter((k) => was[k] !== now[k]);
    if (!changed.length) return;
    setT((cur) => {
      const next = { ...cur };
      changed.forEach((k) => { if (k in now) next[k] = now[k]; else delete next[k]; });
      return next;
    });
  }, [data.team]);
  // Merge the draft over the live team so the narrow-route fields keep their
  // current values rather than whatever this screen last saw.
  const save = () => persist({ ...data, team: { ...data.team, ...t }, isSample: false });
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
        {isCoach && (
          <div className="field" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <label>Club logo</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {t.logo
                ? <img src={t.logo} alt="logo" style={{ width: 48, height: 48, objectFit: "contain", background: "var(--pitch)", borderRadius: 10, padding: 4 }} />
                : <div className="savatar" style={{ borderRadius: 10 }}>FC</div>}
              <label className="chip" style={{ cursor: "pointer" }}>
                <Plus size={13} />{t.logo ? "Change logo" : "Upload logo"}
                <input type="file" accept="image/*" style={{ display: "none" }}
                  onChange={async e => { const f = e.target.files?.[0]; if (f) { try { setT({ ...t, logo: await downscaleImage(f, 256, "image/png") }); } catch {} } }} />
              </label>
              {t.logo && <button className="chip" onClick={() => setT({ ...t, logo: "" })}>Remove</button>}
            </div>
            <div className="note" style={{ marginTop: 4 }}>Shows in the header. A transparent PNG works best on the red background.</div>
          </div>
        )}
      </div>

      {isCoach && <>
        <ParentsSeeCard team={data.team} patchLocal={patchLocal} />
        <MatchFormatCards team={data.team} patchLocal={patchLocal} />
        <LineupRulesCard team={data.team} patchLocal={patchLocal} />
      </>}

      <div className="card">
        <div className="label" style={{ marginBottom: 12 }}>Team knowledge (for Ask)</div>
        <KnowledgeEditor data={data} persist={persist} isCoach={isCoach} />
      </div>

      <div className="card">
        <div className="label" style={{ marginBottom: 12 }}>Team staff</div>
        <StaffEditor t={t} setT={setT} isCoach={isCoach} />
      </div>

      <div className="card">
        {isCoach ? <>
          <div className="label" style={{ marginBottom: 12 }}>Sharing & access</div>
          <div className="field"><label>WhatsApp group invite link</label><input className="inp" value={t.whatsapp || ""} onChange={e => setT({ ...t, whatsapp: e.target.value })} placeholder="https://chat.whatsapp.com/…" /></div>
          {!account && <div className="field"><label>Coach PIN (guards editing)</label><input className="inp" value={t.coachPin} onChange={e => setT({ ...t, coachPin: e.target.value })} placeholder="e.g. 1234 — leave blank for none" /></div>}
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
          Everyone who opens this dashboard sees the same data, and it's saved automatically. {account
            ? "Sign-in decides who can edit: coaches and staff with an email on the team, parents for their own child's replies."
            : <>Only people in <b>Coach mode</b> should make changes — set a PIN above so parents can't edit by accident (it's a courtesy guard, not real security).</>} Squadi stays your source of truth: after each game, jump into Coach mode and pop the score in.
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

/* ---------------- COACH SETTINGS CARDS ----------------
   Each card writes one team.* field through /api/team-settings and patches
   local state with what the server echoes back. */
const teamPatch = (patchLocal, patch) => patchLocal((d) => ({ ...d, team: { ...d.team, ...patch } }));

// What parents see: switches in three groups, saved one toggle at a time
// (optimistic, reverted on failure).
function ParentsSeeCard({ team, patchLocal }) {
  const cur = teamParentsSee(team);
  const [err, setErr] = useState("");
  const toggle = async (key) => {
    const prev = team.parentsSee;
    const next = { ...cur, [key]: !cur[key] };
    setErr("");
    teamPatch(patchLocal, { parentsSee: next });
    try {
      const res = await fetchJson("/api/team-settings", { parentsSee: next });
      if (res?.team?.parentsSee) teamPatch(patchLocal, { parentsSee: res.team.parentsSee });
    } catch (e) {
      teamPatch(patchLocal, { parentsSee: prev });
      setErr(saveErrorText(e));
    }
  };
  return (
    <div className="card">
      <div className="label" style={{ marginBottom: 4 }}>Parents can see</div>
      {PARENTS_SEE_GROUPS.map((g) => (
        <div key={g.title} style={{ marginTop: 10 }}>
          <div className="note" style={{ fontWeight: 700, color: "var(--ink)" }}>{g.title}</div>
          {g.keys.map((k) => (
            <div className="swrow" key={k}>
              <span style={{ flex: 1, fontSize: 13.5 }}>{PARENTS_SEE_LABELS[k]}</span>
              <Switch on={cur[k]} label={PARENTS_SEE_LABELS[k]} onClick={() => toggle(k)} />
            </div>
          ))}
        </div>
      ))}
      {err && <div className="note" style={{ color: "var(--red)", marginTop: 8 }}>{err}</div>}
      <div className="note" style={{ marginTop: 12 }}>Ratings, lineup rules, your notes and the match record stay coach-only whatever you choose here. Goals and assists show as they do today.</div>
    </div>
  );
}

// A whole-minutes field for the match format. The typed text is the coach's
// while the box has focus (typing "5" on the way to "50" sends nothing); the
// value is clamped to the same bounds the server applies and committed on blur
// or Enter, so a mid-edit autosave can never rewrite the box under the cursor.
// Clearing the box and leaving it keeps the previous value.
function FormatNumber({ value, min, max, onCommit }) {
  const [draft, setDraft] = useState(null); // string while editing, else null
  const commit = (e) => {
    const raw = e.target.value.trim();
    setDraft(null);
    if (raw === "") return;
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(max, Math.max(min, n));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <input className="inp" type="number" min={min} max={max} step={1}
      value={draft ?? value}
      onFocus={(e) => setDraft(String(e.target.value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} />
  );
}

// Team default match format and home shape. Edits autosave 500ms after the
// last change; the echoed (sanitised) format is what lands in local state.
const PERIOD_LABELS = { 1: "Straight through", 2: "2 halves", 3: "3 thirds", 4: "4 quarters" };
const TEAM_SIZES = [[4, false], [7, true], [9, true]];
const fits = (formation, outfield) => parseFormation(formation).reduce((s, n) => s + n, 0) === outfield;
function MatchFormatCards({ team, patchLocal }) {
  const stored = team.matchFormat || defaultFormatForAgeGroup(team.ageGroup);
  const [fmt, setFmt] = useState(stored);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const storedRef = useRef(stored); storedRef.current = stored;
  const pending = useRef(null);   // the format waiting to be saved
  const timer = useRef(null), savedTimer = useRef(null);

  const flush = async () => {
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    try {
      const res = await fetchJson("/api/team-settings", { matchFormat: next });
      const mf = res?.team?.matchFormat || next;
      teamPatch(patchLocal, { matchFormat: mf });
      setFmt(mf);
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setFmt(storedRef.current);
      setErr(saveErrorText(e));
    }
  };
  // Leaving the tab inside the debounce window still saves the last edit.
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(savedTimer.current); if (pending.current) flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (patch) => {
    const next = { ...fmt, ...patch };
    setFmt(next); setErr(""); setSaved(false);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  };
  const outfield = (Number(fmt.playersOnField) || 0) - (fmt.hasGK ? 1 : 0);
  const setSize = (n, gk) => {
    if (n === fmt.playersOnField && gk === !!fmt.hasGK) return;
    change({ playersOnField: n, hasGK: gk, formation: fallbackFormation(n - (gk ? 1 : 0)) });
  };
  const setGK = (gk) => {
    const of = (Number(fmt.playersOnField) || 0) - (gk ? 1 : 0);
    change({ hasGK: gk, ...(fits(fmt.formation, of) ? {} : { formation: fallbackFormation(of) }) });
  };
  const presets = FORMATION_PRESETS[outfield] || [fallbackFormation(outfield)];
  const shapes = presets.includes(fmt.formation) ? presets : [fmt.formation, ...presets];

  return (<>
    <div className="card">
      <div className="label" style={{ marginBottom: 10 }}>Match format</div>
      <div className="chips">
        {TEAM_SIZES.map(([n, gk]) => (
          <button key={n} type="button" className={"chip" + (fmt.playersOnField === n ? " act" : "")} onClick={() => setSize(n, gk)}>{n}v{n}</button>
        ))}
      </div>
      <div className="field"><label>Game length (minutes)</label>
        <FormatNumber min={10} max={120} value={fmt.gameLength} onCommit={(v) => change({ gameLength: v })} /></div>
      <div className="field"><label>Halves</label>
        <div className="seg">{[1, 2, 3, 4].map((n) => (
          <button key={n} type="button" className={fmt.periods === n ? "sel" : ""} onClick={() => change({ periods: n })}>{PERIOD_LABELS[n]}</button>
        ))}</div>
      </div>
      <div className="field"><label>Sub interval (minutes)</label>
        <FormatNumber min={2} max={45} value={fmt.subInterval} onCommit={(v) => change({ subInterval: v })} /></div>
      <div className="swrow" style={{ borderBottom: "none", paddingTop: 0 }}>
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>Keeper</span>
        <Switch on={!!fmt.hasGK} label="Keeper" onClick={() => setGK(!fmt.hasGK)} />
      </div>
      <div className="note">This is the team default. A single fixture can override it.</div>
      {saved && <div className="note" style={{ color: "var(--win)", fontWeight: 700, marginTop: 6 }}>Saved</div>}
      {err && <div className="note" style={{ color: "var(--red)", marginTop: 6 }}>{err}</div>}
    </div>

    <div className="card">
      <div className="label" style={{ marginBottom: 10 }}>Home shape</div>
      <div className="chips">
        {shapes.map((s) => {
          const call = s === fmt.formation ? null : shapeCall(fmt.formation, s);
          return (
            <button key={s} type="button" className={"chip" + (s === fmt.formation ? " act" : "")} onClick={() => change({ formation: s })}>
              {s}{call ? " · " + call : ""}
            </button>
          );
        })}
      </div>
      <div className="note">The shape you start in. Where a chip shows a call, that's the word to shout to move into it mid-game.</div>
    </div>
  </>);
}

// Lineup rules the planner's Suggest honours, in priority order. Built-ins can
// be switched off but not deleted; custom rules can be dragged to re-rank.
function LineupRulesCard({ team, patchLocal }) {
  const rules = teamRules(team);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [dragId, setDragId] = useState(null);

  const commit = async (next) => {
    const prev = team.rules;
    setErr("");
    teamPatch(patchLocal, { rules: next });
    try {
      const res = await fetchJson("/api/team-settings", { rules: next });
      if (Array.isArray(res?.team?.rules)) teamPatch(patchLocal, { rules: res.team.rules });
    } catch (e) {
      teamPatch(patchLocal, { rules: prev });
      setErr(saveErrorText(e));
    }
  };
  const toggleOff = (id) => commit(rules.map((r) => {
    if (r.id !== id) return r;
    const { off, ...rest } = r;
    return off ? rest : { ...rest, off: true };
  }));
  const remove = (id) => commit(rules.filter((r) => r.id !== id));
  const atCap = rules.length >= MAX_RULES;
  const add = () => {
    const t = text.trim().slice(0, 160);
    if (!t || atCap) return;
    commit([...rules, { id: "r_" + uid(), text: t, builtin: false, createdAt: Date.now() }]);
    setText(""); setAdding(false);
  };
  const move = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const list = [...rules];
    const fi = list.findIndex((r) => r.id === fromId), ti = list.findIndex((r) => r.id === toId);
    if (fi < 0 || ti < 0) return;
    const [it] = list.splice(fi, 1);
    list.splice(ti, 0, it);
    commit(list);
  };

  return (
    <div className="card">
      <div className="label" style={{ marginBottom: 4 }}>Lineup rules</div>
      <div className="note" style={{ marginBottom: 4 }}>In priority order: an earlier rule beats a later one.</div>
      {rules.map((r, i) => (
        <div key={r.id} className={"rule" + (r.off ? " off" : "")} draggable={!r.builtin}
          onDragStart={() => setDragId(r.id)} onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); move(dragId, r.id); setDragId(null); }} onDragEnd={() => setDragId(null)}>
          <span className="n">{i + 1}</span>
          {!r.builtin && <GripVertical size={15} aria-hidden="true" style={{ color: "var(--muted)", cursor: "grab", flexShrink: 0 }} />}
          <span style={{ flex: 1, fontSize: 13.5 }}>{r.text}</span>
          {r.builtin && <span className="bi">Built in</span>}
          <Switch on={!r.off} label={r.text} onClick={() => toggleOff(r.id)} />
          {!r.builtin && (
            <button type="button" className="iconbtn" style={{ width: 28, height: 28 }} aria-label={"Delete rule: " + r.text} onClick={() => remove(r.id)}><Trash2 size={13} /></button>
          )}
        </div>
      ))}
      {adding ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
          <input className="inp" autoFocus value={text} maxLength={160} placeholder="e.g. Twins never on together"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } if (e.key === "Escape") { setAdding(false); setText(""); } }} />
          <button type="button" className="btn" style={{ width: "auto", marginTop: 0, padding: "11px 16px" }} onClick={add}>Add</button>
        </div>
      ) : atCap ? (
        <div className="note" style={{ marginTop: 10 }}>Up to {MAX_RULES} rules. Remove one to add another.</div>
      ) : (
        <button type="button" className="chip add" style={{ marginTop: 10 }} onClick={() => setAdding(true)}><Plus size={13} />Add a rule</button>
      )}
      {err && <div className="note" style={{ color: "var(--red)", marginTop: 8 }}>{err}</div>}
    </div>
  );
}

/* ============================================================
   MODALS
============================================================ */
function Modal({ modal, setModal, data, persist, patchLocal, isCoach, setIsCoach, viewer, setViewer, me }) {
  const close = () => setModal(null);
  return (
    <div className="ov" onClick={(e) => { if (e.target.classList.contains("ov")) close(); }}>
      <div className="sheet">
        {modal.type === "pin" && <PinSheet {...{ data, setIsCoach, close }} />}
        {modal.type === "signin" && !me && <SignInSheet {...{ data, viewer, setViewer, close }} />}
        {modal.type === "hats" && me && <HatsSheet {...{ me, close }} />}
        {modal.type === "fixture" && <FixtureSheet {...{ data, persist, payload: modal.payload, close }} />}
        {modal.type === "match" && <MatchSheet {...{ data, persist, payload: modal.payload, isCoach, viewer, me, setModal, close }} />}
        {modal.type === "session" && <SessionSheet {...{ data, persist, payload: modal.payload, occ: modal.occ, isCoach, viewer, me, setModal, close }} />}
        {modal.type === "sessionEdit" && <SessionEditSheet {...{ data, persist, payload: modal.payload, close }} />}
        {modal.type === "player" && <PlayerSheet {...{ data, persist, payload: modal.payload, me, close }} />}
        {modal.type === "playerView" && <PlayerViewSheet {...{ data, persist, patchLocal, payload: modal.payload, isCoach, viewer, me, close }} />}
        {modal.type === "import" && <ImportSheet {...{ data, persist, close }} />}
        {modal.type === "playersImport" && <PlayersImportSheet {...{ data, persist, close }} />}
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

function SignInSheet({ data, viewer, setViewer, close }) {
  const [pinFor, setPinFor] = useState(null); // player awaiting PIN
  const [pin, setPin] = useState(""); const [err, setErr] = useState(false);
  const players = [...data.players].sort((a, b) => a.number - b.number);

  const pick = (p) => {
    if (p.pin) { setPinFor(p); setPin(""); setErr(false); }
    else { setViewer({ kind: "parent", pid: p.id, label: p.name }); close(); }
  };
  const confirmPin = () => {
    if (pin === pinFor.pin) { setViewer({ kind: "parent", pid: pinFor.id, label: pinFor.name }); close(); }
    else setErr(true);
  };

  if (pinFor) return (<>
    <SheetHead title={`Sign in as ${pinFor.name}'s parent`} close={close} />
    <div className="field"><label>Family PIN</label>
      <input className="inp" type="tel" value={pin} autoFocus onChange={e => { setPin(e.target.value); setErr(false); }} />
    </div>
    {err && <div className="note" style={{ color: "var(--red)", marginBottom: 8 }}>Incorrect PIN — check with the coach.</div>}
    <button className="btn" onClick={confirmPin}>Sign in</button>
    <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setPinFor(null)}>Back</button>
  </>);

  return (<>
    <SheetHead title="Who's responding?" close={close} />
    <div className="note" style={{ marginBottom: 12 }}>
      Tap your child so your availability replies are recorded as you — and so you can only mark your own player. Remembered on this device.
    </div>
    {viewer.kind === "parent" && (
      <button className="btn ghost" style={{ marginBottom: 12 }} onClick={() => { setViewer({ kind: "guest" }); close(); }}>
        Sign out ({viewer.label})
      </button>
    )}
    <div className="card" style={{ padding: "4px 12px" }}>
      {players.map(p => (
        <div key={p.id} className="avrow" onClick={() => pick(p)} style={{ cursor: "pointer" }}>
          <div className="avname">{p.name}{p.pin && <Lock size={11} style={{ marginLeft: 6, opacity: .5 }} />}</div>
          {viewer.pid === p.id ? <Check size={16} color="#1E9E57" /> : <ChevronRight size={15} color="var(--muted)" />}
        </div>
      ))}
    </div>
  </>);
}

// Account mode: pick which hat to wear (coach / parent / viewer) on this team,
// or jump to another team. The choice lives in two plain cookies the server
// validates on every request — a cookie can only narrow what the login holds.
function HatsSheet({ me, close }) {
  const wear = (slug, role) => {
    const maxAge = 60 * 60 * 24 * 180;
    document.cookie = `team_slug=${encodeURIComponent(slug)}; path=/; max-age=${maxAge}; samesite=lax`;
    document.cookie = `act_as=${encodeURIComponent(role)}; path=/; max-age=${maxAge}; samesite=lax`;
    // The legacy per-device identity must not outlive a hat change.
    document.cookie = `whoami_${slug}=; path=/; max-age=0; samesite=lax`;
    window.location.href = "/";
  };
  const rowStyle = { width: "100%", background: "none", border: "none", borderBottom: "1px solid var(--line)", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" };
  const row = (slug, hat, current) => (
    <button key={slug + ":" + hat.role} className="avrow" style={rowStyle} aria-current={current ? "true" : undefined} onClick={() => wear(slug, hat.role)}>
      <div className="avname">{hatLabel(hat)}</div>
      {current ? <Check size={16} color="#1E9E57" /> : <ChevronRight size={15} color="var(--muted)" />}
    </button>
  );
  const others = (me.teams || []).filter((t) => t.teamSlug !== me.teamSlug);
  return (<>
    <SheetHead title="Viewing as" close={close} />
    <div className="label" style={{ marginBottom: 8 }}>{me.teamName}</div>
    <div className="card" style={{ padding: "4px 12px" }}>
      {(me.hats || []).map((h) => row(me.teamSlug, h, h.role === me.role))}
    </div>
    {others.length > 0 && (<>
      <div className="label" style={{ marginBottom: 8 }}>Other teams</div>
      {others.map((t) => (
        <div className="card" key={t.teamSlug} style={{ padding: "4px 12px" }}>
          <div style={{ fontWeight: 800, fontSize: 14, padding: "8px 2px 2px" }}>{t.teamName}</div>
          {(t.hats || []).map((h) => row(t.teamSlug, h, false))}
        </div>
      ))}
    </>)}
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
      <div className="seg">{["upcoming", "played", "cancelled"].map(s => <button key={s} className={f.status === s ? "sel" : ""} onClick={() => setF({ ...f, status: s, ...(s === "cancelled" ? { us: null, them: null } : {}) })}>{s === "upcoming" ? "Upcoming" : s === "played" ? "Played" : "Cancelled"}</button>)}</div>
    </div>

    {f.status === "played" && (
      <div className="row2">
        <div className="field"><label>Our score</label><input className="inp" type="number" value={f.us ?? ""} onChange={e => setF({ ...f, us: e.target.value === "" ? null : +e.target.value })} /></div>
        <div className="field"><label>Their score</label><input className="inp" type="number" value={f.them ?? ""} onChange={e => setF({ ...f, them: e.target.value === "" ? null : +e.target.value })} /></div>
      </div>
    )}

    {(() => {
      const feats = teamFeatures(data.team);
      const duties = [
        feats.fruitDuty && ["fruit", "Fruit duty"],
        feats.gkDuty && ["gk", "Goalkeeper"],
        feats.jerseyDuty && ["jersey", "Jerseys"]
      ].filter(Boolean);
      if (!duties.length) return null;
      return (
        <div className="row2" style={duties.length === 3 ? { gridTemplateColumns: "1fr 1fr 1fr" } : undefined}>
          {duties.map(([key, label]) => (
            <div className="field" key={key}><label>{label}</label>
              <select className="inp" value={f[key] || ""} onChange={e => setF({ ...f, [key]: e.target.value })}>
                <option value="">— none —</option>{players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      );
    })()}

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

    <div className="field"><label>Playing strip</label>
      <div className="seg">
        <button className={!f.strip ? "sel" : ""} onClick={() => setF({ ...f, strip: "" })}>Not set</button>
        <button className={f.strip === "Red" ? "sel" : ""} onClick={() => setF({ ...f, strip: "Red" })}>Red</button>
        <button className={f.strip === "Blue" ? "sel" : ""} onClick={() => setF({ ...f, strip: "Blue" })}>Blue</button>
      </div>
    </div>

    {teamFeatures(data.team).focus && (
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
    )}

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

// The line under an availability list in account mode, by worn hat.
function rsvpNoteFor(me) {
  if (me.role === "parent" && (me.playerIds || []).length) {
    return `You're marking ${joinKidNames(me.playerNames)}. Replies save instantly and are recorded with your child's name.`;
  }
  if (me.role === "coach") return "Switch to Coach mode (top right) to mark anyone.";
  return "Club admins can see replies but can't respond.";
}

function MatchSheet({ data, persist, payload: f, isCoach, viewer, me, setModal, close }) {
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

  // Account mode: the server told us whose parent this login is (ownIds);
  // legacy mode: the per-device identity picked in the sign-in sheet.
  const account = !!me;
  const ownIds = me ? (me.playerIds || []) : null;
  const canEdit = (pid) => isCoach || (account ? ownIds.includes(pid) : (viewer?.kind === "parent" && viewer.pid === pid));
  const byFor = (pid) => isCoach ? "Coach" : account ? (data.players.find((p) => p.id === pid)?.name || "Parent") : (viewer?.label || "you");

const setAv = async (pid, patch) => {
    const cur = avail[pid] || {};
    const merged = { ...cur, ...patch };
    const status = merged.status ?? null;
    const reason = status === "out" ? (merged.reason || "Away") : undefined;
    const optimistic = status == null
      ? null
      : { status, ...(reason ? { reason } : {}), by: byFor(pid), at: Date.now() };
    const nextAvail = { ...avail };
    if (optimistic == null) delete nextAvail[pid]; else nextAvail[pid] = optimistic;
    setAvail(nextAvail);
    try {
      const res = await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "game", id: f.id, playerId: pid, status, reason })
      });
      if (!res.ok) throw new Error("rsvp " + res.status);
    } catch (e) {
      setAvail(avail);
      console.error("Could not save availability:", e);
    }
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
      <div className="vs" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
        {f.opponentLogo && <img className="crest-lg" src={f.opponentLogo} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
        <span>{home ? us : them} vs {home ? them : us}</span>
      </div>
      {f.status === "cancelled"
        ? <div className="big" style={{ fontSize: 22, color: "var(--red)" }}>Cancelled</div>
        : f.us != null
        ? <div className="big">{home ? f.us : f.them}–{home ? f.them : f.us}</div>
        : isPastGame(f)
          ? <div className="big" style={{ fontSize: 20, color: "var(--muted)" }}>Played — score not recorded</div>
          : <div className="big" style={{ fontSize: 22, color: "var(--amber)" }}>Upcoming</div>}
      <div className="note">{fmtDate(f.dateISO)} · {f.time} · {f.venue
        ? <a href={mapsUrl(f.venue)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--pitch)", fontWeight: 700, textDecoration: "underline" }}>{f.venue}</a>
        : "—"}</div>
      {f.strip && (
        <div style={{ marginTop: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "5px 12px", fontSize: 12.5, fontWeight: 800, background: f.strip === "Blue" ? "#e6f0ff" : "#fdeaec", color: f.strip === "Blue" ? "#2563a8" : "var(--pitch)" }}>
            👕 {f.strip} strip
          </span>
        </div>
      )}
    </div>

    {/* Match day: coaches get the stage hub (availability -> plan -> live ->
        record); parents get the read-only live view once a lineup exists. */}
    {isCoach && f.status !== "cancelled" && (() => {
      // The plan and record live on the fixture in data (the sheet's payload is
      // a snapshot); RSVPs come from this sheet's live state.
      const live = (data.fixtures || []).find((x) => x.id === f.id) || f;
      const todayISO = isoLocal(new Date());
      const { stages, counts, noReply, isToday } = matchDayStages(data, { ...live, availability: avail }, todayISO);
      const icons = { availability: Users, plan: ClipboardList, live: Play, record: Flag };
      const names = noReply.map((p) => firstName(p.name));
      return (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span className="label">Match day</span>
            <span className="coachonly"><Lock size={11} />Coach only</span>
          </div>
          <div className="stages">
            {stages.map((s) => {
              const Ic = s.state === "done" ? Check : icons[s.key];
              return (
                <div key={s.key} className={"stg" + (s.state === "done" ? " done" : s.state === "now" ? " now" : "")}>
                  <div className="dot"><Ic size={14} /></div>{s.name}<span className="st">{s.sub}</span>
                </div>
              );
            })}
          </div>
          {counts.nr > 0 && (
            <div className="note" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8 }}>
              <span className="rdotwrap" style={{ width: 12, height: 12, flexShrink: 0, marginTop: 2 }}><span className="rdot" style={{ top: 1, right: 1 }} /></span>
              <span>{joinNames(names)} {names.length === 1 ? "hasn't" : "haven't"} replied. They're counted in until you mark them out.</span>
            </div>
          )}
          <button className="btn" style={{ marginTop: 10 }} onClick={() => setModal({ type: "plan", payload: live })}>
            {isToday ? "Kick off" : "Open the plan"}
          </button>
        </div>
      );
    })()}
    {!isCoach && f.status !== "cancelled" && !!(f.plan && (f.plan.assignments || []).some((s) => Object.keys(s || {}).length)) && (
      <button className="btn" style={{ marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        onClick={() => setModal({ type: "plan", payload: f })}>
        <Play size={15} /> Match day — live lineup
      </button>
    )}

    {teamFeatures(data.team).focus && <FocusCard f={f} label={f.status === "played" ? "Focus that week" : "This week's focus"} />}

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

    {f.status === "upcoming" && !isPastGame(f) && players.length > 0 && (
      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Who's playing? Tap your player</div>
        <div className="avsum">
          <span className="avpill in"><Check size={13} />{counts.in} in</span>
          <span className="avpill out"><X size={13} />{counts.out} out</span>
          <span className="avpill nr">{counts.nr} no reply</span>
        </div>
        {!account && viewer?.kind !== "parent" && !isCoach && (
          <button className="btn" style={{ marginBottom: 12 }} onClick={() => { close(); setModal({ type: "signin" }); }}>
            Sign in to mark your child
          </button>
        )}
        {players.map(p => {
          const a = avail[p.id] || {};
          const editable = canEdit(p.id);
          return (
            <div className="avrow" key={p.id} style={editable ? undefined : { opacity: .82 }}>
              <div className="avname">
                {p.number}. {p.name}
                {a.by && a.status && <div className="note" style={{ fontSize: 10.5, fontWeight: 500 }}>{a.status === "in" ? "In" : "Out"} · {a.by}{a.at ? " · " + fmtWhen(a.at) : ""}</div>}
              </div>
              {editable ? <>
                <button className={"avbtn" + (a.status === "in" ? " selin" : "")}
                  onClick={() => setAv(p.id, { status: a.status === "in" ? null : "in", reason: undefined })}>In</button>
                <button className={"avbtn" + (a.status === "out" ? " selout" : "")}
                  onClick={() => setAv(p.id, { status: a.status === "out" ? null : "out", reason: a.reason || "Away" })}>Out</button>
                {a.status === "out" && (
                  <select className="avsel" value={a.reason || "Away"} onChange={e => setAv(p.id, { status: "out", reason: e.target.value })}>
                    {ABSENCE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}
              </> : (
                <span className={"avpill " + (a.status === "in" ? "in" : a.status === "out" ? "out" : "nr")}>
                  {a.status === "in" ? "In" : a.status === "out" ? (a.reason || "Out") : "—"}
                </span>
              )}
            </div>
          );
        })}
        <div className="note" style={{ marginTop: 10 }}>
          {isCoach ? "As coach you can mark anyone." : account ? rsvpNoteFor(me) : viewer?.kind === "parent"
            ? `You're marking ${viewer.label}. Replies save instantly and are recorded with your name.`
            : "Sign in (top right) to respond for your child."}
        </div>

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
          (f.strip ? `\n👕 Strip: ${f.strip}` : "") +
          (f.focusTitle ? `\n🎯 Focus: ${f.focusTitle}` : "") +
          (f.fruit ? `\n🍊 Fruit: ${pname(f.fruit)}` : "")
        )}>
        Share to WhatsApp
      </a>
    </div>
  </>);
}

function PlayerSheet({ data, persist, payload, me, close }) {
  const [p, setP] = useState(() => {
    const base = payload || { id: uid(), name: "", number: "", position: "MID" };
    // Migrate any legacy single-parent fields into the guardians array on open.
    if (!base.guardians) {
      base.guardians = (base.parentName || base.parentContact || (base.parentEmails || []).length)
        ? [{ name: base.parentName || "", mobile: base.parentContact || "", email: (base.parentEmails || [])[0] || "" }]
        : [];
    }
    return JSON.parse(JSON.stringify(base));
  });
  const setG = (i, patch) => setP({ ...p, guardians: p.guardians.map((g, j) => j === i ? { ...g, ...patch } : g) });
  const addG = () => setP({ ...p, guardians: [...p.guardians, { name: "", mobile: "", email: "" }] });
  const delG = (i) => setP({ ...p, guardians: p.guardians.filter((_, j) => j !== i) });

  const save = () => {
    if (!p.name) return;
    const guardians = (p.guardians || []).filter(g => g.name || g.mobile || g.email);
    // Keep legacy fields in sync for reminders, login resolution, contact display.
    const np = {
      ...p, number: +p.number || 0, guardians,
      parentName: guardians[0]?.name || "",
      parentContact: guardians[0]?.mobile || "",
      parentEmails: [...new Set(guardians.map(g => (g.email || "").trim().toLowerCase()).filter(Boolean))]
    };
    const exists = data.players.some(x => x.id === p.id);
    const players = exists ? data.players.map(x => x.id === p.id ? np : x) : [...data.players, np];
    persist({ ...data, players, isSample: false }); close();
  };
  return (<>
    <SheetHead title={payload ? "Edit player" : "Add player"} close={close} />
    <div className="field"><label>Name</label><input className="inp" value={p.name} autoFocus onChange={e => setP({ ...p, name: e.target.value })} /></div>
    <div className="row2">
      <div className="field"><label>Jersey number</label><input className="inp" type="number" value={p.number} onChange={e => setP({ ...p, number: e.target.value })} /></div>
      <div className="field"><label>Birthday</label><input className="inp" type="date" value={p.dob || ""} onChange={e => setP({ ...p, dob: e.target.value })} /></div>
    </div>
    <div className="field"><label>Position</label>
      <div className="seg">{POSITIONS.map(pos => <button key={pos} className={p.position === pos ? "sel" : ""} onClick={() => setP({ ...p, position: pos })}>{pos}</button>)}</div>
    </div>

    <div className="field" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <label>Parents / guardians (coach only)</label>
      {p.guardians.map((g, i) => (
        <div key={i} style={{ background: "var(--soft)", borderRadius: 12, padding: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <input className="inp" style={{ flex: 1 }} value={g.name} placeholder={`Parent ${i + 1} name`} onChange={e => setG(i, { name: e.target.value })} />
            <button className="chip" onClick={() => delG(i)} style={{ flexShrink: 0 }}><Trash2 size={13} /></button>
          </div>
          <input className="inp" style={{ marginBottom: 6 }} value={g.mobile} placeholder="Mobile e.g. 0400 000 000" onChange={e => setG(i, { mobile: e.target.value })} />
          <input className="inp" value={g.email} placeholder="Email (used for parent login)" onChange={e => setG(i, { email: e.target.value })} />
        </div>
      ))}
      <button className="chip" onClick={addG}><Plus size={13} />Add a parent / guardian</button>
      <div className="note" style={{ marginTop: 6 }}>Record both parents so either can log in, and so coaches can WhatsApp, call or text them. Email is the parent login key.</div>
    </div>

    {!me && <div className="field">
      <label>Family PIN (optional)</label>
      <input className="inp" type="tel" value={p.pin || ""} onChange={e => setP({ ...p, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="e.g. 1234 — only needed if you want sign-in protected" />
      <div className="note" style={{ marginTop: 4 }}>If set, this family must enter it to sign in and respond as themselves. Leave blank for one-tap sign-in.</div>
    </div>}

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

// Coach-only position ratings (0-5 per line, null = not rated) and a private
// note, saved through /api/player-coach one field at a time.
const RATING_LINES = ["GK", "DEF", "MID", "FWD"];
function RatingsCard({ player, patchLocal }) {
  const coach = player.coach || {};
  const ratings = { GK: null, DEF: null, MID: null, FWD: null, ...(coach.ratings || {}) };
  const [note, setNote] = useState(coach.note || "");
  const [err, setErr] = useState("");
  useEffect(() => { setNote(coach.note || ""); }, [coach.note]);
  const setCoach = (c) => patchLocal((d) => ({ ...d, players: (d.players || []).map((x) => x.id === player.id ? { ...x, coach: c } : x) }));
  const save = async (body, optimistic) => {
    const prev = player.coach;
    setErr("");
    setCoach(optimistic);
    try {
      const res = await fetchJson("/api/player-coach", { playerId: player.id, ...body });
      if (res?.coach) setCoach(res.coach);
    } catch (e) {
      setCoach(prev);
      setErr(saveErrorText(e));
    }
  };
  const setRating = (k, n) => {
    const next = { ...ratings, [k]: ratings[k] === n ? 0 : n };
    save({ ratings: next }, { ...coach, ratings: next });
  };
  const saveNote = () => {
    const t = note.trim().slice(0, 400);
    if (t === (coach.note || "")) return;
    save({ note: t }, { ...coach, note: t });
  };
  return (
    <div className="card" style={{ marginTop: 12, marginBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <span className="label">Ratings</span>
        <span className="coachonly"><Lock size={11} />Coach only</span>
      </div>
      {RATING_LINES.map((k) => {
        const r = ratings[k];
        return (
          <div className="swrow" key={k}>
            <span style={{ width: 36, fontWeight: 800, fontSize: 12.5 }}>{k}</span>
            <div className="pips">
              {[1, 2, 3, 4, 5].map((n) => (
                <i key={n} role="button" tabIndex={0} aria-label={k + " " + n} aria-pressed={r === n}
                  className={r != null && r >= n ? "on" : ""}
                  onClick={() => setRating(k, n)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRating(k, n); } }} />
              ))}
            </div>
            <span className="note" style={{ width: 64, textAlign: "right", fontWeight: 700 }}>{r == null ? "Not rated" : r}</span>
          </div>
        );
      })}
      <div className="note" style={{ marginTop: 8 }}>0 to 5 for each line. Suggest never places a 0.</div>
      <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
        <label>Coach note</label>
        <textarea className="inp" rows={3} maxLength={400} value={note} aria-label="Coach note" style={{ resize: "vertical" }}
          placeholder={"Anything to remember about " + firstName(player.name)}
          onChange={(e) => setNote(e.target.value)} onBlur={saveNote} />
      </div>
      {err && <div className="note" style={{ color: "var(--red)", marginTop: 6 }}>{err}</div>}
    </div>
  );
}

function PlayerViewSheet({ data, persist, patchLocal, payload, isCoach, viewer, me, close }) {
  const [p, setP] = useState(payload);
  // The sheet's payload is a snapshot; ratings and notes are read live from data.
  const live = (data.players || []).find((x) => x.id === p.id) || p;
  const played = data.fixtures.filter(f => f.status === "played");
  let g = 0, a = 0;
  played.forEach(f => { g += (f.goals || []).filter(x => x.pid === p.id).reduce((s, x) => s + x.n, 0); a += (f.assists || []).filter(x => x.pid === p.id).reduce((s, x) => s + x.n, 0); });
  // Games and minutes come from saved match records (written after full time).
  const season = data.fixtures.reduce((acc, f) => {
    const m = (f.record?.minutes || []).find((x) => x.pid === p.id);
    if (m && m.min > 0) { acc.games++; acc.min += m.min; }
    return acc;
  }, { games: 0, min: 0 });
  const guardians = p.guardians && p.guardians.length
    ? p.guardians
    : (p.parentName || p.parentContact) ? [{ name: p.parentName, mobile: p.parentContact, email: (p.parentEmails || [])[0] }] : [];
  // Photos still go through the whole-document write, which the server only
  // accepts from a coach — so account-mode parents don't get a button that
  // would be refused. Legacy devices keep the per-child identity check.
  const canEditPhoto = isCoach || (!me && viewer?.kind === "parent" && viewer.pid === p.id);

  const savePhoto = async (file) => {
    if (!file) return;
    try {
      const photo = await downscaleImage(file, 320);
      const np = { ...p, photo };
      setP(np);
      persist({ ...data, players: data.players.map(x => x.id === p.id ? { ...x, photo } : x), isSample: false });
    } catch {}
  };

  return (<>
    <SheetHead title={p.name} close={close} />
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
      <div style={{ position: "relative" }}>
        {p.photo
          ? <img className="pnum photo" style={{ width: 64, height: 64, borderRadius: 16 }} src={p.photo} alt={p.name} />
          : <div className="pnum" style={{ width: 64, height: 64, fontSize: 28 }}>{p.number}</div>}
        {p.photo && <span className="numbadge" style={{ minWidth: 22, height: 22, fontSize: 13 }}>{p.number}</span>}
      </div>
      <div>
        <span className={"pos-pill pos-" + p.position}>{p.position}</span>
        {canEditPhoto && (
          <div style={{ marginTop: 8 }}>
            <label className="chip" style={{ cursor: "pointer" }}>
              <Plus size={13} />{p.photo ? "Change photo" : "Add photo"}
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => savePhoto(e.target.files?.[0])} />
            </label>
          </div>
        )}
      </div>
    </div>
    <div className="statgrid" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
      <div className="stat"><div className="v">{season.games}</div><div className="k">Games</div></div>
      <div className="stat"><div className="v">{Math.round(season.min)}</div><div className="k">Min</div></div>
      <div className="stat"><div className="v">{g}</div><div className="k">Goals</div></div>
      <div className="stat"><div className="v">{a}</div><div className="k">Assists</div></div>
    </div>
    {isCoach && <RatingsCard player={live} patchLocal={patchLocal} />}
    {p.dob && (
      <div className="note" style={{ marginTop: 12, fontSize: 13.5 }}>
        🎂 Birthday: {new Date(p.dob + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "long" })}
      </div>
    )}
    {isCoach && guardians.map((gd, i) => (
      <div className="card" key={i} style={{ marginTop: 12, marginBottom: 0 }}>
        <div className="label" style={{ marginBottom: 8 }}>{gd.name || `Parent ${i + 1}`}</div>
        <div className="chips">
          {gd.mobile && <a className="washare" href={`https://wa.me/${intlPhone(gd.mobile)}`} target="_blank" rel="noopener noreferrer"><Send size={13} />WhatsApp</a>}
          {gd.mobile && <a className="chip lnk" href={"tel:" + gd.mobile.replace(/\s+/g, "")}><Phone size={13} />Call</a>}
          {gd.mobile && <a className="chip lnk" href={"sms:" + gd.mobile.replace(/\s+/g, "")}><MessageSquare size={13} />Text</a>}
          {gd.email && <a className="chip lnk" href={"mailto:" + gd.email}><Mail size={13} />Email</a>}
        </div>
        {gd.mobile && <div className="note" style={{ marginTop: 6, fontSize: 11 }}>{gd.mobile}</div>}
      </div>
    ))}
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

function PlayersImportSheet({ data, persist, close }) {
  const [txt, setTxt] = useState("");
  // Parsing (Majestri CSV / Excel copy / simple list) lives in lib/majestri.js,
  // shared with the /admin team wizard's import step.
  const { isMajestri, players: parsed } = useMemo(() => parsePlayerImport(txt), [txt]);

  const save = () => {
    if (!parsed.length) return;
    persist({ ...data, players: [...data.players, ...parsed], isSample: false });
    close();
  };

  return (<>
    <SheetHead title="Paste player list" close={close} />
    <div className="note" style={{ marginBottom: 12 }}>
      <b>Majestri:</b> copy the export and paste it here — from the CSV file directly, or straight out of <b>Excel</b> (with or without the header row); it's detected automatically. Players only: coach rows, emails and medical fields are skipped; mobiles get their leading 0 restored.<br /><br />
      <b>Or a simple list</b>, one player per line: <b>Name, number, position, parent, parent mobile, birthday</b> (position GK/DEF/MID/FWD; birthday dd/mm/yyyy; only the name is required).
    </div>
    <div className="field">
      <textarea className="inp" rows={8} value={txt} onChange={e => setTxt(e.target.value)}
        placeholder={"Paste the Majestri CSV export here, or:\nSpencer, 6, MID, Damien, 0400 000 000, 12/03/2018"} />
    </div>
    {txt.trim() && (
      <div className="note" style={{ marginBottom: 10 }}>
        {isMajestri && <span><b>Majestri export detected.</b> </span>}
        {parsed.length > 0
          ? <>Ready to add <b>{parsed.length}</b> player{parsed.length > 1 ? "s" : ""}: {parsed.map(p => p.name).join(", ")}</>
          : "Nothing parseable yet — check the format."}
      </div>
    )}
    <button className="btn" onClick={save} disabled={!parsed.length}>Add {parsed.length || ""} players</button>
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

function SessionSheet({ data, persist, payload: s, occ, isCoach, viewer, me, setModal, close }) {
  const showISO = occ || s.dateISO;
  const Icon = s.kind === "event" ? Star : Dumbbell;
  const del = () => { persist({ ...data, sessions: (data.sessions || []).filter(x => x.id !== s.id), isSample: false }); close(); };

  // Attendance is stored per-occurrence: s.availability[occurrenceISO][playerId] = { status, reason, by, at }
  const past = showISO && showISO < isoLocal(new Date());
  const account = !!me;
  const ownIds = me ? (me.playerIds || []) : null;
  const canEdit = (pid) => isCoach || (account ? ownIds.includes(pid) : (viewer?.kind === "parent" && viewer.pid === pid));
  const byFor = (pid) => isCoach ? "Coach" : account ? (data.players.find((p) => p.id === pid)?.name || "Parent") : (viewer?.label || "you");
  const dayAvail = (s.availability && s.availability[showISO]) || {};
  const [avail, setAvail] = useState(dayAvail);
const setAv = async (pid, patch) => {
    const cur = avail[pid] || {};
    const merged = { ...cur, ...patch };
    const status = merged.status ?? null;
    const reason = status === "out" ? (merged.reason || "Away") : undefined;
    const optimistic = status == null
      ? null
      : { status, ...(reason ? { reason } : {}), by: byFor(pid), at: Date.now() };
    const nextAvail = { ...avail };
    if (optimistic == null) delete nextAvail[pid]; else nextAvail[pid] = optimistic;
    setAvail(nextAvail);
    try {
      const res = await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "session", id: s.id, occ: showISO, playerId: pid, status, reason })
      });
      if (!res.ok) throw new Error("rsvp " + res.status);
    } catch (e) {
      setAvail(avail);
      console.error("Could not save availability:", e);
    }
  };
  const aplayers = data.players.filter(p => activeOn(p, showISO)).sort((a, b) => a.number - b.number);
  const counts = aplayers.reduce((c, p) => {
    const st = avail[p.id]?.status;
    if (st === "in") c.in++; else if (st === "out") c.out++; else c.nr++;
    return c;
  }, { in: 0, out: 0, nr: 0 });
  const nonResponders = aplayers.filter(p => !avail[p.id]?.status);
  const remindText = (p) =>
    `Hi${p.parentName ? " " + p.parentName.split(" ")[0] : ""}! Quick one — could you mark ${p.name} In or Out for ${s.title} on ${fmtDate(showISO)}${s.time ? " at " + s.time : ""} on the team page? Thanks! ⚽`;
  const groupNudge = `📋 ${s.title} — ${fmtDate(showISO)}${s.time ? " " + s.time : ""}\nStill need In/Out from: ${nonResponders.map(p => p.name).join(", ")}\nPlease respond on the team page 🙏`;
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

    {aplayers.length > 0 && (
      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>
          {past ? "Attendance" : (s.kind === "event" ? "Who's coming? Tap your player" : "Who's training? Tap your player")}
        </div>
        <div className="avsum">
          <span className="avpill in"><Check size={13} />{counts.in} in</span>
          <span className="avpill out"><X size={13} />{counts.out} out</span>
          <span className="avpill nr">{counts.nr} no reply</span>
        </div>
        {!past && !account && viewer?.kind !== "parent" && !isCoach && (
          <button className="btn" style={{ marginBottom: 12 }} onClick={() => { close(); setModal({ type: "signin" }); }}>
            Sign in to mark your child
          </button>
        )}
        {aplayers.map(p => {
          const a = avail[p.id] || {};
          const editable = !past && canEdit(p.id);
          return (
            <div className="avrow" key={p.id} style={editable ? undefined : { opacity: .82 }}>
              <div className="avname">
                {p.number}. {p.name}
                {a.by && a.status && <div className="note" style={{ fontSize: 10.5, fontWeight: 500 }}>{a.status === "in" ? "In" : "Out"} · {a.by}{a.at ? " · " + fmtWhen(a.at) : ""}</div>}
              </div>
              {editable ? <>
                <button className={"avbtn" + (a.status === "in" ? " selin" : "")}
                  onClick={() => setAv(p.id, { status: a.status === "in" ? null : "in", reason: undefined })}>In</button>
                <button className={"avbtn" + (a.status === "out" ? " selout" : "")}
                  onClick={() => setAv(p.id, { status: a.status === "out" ? null : "out", reason: a.reason || "Away" })}>Out</button>
                {a.status === "out" && (
                  <select className="avsel" value={a.reason || "Away"} onChange={e => setAv(p.id, { status: "out", reason: e.target.value })}>
                    {ABSENCE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}
              </> : (
                <span className={"avpill " + (a.status === "in" ? "in" : a.status === "out" ? "out" : "nr")}>
                  {a.status === "in" ? "In" : a.status === "out" ? (a.reason || "Out") : "—"}
                </span>
              )}
            </div>
          );
        })}
        <div className="note" style={{ marginTop: 10 }}>
          {past ? "This session has passed." : isCoach ? "As coach you can mark anyone." : account ? rsvpNoteFor(me) : viewer?.kind === "parent"
            ? `You're marking ${viewer.label}. Replies save instantly and are recorded with your name.`
            : "Sign in (top right) to respond for your child."}
        </div>
        {!past && isCoach && nonResponders.length > 0 && (
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
