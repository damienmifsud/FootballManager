"use client";
import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Settings, ClipboardList, BarChart3, Timer,
  Play, Pause, RotateCcw, Plus, X, Copy, Wand2, Check
} from "lucide-react";
import {
  FORMATION_PRESETS, round1, fmtMin, fmtRange, fmtClock,
  defaultFormatForAgeGroup, parseFormation, fallbackFormation, makePositions,
  computeAutoSubs, computeSegments, sanitizeAssignments, diffOnOff,
  autoFillAssignments, minutesFor, rosterForFixture, seedAssignments, timerElapsed
} from "@/lib/planner";
import { fmtDate, initials } from "@/lib/dashboardData";

/* ---------------------------------------------------------------------------
   MATCH DAY — per-fixture lineup + substitution planner.
   Look: a coach's magnetic tactics board (paper sheet, striped pitch,
   kit-coloured discs, subs like the fourth official's board).

   Integration: opens full-screen from a fixture's sheet. The roster comes
   from the team's player list + the game's RSVPs (never edited here); a
   player with no RSVP counts as in and carries a small red dot wherever
   they render. The plan itself lives on the fixture (fixture.plan) and
   autosaves through the narrow /api/plan endpoint via
   onSavePlan(fixtureId, plan, gk?) — the third arg is the block-1 keeper's
   id when it differs from fixture.gk (the in-goal duty), so saving a plan
   writes the keeper back to the fixture; it is undefined when unchanged.
   The Format tab changes this game only; the team default lives in the
   dashboard's Settings tab. Coaches get the full Plan / Time / Game / Format
   tabs; parents get the read-only live Game view.
--------------------------------------------------------------------------- */

const P = {
  paper: "#F2F4EE",
  card: "#FFFFFF",
  ink: "#17211B",
  dim: "#6C7A70",
  faint: "#9AA79D",
  hair: "#E1E7DD",
  soft: "#EBEFE7",
  pitchA: "#2E7D48",
  pitchB: "#358952",
  line: "rgba(255,255,255,0.72)",
  on: "#1F8F52",
  off: "#D64545",
  warn: "#E07B1F",
  gk: "#F2C43D"
};
const DISPLAY = "'Barlow Condensed','Arial Narrow',system-ui,sans-serif";
const BODY = "'Barlow',system-ui,-apple-system,'Segoe UI',sans-serif";

function kitFg(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? P.ink : "#FFFFFF";
}

/* ------------------------------- UI atoms -------------------------------- */

function Card({ children, style, className }) {
  return (
    <div
      className={"rounded-2xl " + (className || "")}
      style={{ background: P.card, border: "1px solid " + P.hair, boxShadow: "0 1px 2px rgba(23,33,27,0.04)", ...style }}
    >
      {children}
    </div>
  );
}
function Eyebrow({ children }) {
  return (
    <div className="uppercase" style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 12, letterSpacing: 1.6, color: P.dim }}>
      {children}
    </div>
  );
}
function Chip({ active, onClick, children, kit, dot }) {
  const fg = active ? kitFg(kit) : P.ink;
  return (
    <button
      onClick={onClick}
      className="relative shrink-0 rounded-full px-3 py-1 text-sm select-none"
      style={{
        background: active ? kit : P.card,
        color: fg,
        border: "1px solid " + (active ? kit : P.hair),
        fontWeight: active ? 600 : 500
      }}
    >
      {children}
      {dot && (
        <span className="absolute rounded-full" style={{ width: 7, height: 7, background: P.warn, top: -1, right: -1 }} />
      )}
    </button>
  );
}
function NumBox({ value, onCommit, min, max, width, suffix }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => { setTxt(String(value)); }, [value]);
  const commit = () => {
    let v = parseFloat(txt);
    if (isNaN(v)) v = value;
    v = Math.max(min, Math.min(max, v));
    v = round1(v);
    setTxt(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
        className="rounded-xl px-2 py-1 text-center text-sm"
        style={{ width: width || 58, border: "1px solid " + P.hair, background: P.card, color: P.ink, fontWeight: 600 }}
      />
      {suffix && <span className="text-xs" style={{ color: P.dim }}>{suffix}</span>}
    </span>
  );
}
function ArmedButton({ label, armedLabel, onConfirm, danger, className, style }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2600);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
      className={"rounded-xl px-3 py-2 text-sm select-none " + (className || "")}
      style={{
        border: "1px solid " + (armed ? P.off : P.hair),
        color: danger ? P.off : P.ink,
        background: armed ? "rgba(214,69,69,0.08)" : P.card,
        fontWeight: 600,
        ...style
      }}
    >
      {armed ? (armedLabel || "Tap again to confirm") : label}
    </button>
  );
}
function ToggleRow({ label, sub, value, onChange, kit }) {
  return (
    <button onClick={() => onChange(!value)} className="flex w-full items-center justify-between py-1 select-none">
      <span className="text-left">
        <span className="block text-sm" style={{ fontWeight: 600 }}>{label}</span>
        {sub && <span className="block text-xs" style={{ color: P.dim }}>{sub}</span>}
      </span>
      <span
        className="relative rounded-full transition"
        style={{ width: 44, height: 26, background: value ? kit : "#D7DED3", flexShrink: 0 }}
      >
        <span
          className="absolute rounded-full transition"
          style={{ width: 20, height: 20, top: 3, left: value ? 21 : 3, background: "#FFF", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }}
        />
      </span>
    </button>
  );
}
function NoReplyTag() {
  return (
    <span className="rounded-full px-2 text-xs" style={{ background: "rgba(224,123,31,0.14)", color: P.warn, fontWeight: 700, paddingTop: 1, paddingBottom: 1 }}>
      no reply
    </span>
  );
}

/* -------------------------------- pitch ---------------------------------- */

function PitchSVG() {
  const stripes = [];
  const H = 134, N = 8, bh = H / N;
  for (let i = 0; i < N; i++) {
    stripes.push(<rect key={i} x="0" y={i * bh} width="100" height={bh + 0.2} fill={i % 2 ? P.pitchB : P.pitchA} />);
  }
  const L = { stroke: P.line, strokeWidth: 0.7, fill: "none" };
  return (
    <svg viewBox="0 0 100 134" className="block h-full w-full" preserveAspectRatio="none">
      {stripes}
      <rect x="2.5" y="2.5" width="95" height="129" {...L} />
      <line x1="2.5" y1="67" x2="97.5" y2="67" {...L} />
      <circle cx="50" cy="67" r="9.5" {...L} />
      <circle cx="50" cy="67" r="0.9" fill={P.line} />
      {/* bottom (our) goal */}
      <rect x="28" y="106" width="44" height="25.5" {...L} />
      <rect x="39" y="121.5" width="22" height="10" {...L} />
      <circle cx="50" cy="112.5" r="0.9" fill={P.line} />
      <path d="M 40 106 A 10.5 10.5 0 0 1 60 106" {...L} />
      {/* top goal */}
      <rect x="28" y="2.5" width="44" height="25.5" {...L} />
      <rect x="39" y="2.5" width="22" height="10" {...L} />
      <circle cx="50" cy="21.5" r="0.9" fill={P.line} />
      <path d="M 40 28 A 10.5 10.5 0 0 0 60 28" {...L} />
      {/* corners */}
      <path d="M 2.5 6.5 A 4 4 0 0 0 6.5 2.5" {...L} />
      <path d="M 93.5 2.5 A 4 4 0 0 0 97.5 6.5" {...L} />
      <path d="M 97.5 127.5 A 4 4 0 0 0 93.5 131.5" {...L} />
      <path d="M 6.5 131.5 A 4 4 0 0 0 2.5 127.5" {...L} />
    </svg>
  );
}

