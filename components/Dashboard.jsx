"use client";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Home, CalendarDays, Users, Apple, ShieldCheck, Plus, Pencil,
  Trash2, X, Lock, Unlock, Trophy, MapPin, Clock, ChevronRight, Check,
  Settings as SettingsIcon, Star, Info,
  Calendar, ClipboardList, ChevronLeft, Dumbbell, Repeat, Play, Download,
  Send, Phone, MessageSquare, Mail, Sparkles, FileText, Cake, Shirt, GripVertical,
  Eye, User, LogOut, Navigation, Video
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
import { crestFor, OUR_CREST } from "@/lib/clubs";
import { hatLabel, joinNames as joinKidNames } from "@/lib/hats";
import { signOut } from "next-auth/react";

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
   STYLES — Direction C "Clean sheet": white cards on paper, one red,
   no gradients, no dark chrome (the toast is the only ink fill).
============================================================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700;9..40,800&family=DM+Mono:wght@500&display=swap');
:root{
  /* Direction C (Sep 2026): no gradients, no dark chrome, no page glow. Mirrors
     .claude/skills/olympic-fc-team-hub-design/tokens/*.css. */
  --pitch:#C8102E; --pitch-d:#7A0A1B; --ink:#1A1012; --muted:#6B5A5D;
  --lime:#FFFFFF; --amber:#F6A623; --paper:#F4F4F3; --card:#ffffff;
  --line:#E7E3E3; --red:#E5484D; --soft:#F1EDEE; --win:#1E9E57;
  --red-tint:#FDEAEC; --red-strong:#C0393D; --amber-tint:#FFF1DA; --amber-strong:#B3760A;
  --green-tint:#E6F6EC; --green-strong:#1F8A4C;
  --blue-tint:#E6F0FF; --blue-strong:#2563A8; --pink-tint:#FCE7F3; --pink-strong:#BE185D;
  --ev-birthday:#BE185D; --chart-against:#D9D3D4; --row-mine:#FFF7F8;
  --card-gap:14px;
  --header-bg:rgba(255,255,255,.96); --header-blur:10px;
  --nav-bg:rgba(255,255,255,.96); --nav-blur:12px; --nav-inset:14px;
  --nav-active-bg:#FDEAEC; --nav-active-fg:var(--pitch); --nav-idle-fg:var(--muted);
  --shadow-nav:0 10px 30px rgba(26,16,18,.14);
  --sheet-overlay:rgba(26,16,18,.38); --shadow-sheet:0 -10px 30px rgba(26,16,18,.18);
  --toast-bg:var(--ink); --shadow-toast:0 10px 30px rgba(20,6,10,.3);
  --crest-ring:0 0 0 2px var(--pitch);
  --seg-track:var(--line); --seg-thumb-shadow:0 1px 2px rgba(10,30,18,.08);
  --r-sheet:20px; --r-seg:13px; --r-seg-thumb:11px; --r-icon-sm:9px;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
/* Bottom clearance (brief override 2): nav bottom offset 14 + nav height 62
   (48 item + 6×2 padding + 1×2 border) + 38 content clearance = 114px. */
.fqd{font-family:'DM Sans',system-ui,sans-serif;color:var(--ink);background:var(--paper);
  min-height:100vh;max-width:560px;margin:0 auto;position:relative;padding-bottom:114px;}
.fqd h1,.fqd h2,.fqd h3,.disp{font-family:'Anton',sans-serif;font-weight:400;letter-spacing:.01em;text-transform:uppercase;}
.num{font-family:'DM Mono',monospace;}
/* header — white 96% + blur, hairline below, sticky. Root variant: crest + team
   name + kicker; sub variant: back button + title + kicker. Condenses (kicker
   hidden) after 24px of window scroll. */
.head{position:sticky;top:0;z-index:20;background:var(--header-bg);color:var(--ink);
  backdrop-filter:blur(var(--header-blur));-webkit-backdrop-filter:blur(var(--header-blur));
  border-bottom:1px solid var(--line);padding:12px 16px 10px;display:flex;align-items:center;gap:10px;}
.head .hcrest{width:30px;height:31px;object-fit:contain;flex-shrink:0;}
.head .backbtn{width:36px;height:36px;border-radius:12px;border:none;background:var(--soft);color:var(--ink);
  display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;margin-left:-4px;padding:0;}
.head .hbody{flex:1;min-width:0;}
.head .hname{font-weight:800;font-size:14px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.head .hname.sub{font-size:15px;}
.head .hkick{font-size:11px;color:var(--muted);font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.hatchip{background:var(--nav-active-bg);color:var(--pitch);border:none;border-radius:999px;padding:6px 10px;
  font:inherit;font-size:10.5px;font-weight:800;min-height:32px;cursor:pointer;flex-shrink:0;white-space:nowrap;}
.wrap{padding:16px 16px 8px;}
.banner{background:#fff8e6;border:1px solid #f3dca0;color:#7a5a12;border-radius:14px;
  padding:11px 13px;font-size:12.5px;display:flex;gap:9px;align-items:flex-start;margin-bottom:14px;}
.banner button{margin-left:auto;background:var(--amber);color:#fff;border:none;border-radius:8px;
  padding:6px 10px;font-weight:700;font-size:11px;cursor:pointer;white-space:nowrap;}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;
  box-shadow:0 1px 2px rgba(10,30,18,.04);margin-bottom:14px;}
.label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700;}
.statgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
.stat{background:var(--soft);border-radius:14px;padding:12px 8px;text-align:center;}
.stat .v{font-family:'Anton';font-size:24px;line-height:1;}
.stat .k{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:4px;font-weight:700;}
/* home (S2): next game, duties, next 7 days, season, birthdays */
.nextgame{padding:16px 16px 14px;}
.ng-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:14px;}
.ng-label{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--pitch);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ng-cd{font-size:12px;color:var(--muted);font-weight:600;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;flex-shrink:0;}
.matchup{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;}
.mu-side{display:flex;flex-direction:column;align-items:center;gap:7px;text-align:center;min-width:0;}
.mu-crest{width:48px;height:48px;border-radius:50%;object-fit:cover;flex-shrink:0;}
.mu-crest.ours{box-shadow:var(--crest-ring);}
.mu-disc{width:48px;height:48px;border-radius:50%;background:var(--soft);display:inline-flex;align-items:center;justify-content:center;
  font-size:14px;font-weight:800;color:var(--muted);flex-shrink:0;}
