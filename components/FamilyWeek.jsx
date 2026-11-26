"use client";
// Both teams together (My teams, account mode): for a family on two or more
// teams, the next two weeks across all of them in one list, with a reply
// control for each of the family's own players. A parent with a child in each
// of two teams answers both from here; someone who also plays answers for
// themselves as "You".
//
// The choice between this and one team at a time is theirs and is remembered
// (the teams_view cookie). The team cards below always open a single team.
//
// Reads /api/family, which gives only the schedule every parent on a team
// already sees and this family's own replies. A reply is one POST to
// /api/rsvp naming its team; the route answers it as the family there and
// refuses anything else, whatever this page offers.
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Trophy, ClipboardList, Star, Medal, Check, X } from "lucide-react";
import { initials } from "@/lib/dashboardData";
import { shortTeamNames } from "@/lib/people";

const MAX_AGE = 60 * 60 * 24 * 180; // 180 days, like the team and role cookies
const readChoice = () => {
  try { return /(?:^|;\s*)teams_view=separate(?:;|$)/.test(document.cookie) ? "separate" : "together"; } catch { return "together"; }
};
const saveChoice = (value) => { document.cookie = `teams_view=${value}; path=/; max-age=${MAX_AGE}; samesite=lax`; };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateOf = (iso) => new Date(iso + "T00:00:00");
// "Sat 28 Nov"
export const shortDay = (iso) => { const d = dateOf(iso); return `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
// "Today" / "Tomorrow" for the first two days of the list, else nothing.
const nearDay = (iso, todayISO) => {
  const gap = Math.round((dateOf(iso) - dateOf(todayISO)) / 86400000);
  return gap === 0 ? "Today" : gap === 1 ? "Tomorrow" : "";
};
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";
const ICONS = { game: Trophy, training: ClipboardList, event: Star, carnival: Medal };
const whenText = (item) => (item.time ? (item.endTime ? `${item.time}–${item.endTime}` : item.time) : "Time to come");
const statusWord = (status) => (status === "in" ? "In" : status === "out" ? "Out" : "Reply");

export default function FamilyWeek() {
  const [choice, setChoice] = useState(null); // read from the cookie once on the client
  const [data, setData] = useState(null);     // /api/family
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);     // { item, reply } being answered
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheetErr, setSheetErr] = useState("");
  const [said, setSaid] = useState("");       // what just happened, said once
  const sheetRef = useRef(null);              // the open reply sheet
  const fromRef = useRef(null);               // the button it was opened from

  useEffect(() => { setChoice(readChoice()); }, []);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/family", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't load what is coming up.");
      setData(j); setErr("");
    } catch (e) { setErr(String(e.message || e)); }
  }, []);
  useEffect(() => { if (choice === "together") load(); }, [choice, load]);
  useEffect(() => {
    if (!said) return undefined;
    const t = setTimeout(() => setSaid(""), 2200);
    return () => clearTimeout(t);
  }, [said]);

  const choose = (value) => { saveChoice(value); setChoice(value); };
  const short = useMemo(() => shortTeamNames((data?.teams || []).map((t) => t.teamName)), [data]);
  // The list by day, in the order the route sends it.
  const days = useMemo(() => {
    const out = [];
    for (const item of data?.items || []) {
      const last = out[out.length - 1];
      if (last && last.iso === item.dateISO) last.items.push(item); else out.push({ iso: item.dateISO, items: [item] });
    }
    return out;
  }, [data]);
  const toGive = (data?.items || []).reduce((n, item) => n + item.replies.filter((r) => !r.status).length, 0);
  const asked = (data?.items || []).some((item) => item.replies.length > 0);
  const readOnly = !!data?.readOnly;

  const answer = (item, reply, from) => { fromRef.current = from || null; setOpen({ item, reply }); setNote(""); setSheetErr(""); };
  const close = () => { if (!busy) setOpen(null); };

  // The reply sheet is a modal dialog: focus moves into it when it opens and
  // goes back to the button it came from when it closes.
  const sheetOpen = !!open;
  useEffect(() => {
    if (!sheetOpen) return undefined;
    sheetRef.current?.focus();
    return () => { const from = fromRef.current; if (from && from.isConnected) from.focus(); };
  }, [sheetOpen]);
  // Escape closes it, and Tab stays inside it.
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") { if (!busy) setOpen(null); return; }
      if (e.key !== "Tab" || !sheetRef.current) return;
      const stops = [...sheetRef.current.querySelectorAll("button:not([disabled]), input")];
      if (!stops.length) return;
      const at = document.activeElement;
      if (e.shiftKey && (at === stops[0] || at === sheetRef.current)) { e.preventDefault(); stops[stops.length - 1].focus(); }
      else if (!e.shiftKey && at === stops[stops.length - 1]) { e.preventDefault(); stops[0].focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetOpen, busy]);
  const send = async (value) => {
    const { item, reply } = open;
    const status = reply.status === value ? null : value; // the one already chosen clears it
    setBusy(true); setSheetErr("");
    try {
      const r = await fetch("/api/rsvp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: item.kind, id: item.id, ...(item.kind === "session" ? { occ: item.occ } : {}),
          playerId: reply.playerId, status, ...(status === "out" ? { reason: note.trim() } : {}), teamSlug: item.teamSlug
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error && j.error !== "forbidden" ? j.error : "Couldn't save that reply. Try again.");
      const who = reply.isSelf ? "You're" : `${firstName(reply.name)}'s`;
      const day = DAYS[dateOf(item.dateISO).getDay()];
      setSaid(status === "in" ? `${who} in for ${day}` : status === "out" ? `${who} out for ${day}` : reply.isSelf ? "Your reply is cleared" : `${firstName(reply.name)}'s reply cleared`);
      setOpen(null);
      await load();
    } catch (e) { setSheetErr(String(e.message || e)); }
    setBusy(false);
  };

  if (!choice) return null;
  return (
    <section className="auth-week" aria-label="My teams together">
      <div className="auth-seg" role="group" aria-label="How to see my teams">
        <button type="button" className={choice === "together" ? "on" : ""} aria-pressed={choice === "together"} onClick={() => choose("together")}>Together</button>
        <button type="button" className={choice === "separate" ? "on" : ""} aria-pressed={choice === "separate"} onClick={() => choose("separate")}>One team at a time</button>
      </div>

      {choice === "separate" && <div className="auth-help auth-week-help">Open a team below. Together shows the next two weeks for all of them in one list.</div>}

      {choice === "together" && (<>
        <div className="auth-week-head">
          <span className="auth-label">Coming up</span>
          {data && asked && <span className="auth-week-count" role="status">{toGive === 0 ? "All replied" : `${toGive} ${toGive === 1 ? "reply" : "replies"} to give`}</span>}
        </div>
        {err && (
          <div className="auth-card">
            <div className="auth-err" role="alert" style={{ marginTop: 0 }}>{err}</div>
            <button type="button" className="auth-ghost" onClick={load}>Try again</button>
          </div>
        )}
        {!data && !err && <div className="auth-card auth-loading">Loading what is coming up…</div>}
        {data && days.length === 0 && <div className="auth-card auth-body">Nothing on in the next two weeks.</div>}
        {readOnly && days.length > 0 && <div className="auth-help auth-week-help">Read only while viewing as someone else.</div>}

        {days.map((day) => (
          <div className="auth-card auth-day" key={day.iso}>
            <div className="auth-day-head">
              {nearDay(day.iso, data.todayISO) && <span>{nearDay(day.iso, data.todayISO)}</span>}{shortDay(day.iso)}
            </div>
            {day.items.map((item) => {
              const Icon = ICONS[item.what] || Star;
              return (
                <div className="auth-ev" key={item.teamSlug + ":" + item.id + ":" + (item.occ || "")}>
                  <div className="auth-ev-top">
                    <span className={"auth-ev-ic " + item.what}><Icon size={16} aria-hidden="true" /></span>
                    <div className="auth-ev-body">
                      <div className="auth-ev-title">{item.title}</div>
                      <div className="auth-ev-meta"><b>{whenText(item)}</b>{item.place ? " · " + item.place : ""}</div>
                      <div className="auth-ev-tags">
                        <span className="auth-pill">{short(item.teamName)}</span>
                        {item.label && <span className="auth-ev-label">{item.label}</span>}
                        {item.cancelled && <span className="auth-pill cancelled">Cancelled</span>}
                      </div>
                    </div>
                  </div>
                  {item.replies.map((reply) => {
                    const who = reply.isSelf ? "You" : firstName(reply.name);
                    return (
                      <div className="auth-reply" key={reply.playerId}>
                        <span className="avatar" aria-hidden="true">{initials(reply.name)}</span>
                        <span className="who">{who}</span>
                        {readOnly
                          ? <span className={"auth-pill st" + (reply.status ? " " + reply.status : "")}>{reply.status ? statusWord(reply.status) : "No reply"}</span>
                          : <button type="button" className={"auth-rr" + (reply.status ? " " + reply.status : "")}
                              aria-label={`${reply.isSelf ? "Your reply" : `Reply for ${firstName(reply.name)}`}, ${item.title}, ${shortDay(item.dateISO)}: ${reply.status ? statusWord(reply.status) : "not given"}`}
                              onClick={(e) => answer(item, reply, e.currentTarget)}>{statusWord(reply.status)}</button>}
                      </div>
                    );
                  })}
                  {!item.cancelled && item.replies.length === 0 && <div className="auth-ev-note">No reply needed for this one.</div>}
                </div>
              );
            })}
          </div>
        ))}
      </>)}

      {open && (
        <div className="auth-ov" onClick={close}>
          <div className="auth-sheet" role="dialog" aria-modal="true" aria-labelledby="fw-sheet-title" tabIndex={-1} ref={sheetRef} onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <div className="auth-sheet-title" id="fw-sheet-title">{open.reply.isSelf ? "Your reply" : `Reply for ${firstName(open.reply.name)}`}</div>
            <div className="auth-sheet-sub">{[open.item.title, shortDay(open.item.dateISO), open.item.time, short(open.item.teamName)].filter(Boolean).join(" · ")}</div>
            <div className="auth-rs-grid">
              <button type="button" className={"auth-rs in" + (open.reply.status === "in" ? " sel" : "")} aria-pressed={open.reply.status === "in"} disabled={busy} onClick={() => send("in")}><Check size={18} aria-hidden="true" />In</button>
              <button type="button" className={"auth-rs out" + (open.reply.status === "out" ? " sel" : "")} aria-pressed={open.reply.status === "out"} disabled={busy} onClick={() => send("out")}><X size={18} aria-hidden="true" />Out</button>
            </div>
            {open.item.paired && <div className="auth-sheet-foot">Your reply covers both games this round.</div>}
            <input className="auth-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for coach (optional)" aria-label="Note for coach" />
            {sheetErr && <div className="auth-err" role="alert">{sheetErr}</div>}
            <div className="auth-sheet-foot">The coach sees replies straight away. You can change it any time before {open.item.kind === "game" ? "kick-off" : "it starts"}.</div>
            <button type="button" className="auth-ghost" disabled={busy} onClick={close}>Cancel</button>
          </div>
        </div>
      )}
      {said && <div className="auth-toast" role="status">{said}</div>}
    </section>
  );
}