/* --------------------------------- app ----------------------------------- */

export default function MatchDayPlanner({ data, fixture, isCoach, onSavePlan, close }) {
  const plan0 = fixture.plan || null;
  const initialFormat = () =>
    plan0?.format || data.team?.matchFormat || defaultFormatForAgeGroup(data.team?.ageGroup);

  const [view, setView] = useState(isCoach ? "plan" : "game");
  const [format, setFormat] = useState(initialFormat);
  const [subTimes, setSubTimes] = useState(() =>
    plan0?.subTimes ?? computeAutoSubs(initialFormat().gameLength, initialFormat().periods, initialFormat().subInterval)
  );
  const [overrides, setOverrides] = useState(() => plan0?.overrides || {});
  const [assignments, setAssignments] = useState(() => {
    if (plan0?.assignments) return plan0.assignments;
    // Fresh plan: pin the fixture's in-goal duty into GK for every block.
    const fmt = initialFormat();
    const st = plan0?.subTimes ?? computeAutoSubs(fmt.gameLength, fmt.periods, fmt.subInterval);
    const segs = computeSegments(fmt.gameLength, fmt.periods, st);
    const of = Math.max(0, fmt.playersOnField - (fmt.hasGK ? 1 : 0));
    const pr = parseFormation(fmt.formation);
    const rowsArr = pr.length > 0 && pr.reduce((a, b) => a + b, 0) === of ? pr : parseFormation(fallbackFormation(of));
    const pos = makePositions(rowsArr, fmt.hasGK);
    return seedAssignments(segs, pos, rosterForFixture(data, fixture, plan0?.overrides || {}), fixture.gk);
  });
  const [segIdx, setSegIdx] = useState(0);
  const [sheet, setSheet] = useState(null); // { posKey }
  const [sheetAll, setSheetAll] = useState(false);
  const [hintSeen, setHintSeen] = useState(!!plan0?.hintSeen);
  const [savedTick, setSavedTick] = useState(0);
  // Persisted-friendly timer: elapsed is the base at anchorTs while running.
  const [timer, setTimer] = useState(() => {
    const t = plan0?.timer;
    if (!t) return { running: false, elapsed: 0, anchorTs: null };
    return { running: !!t.running, elapsed: t.elapsed || 0, anchorTs: t.running ? (t.anchorTs || Date.now()) : null };
  });
  const lastSavedRef = useRef("");
  // Block-1 keeper as of the last save (seeded from the plan the planner opened
  // with), so only a coach's change to block 1's GK writes back to the duty.
  const gkBaseRef = useRef(null);

  const kit = fixture.strip === "Blue" ? "#2857C4" : "#C8102E";
  const kitText = kitFg(kit);
  const teamName = data.team?.name || "Team";

  /* fonts */
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600;700&display=swap";
    document.head.appendChild(l);
    return () => { try { document.head.removeChild(l); } catch (e) {} };
  }, []);

  /* derived */
  const roster = useMemo(() => rosterForFixture(data, fixture, overrides), [data, fixture, overrides]);
  const outfield = Math.max(0, format.playersOnField - (format.hasGK ? 1 : 0));
  const parsedRows = useMemo(() => parseFormation(format.formation), [format.formation]);
  const formationValid = parsedRows.length > 0 && parsedRows.reduce((a, b) => a + b, 0) === outfield && parsedRows.every((r) => r <= 6) && parsedRows.length <= 5;
  const rows = useMemo(
    () => (formationValid ? parsedRows : parseFormation(fallbackFormation(outfield))),
    [formationValid, parsedRows, outfield]
  );
  const positions = useMemo(() => makePositions(rows, format.hasGK), [rows, format.hasGK]);
  const segments = useMemo(
    () => computeSegments(format.gameLength, format.periods, subTimes),
    [format.gameLength, format.periods, subTimes]
  );
  const plan = useMemo(
    () => sanitizeAssignments(assignments, segments, positions, roster),
    [assignments, segments, positions, roster]
  );
  const playersById = useMemo(() => {
    const m = {};
    roster.forEach((p) => (m[p.id] = p));
    return m;
  }, [roster]);
  const minutes = useMemo(() => minutesFor(plan, segments, roster), [plan, segments, roster]);
  const availableCount = roster.filter((p) => p.available).length;
  const fairShare = availableCount ? round1((format.gameLength * positions.length) / availableCount) : 0;
  const plen = format.gameLength / format.periods;
  const periodBoundaries = useMemo(() => {
    const b = [];
    for (let p = 1; p < format.periods; p++) b.push(round1(plen * p));
    return b;
  }, [format.periods, plen]);
  const periodTagFor = (start) => {
    const i = periodBoundaries.indexOf(start);
    if (i < 0) return null;
    if (format.periods === 2) return "HT";
    return (format.periods === 4 ? "Q" : "P") + (i + 2);
  };
  const periodNameFor = (gm) => {
    const idx = Math.max(0, Math.min(format.periods - 1, Math.floor(gm / plen + 1e-9)));
    if (format.periods === 1) return "Full game";
    const ord = ["1st", "2nd", "3rd", "4th"][idx] || idx + 1 + "th";
    const unit = format.periods === 2 ? "half" : format.periods === 3 ? "third" : format.periods === 4 ? "quarter" : "period";
    return ord + " " + unit;
  };

  useEffect(() => {
    if (segIdx >= segments.length) setSegIdx(Math.max(0, segments.length - 1));
  }, [segments.length, segIdx]);

  /* autosave (coach only) through the narrow per-fixture endpoint. The
     block-1 keeper writes back to the fixture's in-goal duty (third arg) only
     when the coach has SET a different keeper in block 1 since the planner
     opened (or since the last save) and that keeper isn't already the duty.
     Opening the planner never touches the duty: a stale plan, an out or
     inactive duty keeper, or a no-keeper format all leave fixture.gk alone,
     and an emptied spot never clears it. */
  useEffect(() => {
    if (!isCoach) return;
    const gkFirst = plan[0]?.GK || "";
    if (gkBaseRef.current === null) gkBaseRef.current = gkFirst;
    const payload = { format, subTimes, assignments: plan, overrides, timer, hintSeen };
    const json = JSON.stringify(payload);
    if (json === lastSavedRef.current) return;
    const t = setTimeout(() => {
      lastSavedRef.current = json;
      const changed = gkFirst !== gkBaseRef.current;
      gkBaseRef.current = gkFirst;
      const writeBack = changed && !!gkFirst && !!format.hasGK && gkFirst !== (fixture.gk || "");
      onSavePlan(fixture.id, { ...payload, updatedAt: Date.now() }, writeBack ? gkFirst : undefined);
      setSavedTick((x) => x + 1);
    }, 700);
    return () => clearTimeout(t);
  }, [format, subTimes, plan, overrides, timer, hintSeen, isCoach, fixture.id, fixture.gk, onSavePlan]);

  /* settings updaters (regenerate sub times when the match shape changes) */
  const setGameLength = (v) => {
    setFormat((s) => ({ ...s, gameLength: v }));
    setSubTimes(computeAutoSubs(v, format.periods, format.subInterval));
  };
  const setPeriods = (v) => {
    setFormat((s) => ({ ...s, periods: v }));
    setSubTimes(computeAutoSubs(format.gameLength, v, format.subInterval));
  };
  const setInterval_ = (v) => {
    setFormat((s) => ({ ...s, subInterval: v }));
    setSubTimes(computeAutoSubs(format.gameLength, format.periods, v));
  };
  const setPlayersOnField = (v) => {
    const of = Math.max(0, v - (format.hasGK ? 1 : 0));
    setFormat((s) => ({ ...s, playersOnField: v, formation: fallbackFormation(of) }));
  };
  const setHasGK = (v) => {
    const of = Math.max(0, format.playersOnField - (v ? 1 : 0));
    setFormat((s) => ({ ...s, hasGK: v, formation: fallbackFormation(of) }));
  };

  /* assignment ops */
  const mutatePlan = (fn) => {
    setAssignments((raw) => {
      const base = sanitizeAssignments(raw, segments, positions, roster).map((s) => ({ ...s }));
      fn(base);
      return base;
    });
  };
  const applyAssign = (base, i, posKey, playerId) => {
    const seg = { ...base[i] };
    if (playerId) {
      const fromKey = Object.keys(seg).find((k) => seg[k] === playerId);
      const displaced = seg[posKey];
      if (fromKey && fromKey !== posKey) {
        if (displaced) seg[fromKey] = displaced;
        else delete seg[fromKey];
      }
      seg[posKey] = playerId;
    } else {
      delete seg[posKey];
    }
    base[i] = seg;
  };
  const assignPlayer = (i, posKey, playerId, all) => {
    mutatePlan((base) => {
      (all ? base.map((_, k) => k) : [i]).forEach((k) => applyAssign(base, k, posKey, playerId));
    });
  };
  const copyPrev = (i) => { if (i > 0) mutatePlan((base) => { base[i] = { ...base[i - 1] }; }); };
  const clearBlock = (i) => mutatePlan((base) => { base[i] = {}; });
  const clearAllBlocks = () => mutatePlan((base) => { base.forEach((_, i) => (base[i] = {})); });
  const runAutoFill = () => setAssignments(autoFillAssignments(plan, segments, positions, roster));

  const resetPlan = () => {
    const fmt = data.team?.matchFormat || defaultFormatForAgeGroup(data.team?.ageGroup);
    const st = computeAutoSubs(fmt.gameLength, fmt.periods, fmt.subInterval);
    const segs = computeSegments(fmt.gameLength, fmt.periods, st);
    const of = Math.max(0, fmt.playersOnField - (fmt.hasGK ? 1 : 0));
    const pr = parseFormation(fmt.formation);
    const rowsArr = pr.length > 0 && pr.reduce((a, b) => a + b, 0) === of ? pr : parseFormation(fallbackFormation(of));
    const pos = makePositions(rowsArr, fmt.hasGK);
    setFormat(fmt);
    setSubTimes(st);
    setOverrides({});
    setAssignments(seedAssignments(segs, pos, rosterForFixture(data, fixture, {}), fixture.gk));
    setSegIdx(0);
    setTimer({ running: false, elapsed: 0, anchorTs: null });
  };

  /* sub time ops */
  const [addTime, setAddTime] = useState("");
  const removeSubTime = (t) => setSubTimes((ts) => ts.filter((x) => x !== t));
  const addSubTime = () => {
    const v = round1(parseFloat(addTime));
    if (isNaN(v) || v <= 0 || v >= format.gameLength) return;
    setSubTimes((ts) => (ts.includes(v) ? ts : [...ts, v].sort((a, b) => a - b)));
    setAddTime("");
  };

  /* game timer — clock derives from the persisted anchor, so it survives a
     reload and ticks for read-only parents too */
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!timer.running) return;
    const id = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(id);
  }, [timer.running]);
  const cap = format.gameLength * 60;
  const elapsedNow = timerElapsed(timer, format.gameLength);
  useEffect(() => {
    if (timer.running && elapsedNow >= cap) setTimer({ running: false, elapsed: cap, anchorTs: null });
  }, [timer.running, elapsedNow, cap]);
  const toggleTimer = () => {
    setTimer((t) => t.running
      ? { running: false, elapsed: timerElapsed(t, format.gameLength), anchorTs: null }
      : { running: true, elapsed: timerElapsed(t, format.gameLength), anchorTs: Date.now() });
  };
  const nudgeTimer = (dSec) => {
    setTimer((t) => {
      const e = Math.max(0, Math.min(cap, timerElapsed(t, format.gameLength) + dSec));
      return t.running ? { running: true, elapsed: e, anchorTs: Date.now() } : { running: false, elapsed: e, anchorTs: null };
    });
  };
  const resetTimer = () => setTimer({ running: false, elapsed: 0, anchorTs: null });

  /* ------------------------------ subviews ------------------------------- */

  const curSeg = segments[segIdx] || segments[0];
  const curAssign = plan[segIdx] || {};
  const benchThisBlock = roster.filter((p) => p.available && !Object.values(curAssign).includes(p.id));
  const blockIncomplete = (i) => Object.keys(plan[i] || {}).length < positions.length;

  // Kit-coloured disc; a no-reply player gets a red dot on the shoulder.
  const renderDisc = (player, size, gk) => {
    const bg = gk ? P.gk : kit;
    const fg = gk ? P.ink : kitText;
    return (
      <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
        <span
          className="inline-flex items-center justify-center rounded-full"
          style={{
            width: size, height: size, background: bg, color: fg,
            fontFamily: DISPLAY, fontWeight: 700, fontSize: size * 0.46,
            boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.25)",
            border: "2px solid rgba(255,255,255,0.85)",
            flexShrink: 0
          }}
        >
          {player ? (player.number || initials(player.name)) : ""}
        </span>
        {player?.noReply && <span className="rdot" aria-label="No reply" />}
      </span>
    );
  };

  const rsvpChip = (p) => {
    if (p.overridden) return <span className="text-xs" style={{ color: P.warn, fontWeight: 700 }}>coach: {p.available ? "in" : "out"}</span>;
    if (p.rsvp === "in") return <span className="text-xs" style={{ color: P.on, fontWeight: 700 }}>In</span>;
    if (p.rsvp === "out") return <span className="text-xs" style={{ color: P.off, fontWeight: 700 }}>Out</span>;
    return <NoReplyTag />;
  };

  const FormatView = (
    <div className="flex flex-col gap-3">
      <Card className="p-4">
        <Eyebrow>Availability — from RSVPs</Eyebrow>
        <div className="mt-1 text-xs" style={{ color: P.dim }}>
          Parents reply on the fixture. Tap IN / OUT here to override for this game only — it never changes their RSVP.
        </div>
        <div className="mt-2">
          {roster.length === 0 && <div className="py-2 text-sm" style={{ color: P.dim }}>No players in the squad yet — add them in the dashboard's Squad tab.</div>}
          {roster.map((p) => (
            <div key={p.id} className="flex items-center gap-2 py-1" style={{ borderTop: "1px solid " + P.soft, opacity: p.available ? 1 : 0.6 }}>
              {renderDisc(p, 26, false)}
              <span className="min-w-0 flex-1 truncate text-sm" style={{ fontWeight: 600, textDecoration: p.available ? "none" : "line-through" }}>{p.name}</span>
              {rsvpChip(p)}
              <button
                onClick={() => setOverrides((o) => ({ ...o, [p.id]: "in" }))}
                className="rounded-full px-2 py-1 text-xs"
                style={{ background: p.available ? "rgba(31,143,82,0.12)" : P.soft, color: p.available ? P.on : P.dim, fontWeight: 700 }}
              >IN</button>
              <button
                onClick={() => setOverrides((o) => ({ ...o, [p.id]: "out" }))}
                className="rounded-full px-2 py-1 text-xs"
                style={{ background: !p.available ? "rgba(214,69,69,0.12)" : P.soft, color: !p.available ? P.off : P.dim, fontWeight: 700 }}
              >OUT</button>
            </div>
          ))}
        </div>
        {Object.keys(overrides).length > 0 && (
          <button onClick={() => setOverrides({})} className="mt-2 rounded-xl px-3 py-1 text-xs" style={{ border: "1px solid " + P.hair, fontWeight: 600, color: P.dim }}>
            Clear overrides — back to RSVPs
          </button>
        )}
      </Card>

      <Card className="p-4">
        <Eyebrow>Match format</Eyebrow>
        <div className="mt-3 text-sm" style={{ fontWeight: 600 }}>Game length</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {[40, 50, 60, 70, 90].map((v) => (
            <Chip key={v} kit={kit} active={format.gameLength === v} onClick={() => setGameLength(v)}>{v}'</Chip>
          ))}
          <NumBox value={format.gameLength} min={10} max={120} onCommit={setGameLength} suffix="min total" />
        </div>

        <div className="mt-4 text-sm" style={{ fontWeight: 600 }}>Halves / quarters</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {[1, 2, 3, 4].map((v) => (
            <Chip key={v} kit={kit} active={format.periods === v} onClick={() => setPeriods(v)}>
              {v === 1 ? "1 · straight through" : v === 2 ? "2 halves" : v === 3 ? "3 thirds" : "4 quarters"}
            </Chip>
          ))}
        </div>
        <div className="mt-1 text-xs" style={{ color: P.dim }}>
          {format.periods > 1 ? "Each " + (format.periods === 2 ? "half" : format.periods === 3 ? "third" : "quarter") + " runs " + fmtMin(plen) + " min. Breaks are always sub opportunities." : "No breaks — subs happen on the fly."}
        </div>

        <div className="mt-4 text-sm" style={{ fontWeight: 600 }}>Players on the pitch</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {[4, 5, 7, 9, 11].map((v) => (
            <Chip key={v} kit={kit} active={format.playersOnField === v} onClick={() => setPlayersOnField(v)}>{v}v{v}</Chip>
          ))}
          <NumBox value={format.playersOnField} min={3} max={11} onCommit={setPlayersOnField} suffix="a side" />
        </div>
        <div className="mt-3">
          <ToggleRow
            kit={kit}
            label="Goalkeeper"
            sub={format.hasGK ? "1 keeper + " + outfield + " outfield" : "No keeper — all " + outfield + " outfield"}
            value={format.hasGK}
            onChange={setHasGK}
          />
        </div>
      </Card>

      <Card className="p-4">
        <Eyebrow>Formation</Eyebrow>
        <div className="mt-2 flex flex-wrap gap-2">
          {(FORMATION_PRESETS[outfield] || []).map((f) => (
            <Chip key={f} kit={kit} active={format.formation === f} onClick={() => setFormat((s) => ({ ...s, formation: f }))}>{f}</Chip>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            value={format.formation}
            onChange={(e) => setFormat((s) => ({ ...s, formation: e.target.value }))}
            placeholder={"custom e.g. " + fallbackFormation(outfield)}
            className="w-36 rounded-xl px-3 py-2 text-sm"
            style={{ border: "1px solid " + (formationValid ? P.hair : P.warn), background: P.card, fontWeight: 600, letterSpacing: 1 }}
          />
          <span className="text-xs" style={{ color: P.dim }}>defence first, attack last{format.hasGK ? " (keeper is automatic)" : ""}</span>
        </div>
        {!formationValid && (
          <div className="mt-2 text-xs" style={{ color: P.warn, fontWeight: 600 }}>
            Rows need to add up to {outfield} outfield player{outfield === 1 ? "" : "s"} — using {fallbackFormation(outfield)} for now.
          </div>
        )}
        <div className="mt-3 flex flex-col items-center gap-1 rounded-xl py-3" style={{ background: P.soft }}>
          {[...rows].reverse().map((c, i) => (
            <div key={i} className="flex gap-2">
              {Array.from({ length: c }).map((_, j) => (
                <span key={j} className="rounded-full" style={{ width: 12, height: 12, background: kit, border: "1.5px solid rgba(255,255,255,0.9)" }} />
              ))}
            </div>
          ))}
          {format.hasGK && <span className="rounded-full" style={{ width: 12, height: 12, background: P.gk, border: "1.5px solid rgba(255,255,255,0.9)" }} />}
        </div>
      </Card>

      <Card className="p-4">
        <Eyebrow>Substitution times</Eyebrow>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span style={{ fontWeight: 600 }}>Sub every</span>
          <NumBox value={format.subInterval} min={2} max={45} onCommit={setInterval_} suffix="min" />
          <button
            onClick={() => setSubTimes(computeAutoSubs(format.gameLength, format.periods, format.subInterval))}
            className="rounded-xl px-3 py-1 text-sm"
            style={{ border: "1px solid " + P.hair, fontWeight: 600 }}
          >
            Regenerate
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {periodBoundaries.map((t) => (
            <span key={"pb" + t} className="rounded-full px-3 py-1 text-sm" style={{ background: P.soft, color: P.dim, fontWeight: 600 }}>
              {fmtMin(t)}' {periodTagFor(t)}
            </span>
          ))}
          {[...subTimes].sort((a, b) => a - b).map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full py-1 pl-3 pr-1 text-sm" style={{ border: "1px solid " + P.hair, fontWeight: 600 }}>
              {fmtMin(t)}'
              <button onClick={() => removeSubTime(t)} className="flex items-center justify-center rounded-full" style={{ width: 20, height: 20, color: P.dim }}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={addTime}
            onChange={(e) => setAddTime(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addSubTime(); }}
            placeholder="min"
            className="w-20 rounded-xl px-3 py-2 text-sm"
            style={{ border: "1px solid " + P.hair }}
          />
          <button onClick={addSubTime} className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm" style={{ background: kit, color: kitText, fontWeight: 600 }}>
            <Plus size={15} /> Add sub time
          </button>
        </div>
        <div className="mt-2 text-xs" style={{ color: P.dim }}>
          This gives you {segments.length} blocks of play. Break times stay in automatically.
        </div>
      </Card>

      <Card className="p-4">
        <Eyebrow>This plan</Eyebrow>
        <div className="mt-2 text-xs" style={{ color: P.dim }}>
          The format above applies to this game only. The team default lives in Settings.
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ArmedButton danger label="Clear this plan" armedLabel="Really clear? Tap again" onConfirm={resetPlan} />
        </div>
      </Card>
    </div>
  );

  const summaryFor = (i) => {
    if (i === 0) {
      return (
        <div className="flex items-center justify-between">
          <div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, letterSpacing: 0.4 }}>KICK-OFF LINEUP</div>
            <div className="text-xs" style={{ color: P.dim }}>{Object.keys(curAssign).length} starting · {benchThisBlock.length} on the bench</div>
          </div>
          <span className="rounded-full px-3 py-1 text-xs" style={{ background: P.soft, fontWeight: 700 }}>{fmtRange(curSeg.start, curSeg.end)}</span>
        </div>
      );
    }
    const d = diffOnOff(plan[i - 1], plan[i]);
    const tag = periodTagFor(segments[i].start);
    return (
      <div>
        <div className="flex items-center justify-between">
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, letterSpacing: 0.4 }}>
            SUBS AT {fmtMin(segments[i].start)}'
          </div>
          <span className="flex items-center gap-2">
            {tag && <span className="rounded-full px-2 py-1 text-xs" style={{ background: kit, color: kitText, fontWeight: 700 }}>{tag === "HT" ? "HALF-TIME" : tag}</span>}
            <span className="rounded-full px-3 py-1 text-xs" style={{ background: P.soft, fontWeight: 700 }}>{fmtRange(segments[i].start, segments[i].end)}</span>
          </span>
        </div>
        {d.on.length === 0 && d.off.length === 0 ? (
          <div className="mt-1 text-xs" style={{ color: P.dim }}>No changes planned — same {positions.length} stay on.</div>
        ) : (
          <div className="mt-2 flex flex-col gap-1 text-sm">
            <div className="flex items-start gap-2">
              <span className="mt-px rounded px-2 text-xs" style={{ background: P.on, color: "#fff", fontWeight: 800, paddingTop: 2, paddingBottom: 2 }}>ON</span>
              <span style={{ fontWeight: 600 }}>{d.on.map((id) => playersById[id] && playersById[id].name).filter(Boolean).join(", ") || "—"}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="mt-px rounded px-2 text-xs" style={{ background: P.off, color: "#fff", fontWeight: 800, paddingTop: 2, paddingBottom: 2 }}>OFF</span>
              <span style={{ fontWeight: 600, color: P.dim }}>{d.off.map((id) => playersById[id] && playersById[id].name).filter(Boolean).join(", ") || "—"}</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const PlanView = (
    <div className="flex flex-col gap-3">
      {roster.length === 0 ? (
        <Card className="p-6 text-center">
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22 }}>NO SQUAD YET</div>
          <div className="mt-1 text-sm" style={{ color: P.dim }}>Add your players in the dashboard's Squad tab, then come back here to set the lineup and plan subs.</div>
        </Card>
      ) : (
        <>
          {availableCount < format.playersOnField && (
            <Card className="p-3" style={{ borderColor: P.warn, background: "rgba(224,123,31,0.07)" }}>
              <div className="text-sm" style={{ color: P.warn, fontWeight: 600 }}>
                Only {availableCount} marked IN — you need {format.playersOnField} on the pitch. Check availability in Format.
              </div>
            </Card>
          )}

          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {segments.map((s, i) => (
              <Chip key={i} kit={kit} active={i === segIdx} onClick={() => setSegIdx(i)} dot={blockIncomplete(i)}>
                <span style={{ fontFamily: DISPLAY, fontWeight: 700 }}>{i + 1}</span>
                <span className="ml-1" style={{ fontSize: 12 }}>{fmtRange(s.start, s.end)}</span>
                {periodTagFor(s.start) && <span className="ml-1" style={{ fontSize: 10, fontWeight: 800 }}>{periodTagFor(s.start)}</span>}
              </Chip>
            ))}
          </div>
          {roster.some((p) => p.noReply) && (
            <div className="flex items-center gap-2 px-1 text-xs" style={{ color: P.dim }}>
              <span className="rdot" aria-hidden="true" style={{ position: "static", display: "inline-block", flexShrink: 0 }} />
              <span>No reply yet — counted in until you mark them out.</span>
            </div>
          )}

          <Card className="p-4">{summaryFor(segIdx)}</Card>

          <div
            className="relative w-full overflow-hidden"
            style={{ aspectRatio: "100/134", borderRadius: 22, boxShadow: "0 8px 24px rgba(23,33,27,0.18)" }}
          >
            <PitchSVG />
            <div className="absolute inset-0">
              {positions.map((pos) => {
                const pid = curAssign[pos.key];
                const player = pid ? playersById[pid] : null;
                const absent = player && !player.available;
                return (
                  <button
                    key={pos.key}
                    onClick={() => { setSheet({ posKey: pos.key }); setSheetAll(false); }}
                    className="absolute flex flex-col items-center select-none"
                    style={{ left: pos.x + "%", top: pos.y + "%", transform: "translate(-50%,-50%)" }}
                  >
                    {player ? (
                      <>
                        <span style={absent ? { filter: "grayscale(0.4)" } : null}>{renderDisc(player, 42, pos.gk)}</span>
                        <span
                          className="mt-1 max-w-full truncate rounded-full px-2"
                          style={{
                            background: absent ? "rgba(224,123,31,0.92)" : "rgba(12,24,16,0.62)",
                            color: "#fff", fontSize: 10.5, fontWeight: 600, paddingTop: 2, paddingBottom: 2, maxWidth: 70
                          }}
                        >
                          {player.name.split(" ")[0]}
                        </span>
                      </>
                    ) : (
                      <>
                        <span
                          className="flex items-center justify-center rounded-full"
                          style={{
                            width: 42, height: 42, border: "2px dashed rgba(255,255,255,0.8)",
                            color: "rgba(255,255,255,0.92)", fontFamily: DISPLAY, fontWeight: 700, fontSize: 13,
                            background: "rgba(255,255,255,0.08)"
                          }}
                        >
                          {pos.label}
                        </span>
                        <span className="mt-1 rounded-full px-2" style={{ background: "rgba(12,24,16,0.4)", color: "rgba(255,255,255,0.85)", fontSize: 10, paddingTop: 2, paddingBottom: 2 }}>
                          tap
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <Card className="p-3">
            <Eyebrow>Bench this block</Eyebrow>
            <div className="mt-2 flex flex-wrap gap-2">
              {benchThisBlock.length === 0 && <span className="text-xs" style={{ color: P.dim }}>Everyone available is on the pitch.</span>}
              {benchThisBlock.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm" style={{ border: "1px solid " + P.hair }}>
                  {renderDisc(p, 24, false)}
                  <span style={{ fontWeight: 600 }}>{p.name.split(" ")[0]}</span>
                  <span className="text-xs" style={{ color: P.dim }}>{fmtMin(minutes[p.id] || 0)}'</span>
                  {p.noReply && <NoReplyTag />}
                </span>
              ))}
            </div>
          </Card>

          <button onClick={runAutoFill} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-base" style={{ background: kit, color: kitText, fontWeight: 700, boxShadow: "0 4px 12px rgba(23,33,27,0.15)" }}>
            <Wand2 size={18} /> Auto-fill for fair minutes
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => copyPrev(segIdx)}
              disabled={segIdx === 0}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm"
              style={{ border: "1px solid " + P.hair, background: P.card, fontWeight: 600, opacity: segIdx === 0 ? 0.45 : 1 }}
            >
              <Copy size={15} /> Copy previous
            </button>
            <button
              onClick={() => clearBlock(segIdx)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm"
              style={{ border: "1px solid " + P.hair, background: P.card, color: P.off, fontWeight: 600 }}
            >
              <X size={15} /> Clear block
            </button>
          </div>
          <div className="flex items-center justify-between px-1">
            <span className="text-xs" style={{ color: P.dim }}>
              Auto-fill only touches empty spots — lock in your keeper first if they play the whole game.
            </span>
            <ArmedButton label="Clear all" armedLabel="Sure?" onConfirm={clearAllBlocks} danger style={{ paddingTop: 4, paddingBottom: 4, fontSize: 12 }} />
          </div>

          {!hintSeen && (
            <Card className="flex items-start gap-2 p-3" style={{ background: "#FDFBEA", borderColor: "#EFE4B4" }}>
              <div className="flex-1 text-xs" style={{ color: "#7A6A22" }}>
                <b>How it works:</b> pick a block along the top, tap any spot on the pitch to choose who plays there, and the ON/OFF board updates automatically. Tick "every block" in the picker to lock someone into a position all game.
              </div>
              <button onClick={() => setHintSeen(true)} style={{ color: "#7A6A22" }}><X size={16} /></button>
            </Card>
          )}
        </>
      )}
    </div>
  );

  const TimeView = (
    <div className="flex flex-col gap-3">
      <Card className="p-4">
        <div className="flex items-end justify-between">
          <div>
            <Eyebrow>Fair share</Eyebrow>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 34, lineHeight: 1 }}>{fmtMin(fairShare)}'</div>
          </div>
          <div className="text-right text-xs" style={{ color: P.dim }}>
            per player if minutes were split evenly<br />({positions.length} spots × {fmtMin(format.gameLength)}' ÷ {availableCount || "—"} available)
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-3 text-xs" style={{ color: P.dim }}>
          <span className="inline-flex items-center gap-1"><span className="rounded" style={{ width: 12, height: 12, background: kit }} /> on the pitch</span>
          <span className="inline-flex items-center gap-1"><span className="rounded" style={{ width: 12, height: 12, background: P.gk }} /> in goal</span>
          <span className="inline-flex items-center gap-1"><span className="rounded" style={{ width: 12, height: 12, background: P.soft, border: "1px solid " + P.hair }} /> bench</span>
        </div>
        {roster.length === 0 && <div className="text-sm" style={{ color: P.dim }}>Add players in the dashboard's Squad tab to see minutes here.</div>}
        {[...roster]
          .sort((a, b) => (b.available ? 1 : 0) - (a.available ? 1 : 0) || (minutes[b.id] || 0) - (minutes[a.id] || 0) || a.name.localeCompare(b.name))
          .map((p) => {
            const total = minutes[p.id] || 0;
            const diff = round1(total - fairShare);
            return (
              <div key={p.id} className="flex items-center gap-2 py-1" style={{ opacity: p.available ? 1 : 0.45 }}>
                <span className="w-20 truncate text-sm" style={{ fontWeight: 600 }}>{p.name.split(" ")[0]}</span>
                <div className="flex h-6 flex-1 gap-px overflow-hidden rounded-md">
                  {segments.map((s, i) => {
                    const seg = plan[i] || {};
                    const posKey = Object.keys(seg).find((k) => seg[k] === p.id);
                    const pos = posKey ? positions.find((q) => q.key === posKey) : null;
                    const on = !!pos;
                    const isGK = pos && pos.gk;
                    return (
                      <span
                        key={i}
                        className="flex items-center justify-center overflow-hidden"
                        style={{
                          flexGrow: s.end - s.start, flexBasis: 0,
                          background: on ? (isGK ? P.gk : kit) : P.soft,
                          color: on ? (isGK ? P.ink : kitText) : P.faint,
                          fontSize: 9, fontWeight: 700, letterSpacing: 0.3,
                          borderRight: "none"
                        }}
                        title={fmtRange(s.start, s.end)}
                      >
                        {on ? pos.label : ""}
                      </span>
                    );
                  })}
                </div>
                <span className="w-14 text-right">
                  <span className="text-sm" style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17 }}>{fmtMin(total)}'</span>
                  {p.available && (
                    <span className="block text-xs" style={{ color: Math.abs(diff) <= 2 ? P.faint : P.warn, fontWeight: 600 }}>
                      {diff > 0 ? "+" : ""}{fmtMin(diff)}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
      </Card>
      <div className="px-1 text-xs" style={{ color: P.dim }}>
        Blocks are drawn to scale — wider block, more minutes. Aim for everyone within a couple of minutes of fair share.
      </div>
    </div>
  );

  /* game view derived */
  const gm = elapsedNow / 60;
  const isFT = format.gameLength > 0 && gm >= format.gameLength - 1e-9;
  let liveIdx = 0;
  segments.forEach((s, i) => { if (gm >= s.start - 1e-9) liveIdx = i; });
  const liveSeg = segments[liveIdx];
  const liveAssign = plan[liveIdx] || {};
  const nextIdx = liveIdx + 1;
  const nextDiff = nextIdx < segments.length ? diffOnOff(plan[liveIdx], plan[nextIdx]) : null;
  const boundary = liveSeg ? liveSeg.end : format.gameLength;
  const countdown = Math.max(0, boundary * 60 - elapsedNow);
  const boundaryTag = periodTagFor(round1(boundary));
  const liveBench = roster.filter((p) => p.available && !Object.values(liveAssign).includes(p.id));

  const GameView = (
    <div className="flex flex-col gap-3">
      <Card className="p-5 text-center">
        <div className="text-xs uppercase" style={{ color: P.dim, letterSpacing: 1.5, fontWeight: 600 }}>
          {isFT ? "Full time" : periodNameFor(Math.min(gm, format.gameLength - 0.01)) + " · block " + (liveIdx + 1) + " · " + fmtRange(liveSeg.start, liveSeg.end)}
        </div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 64, lineHeight: 1.05, letterSpacing: 1 }}>
          {fmtClock(elapsedNow)}
        </div>
        <div className="mx-auto mt-2 h-2 w-full overflow-hidden rounded-full" style={{ background: P.soft }}>
          <div className="h-full rounded-full" style={{ width: Math.min(100, (elapsedNow / (format.gameLength * 60)) * 100) + "%", background: kit, transition: "width 0.5s linear" }} />
        </div>
        {isCoach ? (
          <div className="mt-4 flex items-center justify-center gap-3">
            <button onClick={() => nudgeTimer(-60)} className="rounded-full px-3 py-2 text-sm" style={{ border: "1px solid " + P.hair, fontWeight: 700 }}>−1'</button>
            <button
              onClick={toggleTimer}
              className="flex items-center justify-center rounded-full"
              style={{ width: 64, height: 64, background: kit, color: kitText, boxShadow: "0 6px 16px rgba(23,33,27,0.25)" }}
            >
              {timer.running ? <Pause size={26} /> : <Play size={26} style={{ marginLeft: 3 }} />}
            </button>
            <button onClick={() => nudgeTimer(60)} className="rounded-full px-3 py-2 text-sm" style={{ border: "1px solid " + P.hair, fontWeight: 700 }}>+1'</button>
            <button onClick={resetTimer} className="flex items-center justify-center rounded-full" style={{ width: 40, height: 40, border: "1px solid " + P.hair, color: P.dim }}>
              <RotateCcw size={17} />
            </button>
          </div>
        ) : (
          <div className="mt-2 text-xs" style={{ color: P.dim }}>The coach runs the clock — this view follows their plan.</div>
        )}
      </Card>

      {isFT ? (
        <Card className="p-5 text-center">
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 26 }}>THAT'S FULL TIME</div>
          <div className="mt-1 text-sm" style={{ color: P.dim }}>{isCoach ? "Nice one, coach. Check the Time tab to see how the minutes landed." : "Nice one — thanks for cheering them on!"}</div>
        </Card>
      ) : (
        <>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <Eyebrow>{round1(boundary) >= format.gameLength ? "Runs to full time" : "Next change at " + fmtMin(boundary) + "'"}</Eyebrow>
              <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22 }}>{fmtClock(countdown)}</span>
            </div>
            {boundaryTag && (
              <div className="mt-1 text-xs" style={{ color: P.warn, fontWeight: 700 }}>
                {boundaryTag === "HT" ? "Half-time break" : "Break — " + boundaryTag}
              </div>
            )}
            {nextDiff && (nextDiff.on.length > 0 || nextDiff.off.length > 0) ? (
              <div className="mt-2 flex flex-col gap-1 text-sm">
                <div className="flex items-start gap-2">
                  <span className="rounded px-2 text-xs" style={{ background: P.on, color: "#fff", fontWeight: 800, paddingTop: 2, paddingBottom: 2 }}>ON</span>
                  <span style={{ fontWeight: 600 }}>{nextDiff.on.map((id) => playersById[id] && playersById[id].name).filter(Boolean).join(", ") || "—"}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="rounded px-2 text-xs" style={{ background: P.off, color: "#fff", fontWeight: 800, paddingTop: 2, paddingBottom: 2 }}>OFF</span>
                  <span style={{ fontWeight: 600, color: P.dim }}>{nextDiff.off.map((id) => playersById[id] && playersById[id].name).filter(Boolean).join(", ") || "—"}</span>
                </div>
              </div>
            ) : (
              <div className="mt-1 text-xs" style={{ color: P.dim }}>{nextIdx < segments.length ? "No changes planned at this one." : "No more planned changes."}</div>
            )}
          </Card>

          <Card className="p-4">
            <Eyebrow>On the pitch now</Eyebrow>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              {positions.map((pos) => {
                const pl = liveAssign[pos.key] ? playersById[liveAssign[pos.key]] : null;
                return (
                  <div key={pos.key} className="flex items-center gap-2 text-sm">
                    <span className="w-9 shrink-0 text-xs" style={{ color: pos.gk ? "#A8831B" : P.dim, fontWeight: 700 }}>{pos.label}</span>
                    <span className="truncate" style={{ fontWeight: 600, color: pl ? P.ink : P.faint }}>{pl ? pl.name : "—"}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 text-xs" style={{ color: P.dim }}>
              <b>Bench:</b> {liveBench.map((p) => p.name.split(" ")[0]).join(", ") || "—"}
            </div>
          </Card>
        </>
      )}
    </div>
  );

  /* --------------------------- assignment sheet --------------------------- */

  const sheetPos = sheet ? positions.find((p) => p.key === sheet.posKey) : null;
  const sheetOccupantId = sheetPos ? curAssign[sheetPos.key] : null;
  const sheetBench = sheetPos
    ? roster
        .filter((p) => p.available && !Object.values(curAssign).includes(p.id))
        .sort((a, b) => (minutes[a.id] || 0) - (minutes[b.id] || 0) || a.name.localeCompare(b.name))
    : [];
  const sheetOnField = sheetPos
    ? roster.filter((p) => p.available && Object.values(curAssign).includes(p.id) && curAssign[sheetPos.key] !== p.id)
    : [];
  const posOfPlayer = (id) => {
    const k = Object.keys(curAssign).find((key) => curAssign[key] === id);
    const pos = k ? positions.find((q) => q.key === k) : null;
    return pos ? pos.label : "";
  };
  const pickPlayer = (id) => {
    if (!sheetPos) return;
    assignPlayer(segIdx, sheetPos.key, id, sheetAll);
    setSheet(null);
  };

  const SheetUI = sheet && sheetPos && (
    <div className="fixed inset-0 z-50" onClick={() => setSheet(null)}>
      <div className="absolute inset-0" style={{ background: "rgba(23,33,27,0.45)" }} />
      <div
        className="absolute bottom-0 w-full max-w-md overflow-y-auto rounded-t-3xl"
        style={{ left: "50%", transform: "translateX(-50%)", background: P.card, maxHeight: "72vh", animation: "mdSlideUp 0.18s ease-out" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between px-4 pb-2 pt-4" style={{ background: P.card, borderBottom: "1px solid " + P.soft }}>
          <div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22 }}>
              {sheetPos.label} <span style={{ color: P.dim, fontSize: 15, fontWeight: 600 }}>· block {segIdx + 1} · {fmtRange(curSeg.start, curSeg.end)}</span>
            </div>
            <button onClick={() => setSheetAll(!sheetAll)} className="mt-1 inline-flex items-center gap-2 text-xs" style={{ color: P.dim, fontWeight: 600 }}>
              <span
                className="flex items-center justify-center rounded"
                style={{ width: 16, height: 16, border: "1.5px solid " + (sheetAll ? kit : P.faint), background: sheetAll ? kit : "transparent" }}
              >
                {sheetAll && <Check size={11} color={kitText} />}
              </span>
              Put them here for every block (whole game)
            </button>
          </div>
          <button onClick={() => setSheet(null)} className="flex items-center justify-center rounded-full" style={{ width: 32, height: 32, background: P.soft }}>
            <X size={17} />
          </button>
        </div>

        <div className="px-3 pb-6 pt-2">
          {sheetOccupantId && (
            <button onClick={() => pickPlayer(null)} className="mb-1 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left" style={{ border: "1px dashed " + P.hair }}>
              <span className="flex items-center justify-center rounded-full" style={{ width: 34, height: 34, background: P.soft, color: P.dim }}><X size={16} /></span>
              <span className="text-sm" style={{ fontWeight: 600, color: P.dim }}>Empty this spot{sheetAll ? " (every block)" : ""}</span>
            </button>
          )}

          <div className="mt-2 px-2 text-xs uppercase" style={{ color: P.faint, letterSpacing: 1.2, fontWeight: 700 }}>From the bench</div>
          {sheetBench.length === 0 && <div className="px-2 py-2 text-sm" style={{ color: P.dim }}>Nobody spare this block.</div>}
          {sheetBench.map((p) => (
            <button key={p.id} onClick={() => pickPlayer(p.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left" style={{ borderBottom: "1px solid " + P.soft }}>
              {renderDisc(p, 34, sheetPos.gk)}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm" style={{ fontWeight: 600 }}>{p.name}{p.noReply && <NoReplyTag />}</span>
                <span className="block text-xs" style={{ color: P.dim }}>{fmtMin(minutes[p.id] || 0)}' planned so far</span>
              </span>
              {sheetOccupantId && <span className="text-xs" style={{ color: P.dim }}>replaces {playersById[sheetOccupantId] ? playersById[sheetOccupantId].name.split(" ")[0] : ""}</span>}
            </button>
          ))}

          {sheetOnField.length > 0 && (
            <>
              <div className="mt-3 px-2 text-xs uppercase" style={{ color: P.faint, letterSpacing: 1.2, fontWeight: 700 }}>On the pitch — tap to swap</div>
              {sheetOnField.map((p) => (
                <button key={p.id} onClick={() => pickPlayer(p.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left" style={{ borderBottom: "1px solid " + P.soft }}>
                  {renderDisc(p, 34, false)}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm" style={{ fontWeight: 600 }}>{p.name}</span>
                    <span className="block text-xs" style={{ color: P.dim }}>currently {posOfPlayer(p.id)} · {fmtMin(minutes[p.id] || 0)}'</span>
                  </span>
                  <span className="rounded-full px-2 py-1 text-xs" style={{ background: P.soft, color: P.dim, fontWeight: 700 }}>SWAP</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );

  /* --------------------------------- shell -------------------------------- */

  const TABS = isCoach
    ? [
        { id: "plan", label: "Plan", icon: ClipboardList },
        { id: "time", label: "Time", icon: BarChart3 },
        { id: "game", label: "Game", icon: Timer },
        { id: "format", label: "Format", icon: Settings }
      ]
    : [];
  const tabLabel = { plan: "Lineup & subs", time: "Playing time", game: "Game day", format: "Match format" }[view];

  return (
    <div className="mdp" style={{ position: "fixed", inset: 0, zIndex: 300, overflowY: "auto", background: P.paper, fontFamily: BODY, color: P.ink }}>
      <style>{MDP_CSS}</style>

      <div className="relative mx-auto w-full max-w-md" style={{ minHeight: "100%", paddingBottom: isCoach ? 92 : 24 }}>
        <div className="sticky top-0 z-20 flex items-center justify-between px-4 py-3" style={{ background: "rgba(242,244,238,0.92)", backdropFilter: "blur(6px)", borderBottom: "1px solid " + P.hair }}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-md" style={{ width: 10, height: 26, background: kit }} />
            <div className="min-w-0">
              <div className="truncate uppercase" style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 21, lineHeight: 1, letterSpacing: 0.6 }}>
                {teamName}
              </div>
              <div className="truncate text-xs" style={{ color: P.dim, marginTop: 1 }}>
                Round {fixture.round} {fixture.homeAway === "H" ? "vs" : "@"} {fixture.opponent} · {fmtDate(fixture.dateISO)}{tabLabel ? " · " + tabLabel : ""}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {savedTick > 0 && (
              <span key={savedTick} className="inline-flex items-center gap-1 text-xs" style={{ color: P.on, fontWeight: 600, animation: "mdFadeAway 2.2s forwards" }}>
                <Check size={13} /> Saved
              </span>
            )}
            <button onClick={close} aria-label="Close" className="flex items-center justify-center rounded-full" style={{ width: 32, height: 32, background: P.soft }}>
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="px-3 pt-3">
          {view === "plan" && isCoach && PlanView}
          {view === "time" && isCoach && TimeView}
          {view === "game" && GameView}
          {view === "format" && isCoach && FormatView}
        </div>

        {isCoach && (
          <div className="fixed bottom-0 z-30 w-full max-w-md" style={{ left: "50%", transform: "translateX(-50%)" }}>
            <div className="grid grid-cols-4" style={{ background: P.card, borderTop: "1px solid " + P.hair, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = view === t.id;
                return (
                  <button key={t.id} onClick={() => setView(t.id)} className="flex flex-col items-center gap-1 py-2 select-none">
                    <Icon size={20} color={active ? kit : P.faint} strokeWidth={active ? 2.4 : 2} />
                    <span className="text-xs" style={{ color: active ? P.ink : P.faint, fontWeight: active ? 700 : 500 }}>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {isCoach && SheetUI}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Scoped styles. The planner was designed against utility classes; rather
   than adding a CSS framework to the site, the (bounded) set it uses is
   defined here under the .mdp root, plus a mini reset so native button/input
   chrome doesn't leak into the tactics-board look.
--------------------------------------------------------------------------- */
const MDP_CSS = `
@keyframes mdSlideUp { from { transform: translate(-50%, 24px); opacity: 0.6; } to { transform: translate(-50%, 0); opacity: 1; } }
@keyframes mdFadeAway { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }
.mdp, .mdp * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
.mdp button { background: none; border: none; padding: 0; margin: 0; font: inherit; color: inherit; text-align: inherit; cursor: pointer; }
.mdp input, .mdp select { font: inherit; }
.mdp input:focus, .mdp button:focus-visible { outline: 2px solid rgba(23,33,27,0.35); outline-offset: 1px; }
.mdp input[type=number]::-webkit-outer-spin-button, .mdp input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.mdp input[type=number] { -moz-appearance: textfield; }
.mdp ::-webkit-scrollbar { height: 6px; width: 6px; }
.mdp ::-webkit-scrollbar-thumb { background: #C9D2C4; border-radius: 3px; }
.mdp .flex{display:flex} .mdp .inline-flex{display:inline-flex} .mdp .grid{display:grid} .mdp .block{display:block}
.mdp .relative{position:relative} .mdp .absolute{position:absolute} .mdp .fixed{position:fixed} .mdp .sticky{position:sticky}
.mdp .inset-0{top:0;right:0;bottom:0;left:0} .mdp .top-0{top:0} .mdp .bottom-0{bottom:0}
.mdp .z-20{z-index:20} .mdp .z-30{z-index:30} .mdp .z-50{z-index:50}
.mdp .flex-col{flex-direction:column} .mdp .flex-wrap{flex-wrap:wrap} .mdp .flex-1{flex:1 1 0%}
.mdp .items-center{align-items:center} .mdp .items-start{align-items:flex-start} .mdp .items-end{align-items:flex-end}
.mdp .justify-between{justify-content:space-between} .mdp .justify-center{justify-content:center}
.mdp .shrink-0{flex-shrink:0} .mdp .select-none{user-select:none;-webkit-user-select:none}
.mdp .grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))} .mdp .grid-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}
.mdp .gap-px{gap:1px} .mdp .gap-1{gap:4px} .mdp .gap-2{gap:8px} .mdp .gap-3{gap:12px}
.mdp .gap-x-3{column-gap:12px} .mdp .gap-y-1{row-gap:4px}
.mdp .p-2{padding:8px} .mdp .p-3{padding:12px} .mdp .p-4{padding:16px} .mdp .p-5{padding:20px} .mdp .p-6{padding:24px}
.mdp .px-1{padding-left:4px;padding-right:4px} .mdp .px-2{padding-left:8px;padding-right:8px} .mdp .px-3{padding-left:12px;padding-right:12px} .mdp .px-4{padding-left:16px;padding-right:16px}
.mdp .py-1{padding-top:4px;padding-bottom:4px} .mdp .py-2{padding-top:8px;padding-bottom:8px} .mdp .py-3{padding-top:12px;padding-bottom:12px}
.mdp .pt-2{padding-top:8px} .mdp .pt-3{padding-top:12px} .mdp .pt-4{padding-top:16px}
.mdp .pb-1{padding-bottom:4px} .mdp .pb-2{padding-bottom:8px} .mdp .pb-6{padding-bottom:24px}
.mdp .pl-1{padding-left:4px} .mdp .pl-3{padding-left:12px} .mdp .pr-1{padding-right:4px} .mdp .pr-3{padding-right:12px}
.mdp .mt-px{margin-top:1px} .mdp .mt-1{margin-top:4px} .mdp .mt-2{margin-top:8px} .mdp .mt-3{margin-top:12px} .mdp .mt-4{margin-top:16px}
.mdp .mb-1{margin-bottom:4px} .mdp .mb-3{margin-bottom:12px} .mdp .ml-1{margin-left:4px}
.mdp .mx-auto{margin-left:auto;margin-right:auto} .mdp .-mx-1{margin-left:-4px;margin-right:-4px}
.mdp .w-full{width:100%} .mdp .w-9{width:36px} .mdp .w-14{width:56px} .mdp .w-20{width:80px} .mdp .w-36{width:144px}
.mdp .max-w-md{max-width:448px} .mdp .max-w-full{max-width:100%} .mdp .min-w-0{min-width:0}
.mdp .h-2{height:8px} .mdp .h-6{height:24px} .mdp .h-full{height:100%}
.mdp .text-xs{font-size:12px;line-height:16px} .mdp .text-sm{font-size:14px;line-height:20px} .mdp .text-base{font-size:16px;line-height:24px}
.mdp .text-left{text-align:left} .mdp .text-right{text-align:right} .mdp .text-center{text-align:center}
.mdp .uppercase{text-transform:uppercase}
.mdp .truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mdp .rounded{border-radius:4px} .mdp .rounded-md{border-radius:6px} .mdp .rounded-lg{border-radius:8px} .mdp .rounded-xl{border-radius:12px} .mdp .rounded-2xl{border-radius:16px} .mdp .rounded-3xl{border-radius:24px} .mdp .rounded-full{border-radius:9999px}
.mdp .rounded-t-3xl{border-top-left-radius:24px;border-top-right-radius:24px}
.mdp .overflow-hidden{overflow:hidden} .mdp .overflow-x-auto{overflow-x:auto} .mdp .overflow-y-auto{overflow-y:auto}
.mdp .transition{transition:all .15s ease}
.mdp .rdot{position:absolute;width:9px;height:9px;border-radius:50%;background:#E5484D;border:2px solid #fff;top:-3px;right:-3px}
`;