.mu-name{font-size:12px;font-weight:600;line-height:1.25;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.mu-name.ours{font-weight:800;color:var(--ink);}
.mu-centre{text-align:center;padding:0 6px;}
.mu-time{font-family:'Anton',sans-serif;font-weight:400;font-size:30px;line-height:1;color:var(--pitch);}
.mu-date{font-size:10px;color:var(--muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-top:5px;white-space:nowrap;}
.ng-venue{border-top:1px solid var(--line);margin-top:14px;padding-top:11px;display:flex;align-items:center;justify-content:space-between;gap:8px;}
.ng-place{font-size:12px;color:var(--muted);display:inline-flex;align-items:center;gap:5px;min-width:0;}
.ng-place svg{flex-shrink:0;}
.ng-place span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.softpill{background:var(--soft);color:var(--ink);border:none;border-radius:999px;padding:7px 12px;font:inherit;font-size:12px;font-weight:800;
  cursor:pointer;min-height:32px;flex-shrink:0;}
.replyrows{margin-top:10px;}
.replyrow{display:flex;align-items:center;gap:10px;padding:8px 0 2px;}
.avatar{width:34px;height:34px;border-radius:50%;background:var(--soft);display:inline-flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:800;color:var(--muted);flex-shrink:0;}
.rr-body{flex:1;min-width:0;}
.rr-name{font-weight:800;font-size:14px;}
.rr-hint{font-size:12px;color:var(--muted);}
.rr-btn{border:none;border-radius:999px;padding:9px 14px;font:inherit;font-size:12px;font-weight:800;cursor:pointer;min-height:36px;flex-shrink:0;
  background:var(--pitch);color:#fff;}
.rr-btn.in{background:var(--green-tint);color:var(--green-strong);}
.rr-btn.out{background:var(--red-tint);color:var(--red-strong);}
.ng-counts{margin-top:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;}
.ng-counts .ghostlink{padding:6px 0;min-height:36px;font-size:13px;white-space:nowrap;}
.cpills{display:flex;gap:6px;flex-wrap:wrap;}
.cpill{border-radius:999px;padding:5px 10px;font-size:12px;font-weight:800;background:var(--soft);color:var(--muted);}
.cpill.in{background:var(--green-tint);color:var(--green-strong);} .cpill.out{background:var(--red-tint);color:var(--red-strong);}
.dutycard{padding:12px 16px;display:flex;align-items:center;gap:12px;cursor:pointer;text-align:left;color:var(--ink);}
.dc-slot{display:flex;align-items:center;gap:9px;flex:1;min-width:0;}
.dc-ic{width:30px;height:30px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.dc-ic.fruit{background:var(--amber-tint);color:var(--amber-strong);} .dc-ic.gk{background:var(--red-tint);color:var(--pitch);}
.dc-ic.jersey{background:var(--blue-tint);color:var(--blue-strong);}
.dc-txt{min-width:0;}
.dc-label{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);}
.dc-val{font-size:12.5px;font-weight:800;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dc-val.none{color:var(--muted);}
.dc-div{width:1px;align-self:stretch;background:var(--line);flex-shrink:0;}
.week{padding:12px 16px 4px;}
.wk-head{display:flex;justify-content:space-between;align-items:center;}
.wk-head .ghostlink{padding:4px 0;min-height:32px;display:inline-flex;align-items:center;}
.wk-empty{padding:10px 0 8px;}
.wk-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);cursor:pointer;}
.wk-row:last-child{border-bottom:none;}
.wk-row.static{cursor:default;}
.wk-day{width:34px;text-align:center;flex-shrink:0;}
.wk-dow{font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);}
.wk-num{font-family:'Anton',sans-serif;font-weight:400;font-size:20px;line-height:1;margin-top:1px;}
.wk-ic{width:32px;height:32px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.wk-ic.game{background:var(--red-tint);color:var(--pitch);} .wk-ic.training{background:var(--amber-tint);color:var(--amber-strong);}
.wk-ic.birthday{background:var(--pink-tint);color:var(--pink-strong);} .wk-ic.event{background:var(--blue-tint);color:var(--blue-strong);}
.wk-body{flex:1;min-width:0;}
.wk-title{font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wk-title.off{color:var(--muted);text-decoration:line-through;}
.wk-meta{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wk-pill{font-size:11px;font-weight:800;border-radius:999px;padding:4px 8px;flex-shrink:0;white-space:nowrap;background:var(--soft);color:var(--muted);}
.wk-pill.in{background:var(--green-tint);color:var(--green-strong);} .wk-pill.out{background:var(--red-tint);color:var(--red-strong);}
.season{padding:12px 16px 14px;}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
.tile{background:var(--paper);border-radius:14px;padding:10px 6px;text-align:center;}
.tile .v{font-family:'Anton',sans-serif;font-weight:400;font-size:24px;line-height:1;}
.tile .k{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:4px;}
.tile.pts{background:var(--red-tint);} .tile.pts .v,.tile.pts .k{color:var(--pitch);}
.formrow{display:flex;gap:6px;margin-top:12px;align-items:center;}
.formrow .label{margin-right:6px;}
.pip{width:24px;height:24px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;color:#fff;}
.pip.W{background:var(--win);} .pip.D{background:#9AA3A6;} .pip.L{background:var(--red);}
.formrow .fa{margin-left:auto;font-size:12px;color:var(--muted);font-weight:600;white-space:nowrap;}
.footnote{font-size:11px;color:var(--muted);margin-top:10px;line-height:1.45;}
.bdays{padding:12px 16px 6px;}
.bd-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);}
.bd-row:last-child{border-bottom:none;}
/* reply sheet */
.rs-title{font-size:20px;font-weight:800;line-height:1.2;}
.rs-sub{font-size:13px;color:var(--muted);margin-top:4px;}
.rs-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px;}
.rs-btn{border:none;border-radius:14px;padding:18px 12px;font:inherit;font-size:17px;font-weight:800;cursor:pointer;min-height:64px;
  display:flex;align-items:center;justify-content:center;gap:8px;}
.rs-btn.in{background:var(--green-tint);color:var(--green-strong);} .rs-btn.in.sel{background:var(--win);color:#fff;}
.rs-btn.out{background:var(--red-tint);color:var(--red-strong);} .rs-btn.out.sel{background:var(--red);color:#fff;}
.rs-note{margin-top:12px;width:100%;border:1px solid var(--line);border-radius:11px;padding:12px 14px;font:inherit;font-size:14px;
  background:var(--paper);color:var(--ink);outline:none;min-height:44px;}
.rs-note:focus{border-color:var(--pitch);}
.rs-foot{font-size:12px;color:var(--muted);margin-top:10px;}
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
.crest{width:30px;height:30px;object-fit:cover;border-radius:50%;flex-shrink:0;vertical-align:middle;}
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
/* nav — five roots; slides away while a text field has focus */
.nav{position:fixed;bottom:var(--nav-inset);left:var(--nav-inset);right:var(--nav-inset);margin:0 auto;max-width:532px;
  background:var(--nav-bg);backdrop-filter:blur(var(--nav-blur));-webkit-backdrop-filter:blur(var(--nav-blur));
  border:1px solid var(--line);border-radius:20px;display:flex;padding:6px;z-index:30;box-shadow:var(--shadow-nav);
  transition:transform .26s cubic-bezier(.2,.8,.2,1);}
.nav.hide{transform:translateY(160px);}
.nav button{flex:1;min-height:48px;background:none;border:none;color:var(--nav-idle-fg);display:flex;
  flex-direction:column;align-items:center;gap:3px;padding:7px 2px;cursor:pointer;font:inherit;font-size:10px;
  font-weight:700;letter-spacing:.03em;border-radius:14px;transition:background .18s,color .18s;}
.nav button.active{color:var(--nav-active-fg);background:var(--nav-active-bg);}
.nav button span{text-transform:uppercase;}
/* toast — bottom = 14 nav offset + 62 nav height + 16 = 92px */
.toast{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:60;background:var(--toast-bg);color:#fff;
  border-radius:999px;padding:10px 16px;font-size:13px;font-weight:700;text-align:center;max-width:calc(100% - 32px);
  box-shadow:var(--shadow-toast);animation:toastin .2s ease;cursor:pointer;}
@keyframes toastin{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
/* sheet */
.ov{position:fixed;inset:0;background:var(--sheet-overlay);z-index:50;display:flex;align-items:flex-end;
  justify-content:center;animation:fade .2s;}
@keyframes fade{from{opacity:0}to{opacity:1}}
.sheet{background:#fff;width:100%;max-width:560px;border-radius:var(--r-sheet) var(--r-sheet) 0 0;max-height:82vh;overflow-y:auto;
  padding:10px 16px 44px;box-shadow:var(--shadow-sheet);animation:rise .26s cubic-bezier(.2,.8,.2,1);}
@keyframes rise{from{transform:translateY(40px)}to{transform:translateY(0)}}
.sheet .grab{width:36px;height:4px;border-radius:2px;background:var(--line);margin:0 auto 14px;}
/* viewing-as sheet */
.hs-title{font-size:20px;font-weight:800;line-height:1.2;}
.hs-sub{font-size:13px;color:var(--muted);margin-top:4px;}
.hs-list{margin-top:10px;}
.hs-row{width:100%;background:none;border:none;border-bottom:1px solid var(--line);padding:14px 0;display:flex;align-items:center;
  gap:12px;cursor:pointer;text-align:left;color:var(--ink);min-height:56px;font:inherit;text-decoration:none;}
.hs-row .disc,.hs-row .ico{width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:800;flex-shrink:0;background:var(--soft);color:var(--muted);}
.hs-row .ico{color:var(--ink);}
.hs-row .disc.on{background:var(--pitch);color:#fff;}
.hs-row .txt{flex:1;min-width:0;}
.hs-row .txt b{display:block;font-size:15px;font-weight:800;}
.hs-row .txt span{display:block;font-size:12px;color:var(--muted);margin-top:1px;}
.hs-label{margin-top:16px;}
.hs-out{margin-top:14px;background:none;border:none;color:var(--muted);font:inherit;font-size:13px;font-weight:700;cursor:pointer;
  display:inline-flex;align-items:center;gap:6px;padding:8px 0;min-height:40px;}
.ghostlink{background:none;border:none;color:var(--pitch);font:inherit;font-size:12px;font-weight:800;cursor:pointer;padding:8px 0 0;}
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
.chips{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:6px;}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:#fafbfa;
  border-radius:999px;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer;color:var(--ink);}
.chip .t{font-family:'DM Mono';font-size:11px;color:var(--pitch);font-weight:500;}
.chip.act{background:var(--pitch);color:#fff;border-color:var(--pitch);} .chip.act .t{color:var(--lime);}
.chip.add{border-style:dashed;color:var(--muted);}
.chrow{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.chrow input.lab{flex:1;}
.chrow input.tm{width:78px;text-align:center;font-family:'DM Mono';}
.copybox{background:var(--soft);border-radius:12px;padding:12px;font-family:'DM Mono';font-size:12px;
  white-space:pre-wrap;line-height:1.7;margin-bottom:8px;color:var(--ink);}
/* calendar (S4, Direction C): month grid card, list card, day sheet, subscribe card */
.calgrid{padding:12px 12px 10px;}
.cg-head{display:flex;align-items:center;justify-content:space-between;padding:0 2px 8px;}
.cg-nav{width:36px;height:36px;border-radius:12px;border:none;background:var(--soft);color:var(--ink);
  display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex-shrink:0;}
.cg-nav:disabled{opacity:.3;cursor:default;}
.cg-month{font-weight:800;font-size:15px;}
.cg-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center;font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.06em;}
.cg-cells{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-top:4px;}
.cal-cell{height:54px;border:none;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
  padding:0;cursor:pointer;background:transparent;color:var(--ink);font:inherit;}
.cal-cell .n{font-size:13px;line-height:1;font-weight:500;}
.cal-cell.today{background:var(--red-tint);color:var(--pitch);}
.cal-cell.sel{background:var(--pitch);color:#fff;}
.cal-cell.today .n,.cal-cell.sel .n{font-weight:800;}
.cal-blank{height:54px;}
.cal-crest{width:22px;height:22px;border-radius:50%;object-fit:cover;flex-shrink:0;}
.cal-crest.ph{display:inline-flex;align-items:center;justify-content:center;background:var(--soft);font-size:8px;font-weight:800;color:var(--muted);}
.cal-cell.sel .cal-crest.ph{background:rgba(255,255,255,.22);color:#fff;}
.cal-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
.cal-dot.training{background:var(--amber);} .cal-dot.birthday{background:var(--ev-birthday);} .cal-dot.event{background:var(--blue-strong);}
.cg-legend{display:flex;gap:14px;padding:10px 4px 0;font-size:11px;color:var(--muted);font-weight:600;flex-wrap:wrap;}
.cg-legend span{display:inline-flex;align-items:center;gap:5px;}
.cg-legend img{width:14px;height:14px;border-radius:50%;object-fit:cover;}
.callist .wk-empty{padding:16px 0 12px;font-size:14px;color:var(--muted);}
.day-title{font-size:20px;font-weight:800;line-height:1.2;}
.day-rows{margin-top:6px;}
.day-rows .wk-row{padding:12px 0;}
.day-rows .wk-ic{width:34px;height:34px;}
.day-rows .wk-empty{padding:16px 0 4px;font-size:14px;color:var(--muted);}
.subcard{padding:12px 16px 14px;}
.sub-text{font-size:13px;color:var(--muted);margin-top:4px;line-height:1.45;}
.sub-btns{display:flex;gap:8px;margin-top:12px;}
.sub-btns .softbtn{margin-top:0;flex:1;padding:11px 8px;font-size:13px;text-align:center;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;}
.sub-fine{font-size:11px;color:var(--muted);margin-top:10px;line-height:1.45;}
.sub-links{display:flex;gap:16px;flex-wrap:wrap;}
.sub-links .ghostlink{padding:8px 0 0;min-height:32px;display:inline-flex;align-items:center;gap:6px;}
.kpill{font-size:9px;font-weight:800;padding:2px 6px;border-radius:5px;text-transform:uppercase;letter-spacing:.04em;}
.kpill.game{background:#fdeaec;color:var(--pitch);} .kpill.training{background:#fff1da;color:#b3760a;} .kpill.event{background:#e6f0ff;color:#2563a8;} .kpill.birthday{background:#fde7f3;color:#d6409f;}
.recur-line{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--muted);margin-top:2px;}
.chip.lnk{text-decoration:none;}
.wabtn{display:flex;align-items:center;justify-content:center;gap:8px;background:#25D366;color:#fff;
  border:none;border-radius:18px;padding:12px 16px;font-weight:800;width:100%;font-size:15px;min-height:48px;cursor:pointer;
  text-decoration:none;margin-bottom:14px;}
.washare{display:inline-flex;align-items:center;gap:6px;background:#25D366;color:#fff;border-radius:999px;
  padding:7px 12px;font-size:12.5px;font-weight:700;text-decoration:none;}
/* weekly focus card (S3): label, title 17/800, question + points, coach line */
.focuscard{padding:12px 16px 14px;}
.fc-title{font-size:17px;font-weight:800;margin-top:6px;line-height:1.3;}
.fc-q{font-size:12px;color:var(--muted);margin-top:4px;line-height:1.4;}
.fc-pts{margin-top:8px;display:flex;flex-direction:column;gap:4px;}
.fc-pt{font-size:13px;display:flex;gap:8px;align-items:baseline;line-height:1.35;}
.fc-pt:before{content:"•";color:var(--pitch);flex-shrink:0;}
.fc-foot{font-size:12px;color:var(--muted);margin-top:8px;line-height:1.4;}
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
/* results (S3): compact season card, Results / Fixtures cards, match rows */
.season-mini{padding:12px 16px 14px;}
.sm-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}
.sm-head .ghostlink,.rl-head .ghostlink{padding:4px 0;min-height:32px;display:inline-flex;align-items:center;}
.sm-body{display:flex;align-items:center;gap:12px;}
.sm-pips{display:flex;gap:6px;align-items:center;}
.pip.lg{width:26px;height:26px;border-radius:8px;font-size:11px;}
.wdl{margin-left:auto;text-align:right;}
.wdl .v{font-family:'Anton',sans-serif;font-weight:400;font-size:22px;line-height:1;}
.wdl .k{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:3px;}
.reslist{padding:12px 16px 4px;}
.rl-head{display:flex;justify-content:space-between;align-items:center;}
.rl-empty{font-size:13px;color:var(--muted);padding:12px 0 10px;}
.res-foot{font-size:12px;margin-top:0;padding:0 4px;}
.mrow{display:flex;align-items:center;gap:8px;padding:13px 0;border-bottom:1px solid var(--line);cursor:pointer;}
.mrow:last-child{border-bottom:none;}
.mrow.canc{opacity:.5;}
.mr-round{width:34px;text-align:center;flex-shrink:0;}
.mr-round .r{font-family:'Anton',sans-serif;font-weight:400;font-size:18px;line-height:1;}
.mr-round .d{font-size:9.5px;color:var(--muted);margin-top:2px;white-space:nowrap;}
.mr-side{flex:1;min-width:0;display:flex;align-items:center;gap:8px;}
.mr-side.away{flex-direction:row-reverse;}
.mr-side.away .mr-name{text-align:right;}
.mcrest{width:30px;height:30px;border-radius:50%;object-fit:cover;flex-shrink:0;}
.mcrest.ph{display:inline-flex;align-items:center;justify-content:center;background:var(--soft);font-size:11px;font-weight:800;color:var(--muted);}
.mr-side.ours .mcrest{box-shadow:var(--crest-ring);}
.mr-name{font-size:12px;line-height:1.25;font-weight:600;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.mr-side.ours .mr-name{font-weight:800;color:var(--ink);}
.mr-centre{width:56px;text-align:center;flex-shrink:0;}
.mscore{font-family:'Anton',sans-serif;font-weight:400;font-size:20px;line-height:1;white-space:nowrap;}
.mscore.win{color:var(--win);} .mscore.loss{color:var(--red);} .mscore.draw{color:#9AA3A6;}
.mtime{font-family:'DM Mono',monospace;font-size:12px;font-weight:700;color:var(--amber);white-space:nowrap;}
.mstate{font-family:'DM Mono',monospace;font-size:12px;font-weight:500;color:var(--muted);white-space:nowrap;}
.mstate.none{font-size:11px;}
/* match detail (S3): hero, goals, video link card, who's in, match day card */
.mhero{padding:16px 16px 14px;}
.mh-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:8px;}
.mh-label{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--pitch);}
.mh-edit{background:none;border:none;color:var(--muted);font:inherit;font-size:12px;font-weight:800;cursor:pointer;padding:4px 0;
  display:inline-flex;align-items:center;gap:4px;min-height:28px;flex-shrink:0;}
.mu-big{font-family:'Anton',sans-serif;font-weight:400;font-size:34px;line-height:1;white-space:nowrap;color:var(--pitch);}
.mu-big.win{color:var(--win);} .mu-big.loss{color:var(--red);} .mu-big.draw{color:#9AA3A6;} .mu-big.none{color:var(--muted);}
.mu-sub{font-size:10px;color:var(--muted);font-weight:700;letter-spacing:.08em;margin-top:5px;white-space:nowrap;}
.mu-sub.up{text-transform:uppercase;}
.dirpill{background:var(--soft);color:var(--ink);border-radius:999px;padding:8px 12px;font-size:12px;font-weight:800;text-decoration:none;
  flex-shrink:0;display:inline-flex;align-items:center;gap:5px;min-height:32px;}
.mpills{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;}
.mpill{border-radius:999px;padding:5px 10px;font-size:12px;font-weight:800;background:var(--soft);color:var(--muted);}
.mpill.kit{background:var(--red-tint);color:var(--pitch);}
.goals{padding:12px 16px 4px;}
.goalrow{width:100%;background:none;border:none;border-bottom:1px solid var(--line);padding:11px 0;display:flex;align-items:center;gap:12px;
  cursor:pointer;text-align:left;color:var(--ink);font:inherit;}
.goalrow:last-child{border-bottom:none;}
.gr-disc{width:32px;height:32px;border-radius:50%;background:var(--soft);display:inline-flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:800;color:var(--muted);flex-shrink:0;}
.gr-name{flex:1;font-weight:800;font-size:14px;}
.gr-n{font-size:12px;color:var(--muted);}
.card.quiet{padding:14px 16px;font-size:13px;color:var(--muted);line-height:1.45;}
.linkcard{padding:12px 16px;display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--ink);cursor:pointer;width:100%;text-align:left;font:inherit;}
.lc-ic{width:36px;height:36px;border-radius:11px;background:var(--red-tint);color:var(--pitch);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.lc-body{flex:1;min-width:0;}
.lc-title{display:block;font-weight:800;font-size:14px;}
.lc-sub{display:block;font-size:12px;color:var(--muted);}
.whosin{padding:12px 16px 14px;}
.wi-head{display:flex;justify-content:space-between;align-items:center;gap:8px;}
.wi-count{font-size:12px;color:var(--muted);font-weight:600;white-space:nowrap;}
.softbtn{margin-top:10px;width:100%;background:var(--soft);color:var(--ink);border:none;border-radius:13px;padding:12px;font:inherit;
  font-size:14px;font-weight:800;cursor:pointer;min-height:44px;}
.dc-meta{font-size:12px;color:var(--muted);margin-top:3px;line-height:1.4;}
.sw{width:38px;height:22px;border-radius:999px;background:#D9D3D4;position:relative;flex-shrink:0;transition:background .18s}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .18s cubic-bezier(.2,.8,.2,1)}
.sw.on{background:var(--pitch)} .sw.on::after{transform:translateX(16px)}
.pips{display:flex;gap:6px;flex:1} .pips i{width:26px;height:26px;border-radius:50%;background:var(--soft);display:block} .pips i.on{background:var(--pitch)}
.coachonly{display:inline-flex;align-items:center;gap:5px;background:#fdeaec;color:var(--pitch);border-radius:999px;padding:4px 9px;font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}
/* small helpers for the coach settings cards and ratings */
button.sw{border:none;padding:0;cursor:pointer}
.pips i{cursor:pointer}
.swrow{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)} .swrow:last-child{border-bottom:none}
.rule{display:flex;align-items:center;gap:9px;padding:9px 0;border-bottom:1px solid var(--line)} .rule .n{width:22px;font-family:'Anton';font-size:15px;color:var(--muted);text-align:center} .rule .bi{font-size:9.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;background:var(--soft);color:var(--muted);border-radius:999px;padding:2px 7px} .rule.off{opacity:.5}
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
// Pure (reads only the team document) so the Match day card renders straight
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
// Sub-screens pushed over a root tab, with their header title and kicker.
// Settings is titled inline (its kicker is the team name).
const SUB_TITLES = {
  duties: ["Duties", "Fruit and goalkeeper rota"],
  stats: ["Stats", `Season ${SEASON}`]
};

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Chrome navigation: `tab` is the active bottom-nav root; `stack` holds the
  // sub-screens pushed on top of it as { id, payload } (duties, stats,
  // settings, match, whosin), last on top.
  const [tab, setTab] = useState("home");
  const [stack, setStack] = useState([]);
  // Coach mode. Account mode derives it from the server-resolved role (no
  // toggle); legacy team-code mode enters it from the Viewing-as sheet.
  const [isCoach, setIsCoach] = useState(false);
  const [viewer, setViewerState] = useState(() => readIdentity() || { kind: "guest" });
  const setViewer = (v) => { setViewerState(v); saveIdentity(v); };
  const [modal, setModal] = useState(null); // {type, payload}
  // The month the Calendar tab shows (index within SEASON). Lives here so the
  // root header's kicker can read it.
  const [calMonth, setCalMonth] = useState(() => { const t = new Date(); return t.getFullYear() === SEASON ? t.getMonth() : 0; });
  // Server-side identity/role (account mode). undefined until /api/me has
  // answered; null in legacy team-code mode (or when the call failed); the
  // account payload otherwise. Nothing coach-shaped renders while undefined,
  // so a slow answer can't expose the legacy PIN toggle to a parent.
  const [me, setMe] = useState(undefined);
  // Toast: one short line saying what just happened (a refused write, an
  // undone save). 2.2s, then gone. Every notice surfaces here.
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = useCallback((msg) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const setNotice = showToast;
  // Header condenses (kicker hidden) after 24px of window scroll — the .fqd
  // column is the page, so the window is what scrolls.
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    const onScroll = () => setCondensed((window.scrollY || 0) > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // The nav slides away while a text field anywhere in .fqd has focus. React's
  // onFocus/onBlur on the root are focusin/focusout, so they bubble from inputs.
  const [typing, setTyping] = useState(false);
  const isTextField = (el) => !!(el && el.matches && el.matches("input,textarea,select")) && !/^(checkbox|radio)$/i.test(el.type || "");
  const onFocusIn = (e) => { if (isTextField(e.target)) setTyping(true); };
  const onFocusOut = (e) => { if (isTextField(e.target)) setTyping(false); };
  // Account mode: the server-resolved role IS coach mode.
  useEffect(() => { if (me) setIsCoach(me.role === "coach"); }, [me]);
  const scrollTop = () => { const el = typeof document !== "undefined" && (document.scrollingElement || document.documentElement); if (el) el.scrollTop = 0; };
  // push("duties") or push("match", { fixtureId }) — a bare id is normalised.
  const push = useCallback((id, payload) => { setStack((s) => [...s, typeof id === "string" ? { id, payload } : id]); scrollTop(); }, []);
  const back = useCallback(() => { setStack((s) => s.slice(0, -1)); scrollTop(); }, []);
  const goTab = (id) => { setTab(id); setStack([]); scrollTop(); };
  // Match detail is a pushed screen that re-reads its fixture from data on
  // every render, so RSVPs and plan saves show live.
  const openMatch = useCallback((f) => push("match", { fixtureId: f.id }), [push]);
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

  // A pushed match / who's-in screen whose fixture has gone (deleted from the
  // editor, or by a sync) pops itself rather than rendering nothing.
  useEffect(() => {
    const top = stack[stack.length - 1];
    if (!data || !top || (top.id !== "match" && top.id !== "whosin")) return;
    if (!(data.fixtures || []).some((f) => f.id === top.payload?.fixtureId)) back();
  }, [data, stack, back]);

  if (loading || !data) {
    return (
      <div className="fqd"><style>{CSS}</style>
        <div className="empty" style={{ paddingTop: 120 }}><div className="disp">Loading…</div></div>
      </div>
    );
  }

  // Account mode: the server-resolved role decides coach mode (parents,
  // viewers and club admins are read-only; the server blocks their writes
  // regardless). The coach PIN is a legacy-mode device.
  const account = !!me;
  // The hat being worn on this team (account mode), for the header chip.
  const currentHat = me
    ? ((me.hats || []).find((h) => h.role === me.role) || { role: me.role, playerNames: me.playerNames, staffRole: me.staffRole, admin: me.admin })
    : null;
  const hatText = me ? (me.role || !me.admin ? hatLabel(currentHat) : "Super admin") : "";
  const isAdmin = !!(me && (me.admin || me.clubAdmin));
  // Wear a hat (account mode): the choice lives in two plain cookies the server
  // validates on every request — a cookie can only narrow what the login holds.
  const wear = (slug, role) => {
    const maxAge = 60 * 60 * 24 * 180;
    document.cookie = `team_slug=${encodeURIComponent(slug)}; path=/; max-age=${maxAge}; samesite=lax`;
    document.cookie = `act_as=${encodeURIComponent(role)}; path=/; max-age=${maxAge}; samesite=lax`;
    // The legacy per-device identity must not outlive a hat change.
    document.cookie = `whoami_${slug}=; path=/; max-age=0; samesite=lax`;
    window.location.href = "/";
  };
  // Hats are strongest-first, so switching team lands straight in the best hat there.
  const strongestRoleOf = (team) => team?.hats?.[0]?.role;
  const signOutEverywhere = async () => {
    const expire = (k) => { document.cookie = `${k}=; path=/; max-age=0; samesite=lax`; };
    expire("team_slug"); expire("act_as");
    document.cookie.split(";").map((c) => c.split("=")[0].trim()).filter((k) => k.startsWith("whoami_")).forEach(expire);
    try { await fetch("/api/logout", { method: "POST" }); } catch {}
    try { await signOut({ callbackUrl: "/login" }); } catch { window.location.href = "/login"; }
  };
  // Legacy mode only: Coach mode / Leave coach mode from the Viewing-as sheet.
  // Leaving also drops the coach-only Settings screen off the stack.
  const toggleCoach = () => {
    if (isCoach) { setIsCoach(false); setStack((s) => s.filter((x) => x.id !== "settings")); setModal(null); return; }
    if (data.team.coachPin) { setModal({ type: "pin" }); return; }
    setIsCoach(true); setModal(null);
  };
  // What the header shows: a root tab (crest + team) or a pushed sub-screen (back + title).
  const top = stack.length ? stack[stack.length - 1] : null;
  const screen = top ? top.id : tab;
  const screenPayload = top ? top.payload : undefined;
  const isSub = stack.length > 0;
  // The fixture behind a pushed match / who's-in screen, read live from data.
  const screenFixture = (screen === "match" || screen === "whosin")
    ? (data.fixtures || []).find((f) => f.id === screenPayload?.fixtureId) || null
    : null;
  const roundOf = (f) => (f?.round ? `Round ${f.round}` : "");
  const subTitle = screen === "settings" ? ["Team settings", data.team.name]
    : screen === "match" ? [roundOf(screenFixture) || "Match", screenFixture ? `vs ${screenFixture.opponent} · ${fmtDate(screenFixture.dateISO)}` : ""]
    : screen === "whosin" ? ["Who's in", screenFixture ? `${roundOf(screenFixture) ? roundOf(screenFixture) + " " : ""}vs ${screenFixture.opponent} · ${fmtDate(screenFixture.dateISO)}${screenFixture.time ? " " + screenFixture.time : ""}` : ""]
    : (SUB_TITLES[screen] || [screen, ""]);
  const chipLabel = account ? hatText : (isCoach ? "Coach" : "Parent");
  // Root kicker: the shown month on Calendar, division · age group elsewhere.
  const rootKicker = tab === "calendar" ? monthYearLabel(calMonth) : `${data.team.division} · ${data.team.ageGroup}`;
  // Everything the Viewing-as sheet needs from here.
  const hatSheet = {
    isAdmin, wear, strongestRoleOf, signOut: signOutEverywhere, toggleCoach,
    openSettings: () => { setModal(null); push("settings"); },
    openSignin: () => setModal({ type: "signin" })
  };

  const exitViewAs = async () => {
    try { await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clearViewAs" }) }); } catch {}
    window.location.href = "/";
  };

  return (
    <div className="fqd" onFocus={onFocusIn} onBlur={onFocusOut}>
      <style>{CSS}</style>

      {me?.viewingAs && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 400, background: "#E07B1F", color: "#fff", fontFamily: "system-ui,sans-serif", fontWeight: 700, fontSize: 12.5, padding: "8px 12px", display: "flex", justifyContent: "center", alignItems: "center", gap: 12, boxShadow: "0 2px 10px rgba(0,0,0,.25)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Eye size={14} />Viewing as {me.viewingAs} — read only</span>
          <button onClick={exitViewAs} style={{ background: "#fff", color: "#E07B1F", border: "none", borderRadius: 999, padding: "3px 12px", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>Exit</button>
        </div>
      )}

      <header className="head">
        {isSub ? (
          <button className="backbtn" aria-label="Back" onClick={back}><ChevronLeft size={18} /></button>
        ) : (
          <img className="hcrest" src={data.team.logo || OUR_CREST} alt=""
            onError={(e) => { const el = e.currentTarget; if (el.getAttribute("src") !== OUR_CREST) el.src = OUR_CREST; else el.style.display = "none"; }} />
        )}
        <div className="hbody">
          <div className={"hname" + (isSub ? " sub" : "")}>{isSub ? subTitle[0] : data.team.name}</div>
          {!condensed && <div className="hkick">{isSub ? subTitle[1] : rootKicker}</div>}
        </div>
        <button className="hatchip" aria-label="Viewing as" onClick={() => setModal({ type: "hats" })}>{chipLabel}</button>
      </header>

      <div className="wrap">
        {data.isSample && (
          <div className="banner">
            <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>This is example data so you can see the layout. Open <b>Viewing as</b> (top right) and choose Coach mode to edit your real squad, fixtures and duties.</span>
          </div>
        )}

        {screen === "home" && <HomeTab {...{ data, stats, next, setModal, viewer, me, isCoach, openMatch, onOpen: push, onTab: goTab }} />}
        {screen === "calendar" && <CalendarTab {...{ data, isCoach, viewer, me, setModal, openMatch, month: calMonth, setMonth: setCalMonth }} />}
        {screen === "results" && <ResultsTab {...{ data, stats, isCoach, setModal, openMatch, onOpen: push }} />}
        {screen === "match" && screenFixture && <MatchScreen {...{ data, f: screenFixture, persist, patchLocal, isCoach, viewer, me, setModal, onOpen: push, showToast }} />}
        {screen === "whosin" && screenFixture && <WhosInScreen {...{ data, f: screenFixture, isCoach, viewer, me, setModal, patchLocal }} />}
        {screen === "squad" && <SquadTab {...{ data, stats, isCoach, setModal, persist }} />}
        {screen === "ask" && <AskTab {...{ data, viewer, isCoach, account }} />}
        {screen === "duties" && <DutiesTab {...{ data, isCoach, pname, setModal }} />}
        {screen === "stats" && <StatsTab {...{ data, stats, pname }} />}
        {screen === "settings" && <SettingsTab {...{ data, isCoach, persist, patchLocal, setIsCoach, setModal, account }} />}
      </div>

      <nav className={"nav" + (typing ? " hide" : "")} aria-label="Main">
        {[["home", Home, "Home"], ["calendar", Calendar, "Calendar"], ["results", Trophy, "Results"],
        ["squad", Users, "Squad"], ["ask", Sparkles, "Ask"]].map(([id, Ic, lbl]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => goTab(id)}>
            <Ic size={18} /><span>{lbl}</span>
          </button>
        ))}
      </nav>

      {toast && <div className="toast" role="status" onClick={() => setToast(null)}>{toast}</div>}

      {modal && modal.type === "plan" ? (
        <MatchDayPlanner
          data={data}
          fixture={(data.fixtures || []).find((x) => x.id === modal.payload?.id) || modal.payload}
          isCoach={isCoach}
          onSavePlan={savePlan}
          close={() => setModal(null)}
        />
      ) : modal ? (
        <Modal {...{ modal, setModal, data, persist, patchLocal, isCoach, setIsCoach, viewer, setViewer, me, hatSheet, showToast, openMatch }} />
      ) : null}
    </div>
  );
}

/* ---------------- HOME (S2, Direction C) ---------------- */
// "Sam Smith" -> "Sam S." (row names, birthdays); firstName() lives above with the app helpers.
const shortName = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : (parts[0] || "");
};
const monthLong = (d) => d.toLocaleDateString("en-AU", { month: "long" });
// "June 2026" for the Calendar header kicker and grid head (month index within SEASON).
const monthYearLabel = (month) => `${monthLong(new Date(SEASON, month, 1))} ${SEASON}`;
// "SAT 13 JUNE" (uppercased by CSS) for the match-up centre.
const matchDate = (iso) => { if (!iso) return "Date TBC"; const d = new Date(iso + "T00:00:00"); return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${monthLong(d)}`; };
// "Thu, 18 June" for birthday rows.
const bdayDate = (iso) => { const d = new Date(iso + "T00:00:00"); return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${monthLong(d)}`; };
const weekdayLong = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-AU", { weekday: "long" }) : "";
// MiniRoos ages (U6–U9) get the "no ladders" footnote.
const isMiniRoos = (team) => /^U[6-9]$/i.test(String(team?.ageGroup || "").trim());
// In / out / no reply over the players active on that date.
const replyCounts = (players, av, iso) => players.filter(p => activeOn(p, iso)).reduce((c, p) => {
  const st = av?.[p.id]?.status; if (st === "in") c.in++; else if (st === "out") c.out++; else c.nr++; return c;
}, { in: 0, out: 0, nr: 0 });

// The one narrow RSVP write the Home reply sheet uses: optimistic patch of the
// fixture's availability (patchLocal — never the whole document), the same
// /api/rsvp body the Who's in screen sends, reverted with a toast when the route refuses.
async function sendGameReply({ fixture, playerId, status, reason, by, first, patchLocal, showToast }) {
  const prev = fixture.availability || {};
  const nextAv = { ...prev };
  const cleanReason = status === "out" ? (reason || "Away") : undefined;
  if (status == null) delete nextAv[playerId];
  else nextAv[playerId] = { status, ...(cleanReason ? { reason: cleanReason } : {}), by, at: Date.now() };
  const setAv = (av) => patchLocal(d => ({ ...d, fixtures: (d.fixtures || []).map(x => x.id === fixture.id ? { ...x, availability: av } : x) }));
  setAv(nextAv);
  const day = weekdayLong(fixture.dateISO) || "the game";
  showToast(status === "in" ? `${first}'s in for ${day}` : status === "out" ? `${first}'s out for ${day}` : `${first}'s reply cleared`);
  try {
    const res = await fetch("/api/rsvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "game", id: fixture.id, playerId, status, reason: cleanReason })
    });
    if (!res.ok) throw new Error("rsvp " + res.status);
  } catch (e) {
    console.error("Could not save availability:", e);
    setAv(prev);
    showToast(`Couldn't save ${first}'s reply — try again.`);
  }
}

// Whose replies this viewer owns: the account's children (account mode) or
// the per-device identity (legacy). Coaches reply for anyone from Who's in.
const ownPlayers = (data, { isCoach, me, viewer }) => {
  const ids = isCoach ? [] : me ? (me.role === "parent" ? (me.playerIds || []) : []) : (viewer?.kind === "parent" && viewer.pid ? [viewer.pid] : []);
  return ids.map(id => data.players.find(p => p.id === id)).filter(Boolean);
};

// Status pill(s) for a game/training row: the parent's own children's replies,
// or the team-wide tally for coaches and viewers (D5: training replies live at
// session.availability[occurrence][playerId], the same shape as a fixture's).
const pillsFor = (data, own, av, iso) => {
  if (own.length === 0) { const c = replyCounts(data.players, av, iso); return [{ cls: "nr", label: `${c.in} in · ${c.nr} to reply` }]; }
  return own.map(p => {
    const st = av?.[p.id]?.status, first = firstName(p.name);
    return st === "in" ? { cls: "in", label: `${first}'s in` } : st === "out" ? { cls: "out", label: `${first}'s out` }
      : { cls: "nr", label: own.length > 1 ? `${first}: no reply` : "No reply" };
  });
};

// One event row, shared by Home's Next 7 days, the Calendar list card and the
// day sheet: 34px day column (DOW + Anton number), 32px icon square by kind,
// title + meta, the reply pill(s), chevron. `it` is a monthItems/upcomingItems
// entry; `onOpen` is the tap handler or null for a static row. `noDay` drops the
// day column (the day sheet's title already names the day).
function EventRow({ data, it, isCoach, own, onOpen, noDay = false }) {
  const d = new Date(it.dateISO + "T00:00:00");
  const isGame = it.kind === "game", isBday = it.kind === "birthday", isEvent = it.kind === "event";
  const kind = isGame ? "game" : isBday ? "birthday" : isEvent ? "event" : "training";
  const Ic = isGame ? Trophy : isBday ? Cake : isEvent ? Star : ClipboardList;
  const cancelled = isGame && it.ref.status === "cancelled";
  const place = isGame ? it.ref.venue : isBday ? "" : it.ref.location;
  const age = isBday && it.ref.dob && parseInt(it.ref.dob.slice(0, 4), 10) > 1990 ? d.getFullYear() - parseInt(it.ref.dob.slice(0, 4), 10) : null;
  const title = isBday ? (age ? `${shortName(it.ref.name)} turns ${age}` : `${shortName(it.ref.name)}'s birthday`) : it.title;
  const meta = isBday ? "Birthday" : `${it.time || "Time TBC"}${place ? " · " + place : ""}`;
  const av = isGame ? it.ref.availability : it.ref.availability?.[it.occ];
  const pills = isBday ? [] : cancelled ? [{ cls: "out", label: "Cancelled" }] : pillsFor(data, own, av, it.dateISO);
  const open = onOpen || null;
  return (
    <div className={"wk-row" + (open ? "" : " static")} role={open ? "button" : undefined} tabIndex={open ? 0 : undefined}
      onClick={open || undefined} onKeyDown={open ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } } : undefined}>
      {!noDay && <div className="wk-day"><div className="wk-dow">{WEEKDAYS[d.getDay()]}</div><div className="wk-num">{d.getDate()}</div></div>}
      <span className={"wk-ic " + kind}><Ic size={noDay ? 16 : 15} /></span>
      <div className="wk-body">
        <div className={"wk-title" + (cancelled ? " off" : "")}>{title}</div>
        <div className="wk-meta">{meta}</div>
      </div>
      {pills.map((pl, i) => <span key={i} className={"wk-pill " + pl.cls}>{pl.label}</span>)}
      <ChevronRight size={15} color="#9AA3A6" style={{ flexShrink: 0, visibility: open ? "visible" : "hidden" }} />
    </div>
  );
}

// One own-child reply row (S2): initials, short name, hint, Reply / In / Out pill.
function ReplyRow({ p, status, onTap }) {
  return (
    <div className="replyrow">
      <span className="avatar">{initials(p.name)}</span>
      <div className="rr-body">
        <div className="rr-name">{shortName(p.name)}</div>
        <div className="rr-hint">{status ? "Tap to change" : `Reply for ${firstName(p.name)}`}</div>
      </div>
      <button className={"rr-btn" + (status ? " " + status : "")} onClick={onTap}>
        {status === "in" ? "In" : status === "out" ? "Out" : "Reply"}
      </button>
    </div>
  );
}

// Duties card (S2): one slot per duty feature that's on, the assigned player
// or "Not assigned yet"; tap → Duties. Shared by Home and Match detail.
function DutyCard({ data, f, onOpen }) {
  const feats = teamFeatures(data.team);
  const playerName = (id) => data.players.find(p => p.id === id)?.name || null;
  const duties = f ? [
    feats.fruitDuty && { cls: "fruit", Icon: Apple, label: "Fruit duty", who: playerName(f.fruit) },
    feats.gkDuty && { cls: "gk", Icon: ShieldCheck, label: "In goal", who: playerName(f.gk) },
    feats.jerseyDuty && { cls: "jersey", Icon: Shirt, label: "Jerseys", who: playerName(f.jersey) }
  ].filter(Boolean) : [];
  if (!duties.length) return null;
  return (
    <div className="card dutycard" role="button" tabIndex={0} aria-label="Duties"
      onClick={() => onOpen("duties")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen("duties"); } }}>
      {duties.map(({ cls, Icon, label, who }, i) => (
        <React.Fragment key={label}>
          {i > 0 && <div className="dc-div" />}
          <div className="dc-slot">
            <span className={"dc-ic " + cls}><Icon size={16} /></span>
            <div className="dc-txt">
              <div className="dc-label">{label}</div>
              <div className={"dc-val" + (who ? "" : " none")}>{who || "Not assigned yet"}</div>
            </div>
          </div>
        </React.Fragment>
      ))}
      <ChevronRight size={15} color="#9AA3A6" style={{ flexShrink: 0 }} />
    </div>
  );
}

function HomeTab({ data, stats, next, setModal, onOpen, onTab, viewer, me, isCoach, openMatch }) {
  const todayISO = isoLocal(new Date());
  const own = ownPlayers(data, { isCoach, me, viewer });
  const week = upcomingItems(data, todayISO, 7);
  const bdays = nextBirthdays(data, todayISO, 2);
  const oppCrest = next ? crestFor(next.opponent) : null;
  const nextCounts = next ? replyCounts(data.players, next.availability, next.dateISO) : null;
  const openReply = (p) => setModal({ type: "reply", payload: { fixture: next, playerId: p.id } });
  // Row tap: game → Match detail, training/activity → session sheet, birthday → static here.
  const openFor = (it) => it.kind === "birthday" ? null : it.kind === "game" ? () => openMatch(it.ref) : () => setModal({ type: "session", payload: it.ref, occ: it.occ });
  const miniRoos = isMiniRoos(data.team);

  return (
    <>
      {next ? (
        <div className="card nextgame">
          <div className="ng-head">
            <span className="ng-label">Next game{next.round ? ` · Round ${next.round}` : ""} · {next.homeAway === "H" ? "Home" : "Away"}</span>
            {next.dateISO && <span className="ng-cd"><Clock size={12} />{countdown(next.dateISO, next.time)}</span>}
          </div>
          <div className="matchup">
            <div className="mu-side">
              <img className="mu-crest ours" src={data.team.logo || OUR_CREST} alt=""
                onError={(e) => { const el = e.currentTarget; if (el.getAttribute("src") !== OUR_CREST) el.src = OUR_CREST; else el.style.visibility = "hidden"; }} />
              <span className="mu-name ours">{data.team.name}</span>
            </div>
            <div className="mu-centre">
              <div className="mu-time">{next.time || "TBC"}</div>
              <div className="mu-date">{matchDate(next.dateISO)}</div>
            </div>
            <div className="mu-side">
              {oppCrest
                ? <img className="mu-crest" src={oppCrest} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                : <span className="mu-disc">{initials(next.opponent)}</span>}
              <span className="mu-name">{next.opponent}</span>
            </div>
          </div>
          <div className="ng-venue">
            <span className="ng-place"><MapPin size={12} /><span>{next.venue || "Venue to be confirmed"}</span></span>
            <button className="softpill" onClick={() => openMatch(next)}>Details</button>
          </div>
          {own.length > 0 ? (
            <div className="replyrows">
              {own.map(p => <ReplyRow key={p.id} p={p} status={next.availability?.[p.id]?.status || null} onTap={() => openReply(p)} />)}
            </div>
          ) : (
            <div className="ng-counts">
              <div className="cpills">
                <span className="cpill in">{nextCounts.in} in</span>
                <span className="cpill out">{nextCounts.out} out</span>
                <span className="cpill">{nextCounts.nr} no reply</span>
              </div>
              {isCoach && <button className="ghostlink" onClick={() => openMatch(next)}>Who's in ›</button>}
            </div>
          )}
        </div>
      ) : (
        <div className="card"><div className="empty"><div className="disp">No upcoming match</div><div className="note">Add fixtures under Results.</div><button className="ghostlink" style={{ marginTop: 10 }} onClick={() => onOpen("duties")}>Duties ›</button></div></div>
      )}

      {next && <DutyCard data={data} f={next} onOpen={onOpen} />}

      {data.team.whatsapp && (
        <a className="wabtn" href={data.team.whatsapp} target="_blank" rel="noopener noreferrer">
          <MessageSquare size={16} />Team WhatsApp group
        </a>
      )}

      <div className="card week">
        <div className="wk-head">
          <span className="label">Next 7 days</span>
          <button className="ghostlink" onClick={() => onTab("calendar")}>Calendar ›</button>
        </div>
        {week.length === 0 && <div className="note wk-empty">Nothing in the next 7 days. Enjoy the rest.</div>}
        {week.map(it => <EventRow key={it.key} data={data} it={it} isCoach={isCoach} own={own} onOpen={openFor(it)} />)}
      </div>

      <div className="card season">
        <div className="wk-head" style={{ marginBottom: 10 }}>
          <span className="label">Season so far</span>
          <button className="ghostlink" onClick={() => onOpen("stats")}>All stats ›</button>
        </div>
        <div className="tiles">
          {[[stats.played, "Played"], [stats.w, "Won"], [stats.dr, "Drawn"], [stats.pts, "Pts"]].map(([v, k]) => (
            <div className={"tile" + (k === "Pts" ? " pts" : "")} key={k}><div className="v">{v}</div><div className="k">{k}</div></div>
          ))}
        </div>
        <div className="formrow">
          {stats.form.length > 0 && <span className="label">Form</span>}
          {stats.form.map((r, i) => <span key={i} className={"pip " + r}>{r}</span>)}
          <span className="fa">{stats.gf} for · {stats.ga} against</span>
        </div>
        {miniRoos && <div className="footnote">MiniRoos doesn't publish ladders at {String(data.team.ageGroup).toUpperCase()} — these are just our own numbers.</div>}
      </div>

      {bdays.length > 0 && (
        <div className="card bdays">
          <div className="label">Birthdays coming up</div>
          {bdays.map(({ p, iso, age }) => (
            <div className="bd-row" key={p.id}>
              <span className="wk-ic birthday"><Cake size={16} /></span>
              <div className="wk-body">
                <div className="wk-title">{age != null ? `${shortName(p.name)} turns ${age}` : `${shortName(p.name)}'s birthday`}</div>
                <div className="wk-meta">{bdayDate(iso)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// Reply sheet (D1: 1a sheets for parents). Big In / Out, an optional note
// (sent as the Out reason), closes once the reply is sent. Tapping the value
// already chosen clears it.
function ReplySheet({ data, payload, isCoach, viewer, me, patchLocal, showToast, close }) {
  const fixture = (data.fixtures || []).find(x => x.id === payload.fixture?.id) || payload.fixture;
  const player = data.players.find(p => p.id === payload.playerId);
  const first = firstName(player?.name) || "your player";
  const cur = fixture?.availability?.[payload.playerId]?.status || null;
  const [note, setNote] = useState("");
  const staff = getStaff(data.team);
  const head = staff.find(s => /head coach/i.test(s.role || "")) || staff[0];
  const coachFirst = head?.name ? firstName(head.name) : null;
  const by = isCoach ? "Coach" : me ? (player?.name || "Parent") : (viewer?.label || "you");
  const choose = (val) => {
    const status = cur === val ? null : val;
    sendGameReply({ fixture, playerId: payload.playerId, status, reason: note.trim(), by, first, patchLocal, showToast });
    close();
  };
  return (
    <>
      <div className="rs-title">Reply for {first}</div>
      <div className="rs-sub">vs {fixture.opponent} · {fmtDate(fixture.dateISO)}{fixture.time ? ` · ${fixture.time}` : ""}</div>
      <div className="rs-grid">
        <button className={"rs-btn in" + (cur === "in" ? " sel" : "")} onClick={() => choose("in")}><Check size={18} />In</button>
        <button className={"rs-btn out" + (cur === "out" ? " sel" : "")} onClick={() => choose("out")}><X size={18} />Out</button>
      </div>
      <input className="rs-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for coach (optional)" aria-label="Note for coach" />
      <div className="rs-foot">{coachFirst ? `Coach ${coachFirst} sees` : "The coach sees"} replies straight away. You can change it any time before kick-off.</div>
    </>
  );
}

/* ---------------- CALENDAR (S4, Direction C) ---------------- */
// Add to your calendar: one-tap subscription to the website's feed (Google /
// Apple / Outlook soft buttons, copy link) plus the one-off .ics download. The
// feed URL comes from /api/feedinfo; without it (e.g. the chat artifact) the
// card keeps only the one-off download.
function AddToCalendarCard({ data }) {
  const [feed, setFeed] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetch("/api/feedinfo", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.feedUrl) setFeed(j.feedUrl); })
      .catch(() => {});
  }, []);
  const webcal = feed ? feed.replace(/^https?:/, "webcal:") : null;
  const copy = () => { navigator.clipboard?.writeText(feed); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const download = () => downloadICS(`${data.team.name}-${SEASON}-season.ics`, seasonICS(data));
  return (
    <div className="card subcard">
      <div className="label">Add to your calendar</div>
      {feed ? (
        <>
          <div className="sub-text">Subscribe once and it stays in sync when a game moves — better than importing.</div>
          <div className="sub-btns">
            <a className="softbtn" target="_blank" rel="noopener noreferrer" href={"https://calendar.google.com/calendar/render?cid=" + encodeURIComponent(webcal)}>Google</a>
            <a className="softbtn" href={webcal}>Apple</a>
            <a className="softbtn" target="_blank" rel="noopener noreferrer"
              href={"https://outlook.office.com/calendar/0/addfromweb?url=" + encodeURIComponent(feed) + "&name=" + encodeURIComponent("Team Calendar")}>Outlook</a>
          </div>
          <div className="sub-fine">Calendars refresh on their own schedule. Treat the link as team-private.</div>
          <div className="sub-links">
            <button className="ghostlink" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
            <button className="ghostlink" onClick={download}>Download a one-off .ics instead</button>
          </div>
        </>
      ) : (
        <div className="sub-links">
          <button className="ghostlink" onClick={download}><Download size={13} />Download a one-off .ics instead</button>
        </div>
      )}
    </div>
  );
}

// What a day shows in the grid: the opponent's crest on a game day, else one
// dot (birthday beats event beats training).
const dayMarker = (evs) => {
  const game = evs.find(e => e.kind === "game");
  if (game) return { game };
  const dot = evs.some(e => e.kind === "birthday") ? "birthday" : evs.some(e => e.kind === "event") ? "event" : evs.length ? "training" : null;
  return { dot };
};
// Row tap on the Calendar tab and in the day sheet.
const calOpenFor = (it, { openMatch, setModal }) => it.kind === "game"
  ? () => openMatch(it.ref)
  : it.kind === "birthday"
    ? () => setModal({ type: "playerView", payload: it.ref })
    : () => setModal({ type: "session", payload: it.ref, occ: it.occ });
const monthISO = (month, d) => `${SEASON}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function CalendarTab({ data, isCoach, viewer, me, setModal, openMatch, month, setMonth }) {
  const today = new Date();
  const todayISO = isoLocal(today);
  const inSeason = today.getFullYear() === SEASON;
  const [selISO, setSelISO] = useState(inSeason ? todayISO : `${SEASON}-01-01`);
  const own = ownPlayers(data, { isCoach, me, viewer });

  const items = useMemo(() => monthItems(data, SEASON, month), [data, month]);
  const byDay = useMemo(() => {
    const m = {}; items.forEach(it => { (m[it.dateISO] = m[it.dateISO] || []).push(it); }); return m;
  }, [items]);

  // Month grid, Monday-first: leading blanks, then one button per day.
  const first = new Date(SEASON, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(SEASON, month + 1, 0).getDate();
  const monthName = monthLong(first);
  const isThisMonth = inSeason && today.getMonth() === month;
  const listItems = isThisMonth ? items.filter(it => it.dateISO >= todayISO) : items;
  const hasEvent = items.some(it => it.kind === "event");

  const tapDay = (iso) => {
    setSelISO(iso);
    if ((byDay[iso] || []).length) setModal({ type: "day", payload: { iso } });
  };

  return (
    <>
      <div className="card calgrid">
        <div className="cg-head">
          <button className="cg-nav" aria-label="Previous month" disabled={month === 0} onClick={() => setMonth(Math.max(0, month - 1))}><ChevronLeft size={16} strokeWidth={2.2} /></button>
          <span className="cg-month">{monthYearLabel(month)}</span>
          <button className="cg-nav" aria-label="Next month" disabled={month === 11} onClick={() => setMonth(Math.min(11, month + 1))}><ChevronRight size={16} strokeWidth={2.2} /></button>
        </div>
        <div className="cg-dow">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
        <div className="cg-cells">
          {Array.from({ length: lead }, (_, i) => <span className="cal-blank" key={"b" + i} />)}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const d = i + 1, iso = monthISO(month, d), evs = byDay[iso] || [];
            const { game, dot } = dayMarker(evs);
            const cls = "cal-cell" + (iso === selISO ? " sel" : iso === todayISO ? " today" : "");
            return (
              <button key={iso} className={cls} onClick={() => tapDay(iso)} aria-label={`${d} ${monthName}`}>
                <span className="n">{d}</span>
                {game && <Crest src={crestFor(game.ref.opponent)} name={game.ref.opponent} className="cal-crest" discClass="cal-crest ph" />}
                {!game && dot && <span className={"cal-dot " + dot} />}
              </button>
            );
          })}
        </div>
        <div className="cg-legend">
          <span><img src={OUR_CREST} alt="" />Game</span>
          <span><span className="cal-dot training" />Training</span>
          <span><span className="cal-dot birthday" />Birthday</span>
          {hasEvent && <span><span className="cal-dot event" />Event</span>}
        </div>
      </div>

      <div className="card week callist">
        <div className="wk-head">
          <span className="label">{isThisMonth ? `Coming up in ${monthName}` : monthName}</span>
          {isCoach && <button className="ghostlink" onClick={() => setModal({ type: "sessionEdit", payload: null })}>Add training / activity</button>}
        </div>
        {listItems.length === 0 && <div className="wk-empty">Nothing scheduled in {monthName}.</div>}
        {listItems.map(it => <EventRow key={it.key} data={data} it={it} isCoach={isCoach} own={own} onOpen={calOpenFor(it, { openMatch, setModal })} />)}
      </div>

      <AddToCalendarCard data={data} />
    </>
  );
}

// Day sheet (modal type "day"): "Thursday 18 June", then that day's rows.
// Tapping a row closes the sheet and opens the item as the list card does.
function DaySheet({ data, iso, isCoach, viewer, me, setModal, openMatch, close }) {
  const d = new Date(iso + "T00:00:00");
  const own = ownPlayers(data, { isCoach, me, viewer });
  const items = monthItems(data, d.getFullYear(), d.getMonth()).filter(it => it.dateISO === iso);
  const openThen = (it) => { const fn = calOpenFor(it, { openMatch, setModal }); return () => { close(); fn(); }; };
  return (
    <>
      <div className="day-title">{FULLDAYS[d.getDay()]} {d.getDate()} {monthLong(d)}</div>
      <div className="day-rows">
        {items.length === 0 && <div className="wk-empty">Nothing on this day. Enjoy the rest.</div>}
        {items.map(it => <EventRow key={it.key} data={data} it={it} isCoach={isCoach} own={own} onOpen={openThen(it)} noDay />)}
      </div>
    </>
  );
}

/* ---------------- RESULTS (S3, Direction C) ---------------- */
// A club crest at row size: the registry image (never a Squadi hotlink) or an
// initials disc when we have no artwork. Our own crest falls back to the
// bundled file if the team's uploaded logo fails to load.
function Crest({ src, name, ours, className = "mcrest", discClass = "mcrest ph" }) {
  if (!src) return <span className={discClass}>{initials(name)}</span>;
  const onError = ours
    ? (e) => { const el = e.currentTarget; if (el.getAttribute("src") !== OUR_CREST) el.src = OUR_CREST; else el.style.visibility = "hidden"; }
    : (e) => { e.currentTarget.style.visibility = "hidden"; };
  return <img className={className + (ours ? " ours" : "")} src={src} alt="" onError={onError} />;
}

// Played / cancelled / upcoming, from the fixture alone.
const fixtureState = (f) => {
  const cancelled = f.status === "cancelled";
  const scored = f.us != null && f.them != null;
  const past = scored || f.status === "played" || isPastGame(f);
  const result = scored ? (f.us > f.them ? "win" : f.us < f.them ? "loss" : "draw") : null;
  return { cancelled, scored, past, upcoming: !cancelled && !past, result };
};
// "13 Jun" for the round column.
const shortDate = (iso) => { if (!iso) return "TBC"; const d = new Date(iso + "T00:00:00"); return `${d.getDate()} ${d.toLocaleDateString("en-AU", { month: "short" })}`; };

// MatchRow: round + date · home crest + name · score / kick-off · away crest + name.
// The home team is always on the left, so an away game flips us to the right;
// our side gets the crest ring and 800-weight ink text.
function MatchRow({ data, f, onTap }) {
  const home = f.homeAway === "H";
  const us = data.team.name, usLogo = data.team.logo || OUR_CREST, oppLogo = crestFor(f.opponent);
  const { cancelled, scored, result } = fixtureState(f);
  const hs = home ? f.us : f.them, as = home ? f.them : f.us;
  const side = (ours, away) => (
    <div className={"mr-side" + (ours ? " ours" : "") + (away ? " away" : "")}>
      <Crest src={ours ? usLogo : oppLogo} name={ours ? us : f.opponent} ours={ours} />
      <span className="mr-name">{ours ? us : f.opponent}</span>
    </div>
  );
  const centre = cancelled ? <span className="mstate">Canc</span>
    : scored ? <span className={"mscore " + result}>{hs}–{as}</span>
    : isPastGame(f) ? <span className="mstate none">No score</span>
    : <span className="mtime">{f.time || "TBC"}</span>;
  return (
    <div className={"mrow" + (cancelled ? " canc" : "")} role="button" tabIndex={0}
      onClick={onTap} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } }}>
      <div className="mr-round"><div className="r">{f.round ?? "–"}</div><div className="d">{shortDate(f.dateISO)}</div></div>
      {side(home, false)}
      <div className="mr-centre">{centre}</div>
      {side(!home, true)}
    </div>
  );
}

function ResultsTab({ data, stats, isCoach, setModal, openMatch, onOpen }) {
  const byRound = (a, b) => (a.round || 0) - (b.round || 0) || String(a.dateISO || "").localeCompare(String(b.dateISO || ""));
  const sorted = [...data.fixtures].sort(byRound);
  const results = sorted.filter(f => fixtureState(f).past);
  const upcoming = sorted.filter(f => !fixtureState(f).past);
  return (
    <>
      <div className="card season-mini">
        <div className="sm-head">
          <span className="label">Season so far</span>
          <button className="ghostlink" onClick={() => onOpen("stats")}>All stats ›</button>
        </div>
        <div className="sm-body">
          <div className="sm-pips">{stats.form.map((r, i) => <span key={i} className={"pip lg " + r}>{r}</span>)}</div>
          <div className="wdl"><div className="v">{stats.w}–{stats.dr}–{stats.l}</div><div className="k">W · D · L</div></div>
        </div>
      </div>

      <div className="card reslist">
        <div className="rl-head"><span className="label">Results</span></div>
        {results.length === 0 && <div className="rl-empty">No results yet.</div>}
        {results.map(f => <MatchRow key={f.id} data={data} f={f} onTap={() => openMatch(f)} />)}
      </div>

      <div className="card reslist">
        <div className="rl-head">
          <span className="label">Fixtures</span>
          {isCoach && <button className="ghostlink" onClick={() => setModal({ type: "fixture", payload: null })}>Add fixture</button>}
        </div>
        {upcoming.length === 0 && <div className="rl-empty">No fixtures yet.</div>}
        {upcoming.map(f => <MatchRow key={f.id} data={data} f={f} onTap={() => openMatch(f)} />)}
      </div>

      {isMiniRoos(data.team) && (
        <div className="footnote res-foot">MiniRoos doesn't publish ladders at {String(data.team.ageGroup).toUpperCase()} — results only help grade the leagues. These are just our own numbers.</div>
      )}
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
      {!isCoach && <div className="banner"><Lock size={15} /><span>Switch to coach mode from the Viewing as chip to edit team details and manage data.</span></div>}
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
function Modal({ modal, setModal, data, persist, patchLocal, isCoach, setIsCoach, viewer, setViewer, me, hatSheet, showToast, openMatch }) {
  const close = () => setModal(null);
  return (
    <div className="ov" onClick={(e) => { if (e.target.classList.contains("ov")) close(); }}>
      <div className="sheet">
        <div className="grab" />
        {modal.type === "hats" && <HatsSheet {...hatSheet} {...{ data, me, isCoach, viewer, close }} />}
        {modal.type === "pin" && <PinSheet {...{ data, setIsCoach, close }} />}
        {modal.type === "signin" && !me && <SignInSheet {...{ data, viewer, setViewer, close }} />}
        {modal.type === "fixture" && <FixtureSheet {...{ data, persist, payload: modal.payload, close }} />}
        {modal.type === "reply" && <ReplySheet {...{ data, payload: modal.payload, isCoach, viewer, me, patchLocal, showToast, close }} />}
        {modal.type === "day" && <DaySheet {...{ data, iso: modal.payload?.iso, isCoach, viewer, me, setModal, openMatch, close }} />}
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

// Viewing-as sheet (header hat chip). Account mode: this team's hats, other
// teams, Create a team (admins), Team settings (coach), Club admin, Sign out.
// Legacy team-code mode: Coach mode / Leave coach mode and the per-device
// "who's responding" identity instead of hats.
function HatsSheet({ data, me, isCoach, viewer, isAdmin, wear, strongestRoleOf, signOut, openSettings, toggleCoach, openSignin }) {
  const hats = me ? (me.hats || []) : [];
  const others = me ? (me.teams || []).filter((t) => t.teamSlug !== me.teamSlug) : [];
  const hatInitials = (h) => {
    if (h.role === "coach") return "C";
    if (h.role !== "parent") return "V";
    const names = h.playerNames || [];
    return names.length === 1 ? initials(names[0]) : (names.map((n) => (firstName(n)[0] || "")).join("").slice(0, 3).toUpperCase() || "P");
  };
  const hatSub = (h) => h.role === "coach" ? "Edit fixtures, scores and duties"
    : h.role === "parent" ? `Reply for ${joinKidNames(h.playerNames)} and see the team`
    : "Read everything, change nothing";
  const Row = ({ href, onClick, lead, title, sub, right }) => {
    const inner = <>{lead}<span className="txt"><b>{title}</b>{sub && <span>{sub}</span>}</span>{right}</>;
    return href ? <a className="hs-row" href={href}>{inner}</a> : <button className="hs-row" onClick={onClick}>{inner}</button>;
  };
  return (<>
    <div className="hs-title">Viewing as</div>
    <div className="hs-sub">{hats.length > 1 ? "You're both a coach and a parent here. Pick a hat." : "Switch team, open settings or sign out."}</div>
    <div className="hs-list">
      {hats.map((h) => {
        const worn = h.role === me.role;
        return <Row key={h.role} onClick={() => wear(me.teamSlug, h.role)}
          lead={<span className={"disc" + (worn ? " on" : "")}>{hatInitials(h)}</span>}
          title={hatLabel(h)} sub={hatSub(h)}
          right={worn ? <Check size={18} color="var(--pitch)" strokeWidth={2.5} aria-label="Current hat" /> : null} />;
      })}
      {me === null && (<>
        <Row onClick={toggleCoach} lead={<span className="ico">{isCoach ? <Unlock size={16} /> : <Lock size={16} />}</span>}
          title={isCoach ? "Leave coach mode" : "Coach mode"}
          sub={isCoach ? "Back to the parent view" : (data.team.coachPin ? "Needs the coach PIN" : "Edit fixtures, scores and duties")} />
        {!isCoach && <Row onClick={openSignin} lead={<span className="ico"><User size={16} /></span>}
          title={viewer.kind === "parent" ? `Responding as ${viewer.label}` : "Sign in to respond"}
          sub={viewer.kind === "parent" ? "Tap to change who replies from this device" : "Pick your child so replies are recorded as you"} />}
      </>)}
      {others.length > 0 && (<>
        <div className="label hs-label">Other teams</div>
        {others.map((t) => <Row key={t.teamSlug} onClick={() => wear(t.teamSlug, strongestRoleOf(t) || me.role)}
          lead={<span className="disc">{initials(t.teamName)}</span>} title={t.teamName} sub={hatLabel(t.hats?.[0])} />)}
      </>)}
      {isAdmin && <Row href="/admin" lead={<span className="ico"><Plus size={16} /></span>} title="Create a team" />}
      {isCoach && <Row onClick={openSettings} lead={<span className="ico"><SettingsIcon size={16} /></span>} title="Team settings" sub="Details, match format, duties and what parents can see" />}
      {isAdmin && <Row href="/admin" lead={<span className="ico"><SettingsIcon size={16} /></span>} title="Club admin" />}
    </div>
    <button className="hs-out" onClick={signOut}><LogOut size={15} />Sign out</button>
  </>);
}

function SheetHead({ title, close }) {
  return <div className="sh-head"><h2>{title}</h2><button className="xbtn" onClick={close}><X size={18} /></button></div>;
}

// Weekly focus card (S3): label, the focus title, the coach's question and
// points when set, and who it's from. `coach` is the head coach's first name.
function FocusCard({ f, label = "This week's focus", coach }) {
  if (!f?.focusTitle) return null;
  const points = (f.focusPoints || "").split("\n").map(s => s.trim()).filter(Boolean);
  const day = weekdayLong(f.dateISO) || "Saturday";
  return (
    <div className="card focuscard">
      <div className="label">{label}</div>
      <div className="fc-title">{f.focusTitle}</div>
      {f.focusQuestion && <div className="fc-q">{f.focusQuestion}</div>}
      {points.length > 0 && <div className="fc-pts">{points.map((p, i) => <div className="fc-pt" key={i}>{p}</div>)}</div>}
      <div className="fc-foot">One thing for the kids to think about on {day}{coach ? ` — Coach ${coach}` : ""}</div>
    </div>
  );
}

// Add-to-calendar chips. `icsText` overrides the .ics payload (e.g. a recurring series).
function CalAdd({ ev, icsText, label = "Add to your calendar", style = { marginTop: 14 } }) {
  if (!ev || !ev.dateISO) return null;
  return (
    <div style={style}>
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
    {payload && data.fixtures.some(x => x.id === payload.id) && (
      <button className="btn danger" style={{ marginTop: 8 }}
        onClick={() => { persist({ ...data, fixtures: data.fixtures.filter(x => x.id !== payload.id), isSample: false }); close(); }}>
        Delete fixture
      </button>
    )}
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
  if (me.role === "coach") return "Switch to coach mode from the Viewing as chip to mark anyone.";
  return "Club admins can see replies but can't respond.";
}

/* ---------------- MATCH DETAIL (S3, Direction C) ---------------- */
// A pushed screen. `f` is the fixture read live from data by App, so RSVPs
// and plan saves show without reopening.
function MatchScreen({ data, f, persist, patchLocal, isCoach, viewer, me, setModal, onOpen, showToast }) {
  const [seek, setSeek] = useState(null);
  const kind = videoKind(f.video);
  const ytid = ytId(f.video);
  const chapters = [...(f.chapters || [])].sort((a, b) => (a.t || 0) - (b.t || 0));
  const src = ytid
    ? `https://www.youtube.com/embed/${ytid}?rel=0&modestbranding=1${seek != null ? `&start=${seek}&autoplay=1` : ""}`
    : null;
  const todayISO = isoLocal(new Date());
  const home = f.homeAway === "H";
  const us = data.team.name, usLogo = data.team.logo || OUR_CREST, oppLogo = crestFor(f.opponent);
  const { cancelled, scored, past, upcoming, result } = fixtureState(f);
  const hs = home ? f.us : f.them, as = home ? f.them : f.us;
  // Hero centre: score + Win/Loss/Draw, kick-off + date, Cancelled, or no score.
  const centre = cancelled ? { big: "Cancelled", cls: "loss", sub: "Called off" }
    : scored ? { big: `${hs}–${as}`, cls: result, sub: result === "win" ? "Win" : result === "loss" ? "Loss" : "Draw" }
    : past ? { big: "–", cls: "none", sub: "No score" }
    : { big: f.time || "TBC", cls: "", sub: matchDate(f.dateISO), up: true };
  const pname = (pid) => data.players.find(p => p.id === pid)?.name || "—";
  const players = data.players.filter(p => activeOn(p, f.dateISO)).sort((a, b) => a.number - b.number);
  const counts = replyCounts(data.players, f.availability, f.dateISO);
  const own = ownPlayers(data, { isCoach, me, viewer });
  const guest = !me && !isCoach && viewer?.kind !== "parent";
  const scorers = (f.goals || []).map(g => ({ p: data.players.find(x => x.id === g.pid), name: pname(g.pid), n: g.n }));
  const staff = getStaff(data.team);
  const headCoach = staff.find(s => /head coach/i.test(s.role || "")) || staff[0];
  const coachFirst = headCoach?.name ? firstName(headCoach.name) : null;
  const planExists = !!(f.plan && (f.plan.assignments || []).some((s) => Object.keys(s || {}).length));
  const changes = recentChanges(f);
  const side = (ours) => (
    <div className="mu-side">
      <Crest src={ours ? usLogo : oppLogo} name={ours ? us : f.opponent} ours={ours} className="mu-crest" discClass="mu-disc" />
      <span className={"mu-name" + (ours ? " ours" : "")}>{ours ? us : f.opponent}</span>
    </div>
  );
  const dismissChanges = () => persist({ ...data, fixtures: data.fixtures.map(x => x.id === f.id ? { ...x, schedChanges: [] } : x), isSample: false });

  return (<>
    <div className="card mhero">
      <div className="mh-head">
        <span className="mh-label">{f.round ? `Round ${f.round} · ` : ""}{home ? "Home" : "Away"} · {fmtDate(f.dateISO) || "Date TBC"}</span>
        {isCoach && <button className="mh-edit" onClick={() => setModal({ type: "fixture", payload: f })}><Pencil size={13} />Edit</button>}
      </div>
      <div className="matchup">
        {side(home)}
        <div className="mu-centre">
          <div className={"mu-big" + (centre.cls ? " " + centre.cls : "")}>{centre.big}</div>
          <div className={"mu-sub" + (centre.up ? " up" : "")}>{centre.sub}</div>
        </div>
        {side(!home)}
      </div>
      {f.venue && (
        <div className="ng-venue">
          <span className="ng-place"><MapPin size={12} /><span>{f.venue}</span></span>
          <a className="dirpill" href={mapsUrl(f.venue)} target="_blank" rel="noopener noreferrer"><Navigation size={13} />Directions</a>
        </div>
      )}
      {upcoming && (f.strip || f.time) && (
        <div className="mpills">
          {f.strip && <span className="mpill kit">{f.strip} kit</span>}
          {f.time && <span className="mpill">Arrive {addMin(f.time, -30)}</span>}
        </div>
      )}
    </div>

    {changes.length > 0 && (
      <div className="card">
        <div className="label" style={{ marginBottom: 6 }}>Schedule changed</div>
        {changes.map((c, i) => (
          <div className="chgrow" key={i}>
            <span className="fld">{c.field}</span>
            {c.oldText && <span className="chg-old">{c.oldText}</span>}
            <span className="chg-new">{c.newText}</span>
          </div>
        ))}
        {isCoach && <button className="chip" style={{ marginTop: 8 }} onClick={dismissChanges}><Check size={13} />Dismiss</button>}
      </div>
    )}

    {scored && scorers.length > 0 && (
      <div className="card goals">
        <div className="label">Goals</div>
        {scorers.map((s, i) => (
          <button key={i} className="goalrow" disabled={!s.p} onClick={() => s.p && setModal({ type: "playerView", payload: s.p })}>
            <span className="gr-disc">{initials(s.name)}</span>
            <span className="gr-name">{s.name}</span>
            <span className="gr-n">{s.n === 1 ? "1 goal" : `${s.n} goals`}</span>
          </button>
        ))}
      </div>
    )}
    {scored && scorers.length === 0 && <div className="card quiet">No scorers recorded for this one.</div>}

    {kind === "youtube" && (
      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>Match video</div>
        <div className="vidwrap" style={{ marginBottom: chapters.length ? 12 : 0 }}>
          <iframe key={seek} src={src} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title="Match video" />
        </div>
        {chapters.length > 0 && (
          <div className="chips" style={{ marginBottom: 0 }}>
            {chapters.map((c, i) => (
              <button key={i} className={"chip" + (seek === (c.t || 0) ? " act" : "")} onClick={() => setSeek(c.t || 0)}>
                {c.label}<span className="t">{secToClock(c.t || 0)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )}
    {(kind === "veo" || kind === "other") && (
      <a className="card linkcard" href={f.video} target="_blank" rel="noopener noreferrer">
        <span className="lc-ic"><Video size={17} /></span>
        <span className="lc-body"><span className="lc-title">Match video</span><span className="lc-sub">{kind === "veo" ? "Watch on Veo" : "Opens in a new tab"}</span></span>
        <ChevronRight size={15} color="#9AA3A6" style={{ flexShrink: 0 }} />
      </a>
    )}
    {!kind && isCoach && <div className="card quiet">No match video linked yet. Add one with Edit.</div>}

    {f.report && (
      <div className="card">
        <div className="label" style={{ marginBottom: 8 }}>Match report</div>
        <div className="note" style={{ fontSize: 13.5, whiteSpace: "pre-wrap", color: "var(--ink)" }}>{f.report}</div>
        <div className="note" style={{ marginTop: 8, fontSize: 11 }}>AI-generated summary from the Veo match camera.</div>
      </div>
    )}
    {f.notes && <div className="card"><div className="label" style={{ marginBottom: 6 }}>Notes</div><div className="note" style={{ fontSize: 13.5 }}>{f.notes}</div></div>}

    {upcoming && players.length > 0 && (
      <div className="card whosin">
        <div className="wi-head">
          <span className="label">Who's in</span>
          <span className="wi-count">{counts.in} in · {counts.out} out · {counts.nr} no reply</span>
        </div>
        {own.length > 0 && (
          <div className="replyrows">
            {own.map(p => <ReplyRow key={p.id} p={p} status={f.availability?.[p.id]?.status || null}
              onTap={() => setModal({ type: "reply", payload: { fixture: f, playerId: p.id } })} />)}
          </div>
        )}
        {guest && <button className="btn" style={{ marginTop: 10 }} onClick={() => setModal({ type: "signin" })}>Sign in to respond</button>}
        <button className="softbtn" onClick={() => onOpen("whosin", { fixtureId: f.id })}>See everyone's replies</button>
      </div>
    )}

    {f.status === "played" && players.some(p => f.availability?.[p.id]?.status === "out") && (
      <div className="card">
        <div className="label" style={{ marginBottom: 6 }}>Unavailable this game</div>
        {players.filter(p => f.availability?.[p.id]?.status === "out").map(p => (
          <div key={p.id} style={{ display: "flex", gap: 8, padding: "5px 0", fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>{p.name}</span>
            <span className="note">{f.availability?.[p.id]?.reason || ""}</span>
          </div>
        ))}
      </div>
    )}

    {upcoming && <DutyCard data={data} f={f} onOpen={onOpen} />}

    {/* Match day (D2): coach only, one slot in the duties-card pattern; tap opens
        the planner takeover. Parents get the read-only live lineup once a plan exists. */}
    {isCoach && upcoming && (() => {
      const { stages, counts: c, noReply } = matchDayStages(data, f, todayISO);
      const plan = stages.find((s) => s.key === "plan"), record = stages.find((s) => s.key === "record");
      const val = record.state === "done" ? "Record saved" : plan.state === "done" ? plan.sub : plan.state === "now" ? "Gaps to fill" : "Plan not started";
      const names = noReply.map((p) => firstName(p.name));
      const meta = c.nr > 0
        ? `${joinNames(names)} ${names.length === 1 ? "hasn't" : "haven't"} replied. They're counted in until you mark them out.`
        : `${c.in} in · ${c.out} out`;
      const open = () => setModal({ type: "plan", payload: f });
      return (
        <div className="card dutycard" role="button" tabIndex={0} aria-label="Match day"
          onClick={open} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}>
          <div className="dc-slot">
            <span className="dc-ic gk"><ClipboardList size={16} /></span>
            <div className="dc-txt">
              <div className="dc-label">Match day</div>
              <div className="dc-val">{val}</div>
              <div className="dc-meta">{meta}</div>
            </div>
          </div>
          <ChevronRight size={15} color="#9AA3A6" style={{ flexShrink: 0 }} />
        </div>
      );
    })()}
    {!isCoach && !cancelled && planExists && (
      <button className="card linkcard" onClick={() => setModal({ type: "plan", payload: f })}>
        <span className="lc-ic"><Play size={17} /></span>
        <span className="lc-body"><span className="lc-title">Live lineup</span><span className="lc-sub">See who's on and when</span></span>
        <ChevronRight size={15} color="#9AA3A6" style={{ flexShrink: 0 }} />
      </button>
    )}

    {teamFeatures(data.team).focus && <FocusCard f={f} label={past ? "Focus that week" : "This week's focus"} coach={coachFirst} />}

    <div className="card">
      {f.dateISO && <CalAdd ev={gameEv(f, data.team.name)} style={{ marginBottom: 12 }} />}
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

/* ---------------- WHO'S IN (S3; S6 restyles it) ---------------- */
// The full availability list for a game. Writes go through /api/rsvp and the
// optimistic state lives on the fixture in data (patchLocal), so Home and
// Match detail counts stay in step; a refused write reverts.
function WhosInScreen({ data, f, isCoach, viewer, me, setModal, patchLocal }) {
  const avail = f.availability || {};
  const account = !!me;
  const ownIds = me ? (me.playerIds || []) : null;
  const canEdit = (pid) => isCoach || (account ? ownIds.includes(pid) : (viewer?.kind === "parent" && viewer.pid === pid));
  const byFor = (pid) => isCoach ? "Coach" : account ? (data.players.find((p) => p.id === pid)?.name || "Parent") : (viewer?.label || "you");
  const writeAv = (av) => patchLocal(d => ({ ...d, fixtures: (d.fixtures || []).map(x => x.id === f.id ? { ...x, availability: av } : x) }));

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
    writeAv(nextAvail);
    try {
      const res = await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "game", id: f.id, playerId: pid, status, reason })
      });
      if (!res.ok) throw new Error("rsvp " + res.status);
    } catch (e) {
      writeAv(avail);
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

  return (
    <div className="card">
      <div className="avsum">
        <span className="avpill in"><Check size={13} />{counts.in} in</span>
        <span className="avpill out"><X size={13} />{counts.out} out</span>
        <span className="avpill nr">{counts.nr} no reply</span>
      </div>
      {!account && viewer?.kind !== "parent" && !isCoach && (
        <button className="btn" style={{ marginBottom: 12 }} onClick={() => setModal({ type: "signin" })}>
          Sign in to mark your child
        </button>
      )}
      {players.length === 0 && <div className="note">No players on the list for this date.</div>}
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
          : "Open Viewing as and sign in to respond for your child."}
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
  );
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
            : "Open Viewing as and sign in to respond for your child."}
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
