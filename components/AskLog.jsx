"use client";
// Club admin → Questions (super admin): every question asked on the teams'
// Ask tabs, newest first, with who asked it, the team, when, and how it was
// answered (the assistant's answer under it, to open). The club's own name
// for each person comes with the list (/api/ask-log), with their email under
// it, and what they were on the team when they asked ("Parent of Sam").
import { useState, useEffect, useCallback } from "react";
import { askerWords, HOW_WORDS, ASK_LOG_MAX } from "@/lib/askLog";

const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
// "Sat 28 Nov, 3:05 pm" in Brisbane, where the club is.
export function whenAsked(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod || "").toLowerCase()}`;
}

const CSS = `
.al-q{font-weight:700;color:var(--ink);font-size:15px;line-height:1.35;overflow-wrap:anywhere;}
.al-who{margin-top:4px;font-size:13px;color:var(--ink);}
.al-meta{margin-top:2px;font-size:12px;color:var(--muted);overflow-wrap:anywhere;}
.al-ans{margin-top:6px;font-size:13px;color:var(--muted);}
.al-ans summary{cursor:pointer;font-weight:700;}
.al-ans div{margin-top:4px;white-space:pre-wrap;color:var(--ink);overflow-wrap:anywhere;}
.al-row{display:block;padding:12px 0;border-bottom:1px solid var(--line);}
.al-row:last-child{border-bottom:none;}
`;

export default function AskLog() {
  const [team, setTeam] = useState("");
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(async (slug) => {
    setErr("");
    try {
      const r = await fetch(`/api/ask-log${slug ? `?team=${encodeURIComponent(slug)}` : ""}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "The questions couldn't be loaded.");
      setRep(j);
    } catch (e) { setErr(String(e.message || e)); }
  }, []);
  useEffect(() => { load(team); }, [load, team]);

  const questions = rep?.questions || [];
  const people = new Set(questions.map((q) => q.who?.email || "code")).size;
  return (
    <section className="adm-card" aria-labelledby="adm-asklog">
      <style>{CSS}</style>
      <h2 className="adm-label" id="adm-asklog">Questions asked</h2>
      <div className="adm-body">
        Every question asked on a team's Ask tab, newest first, with who asked it. People see on the Ask tab that the
        club can see their questions. Each team keeps its last {ASK_LOG_MAX}.
      </div>
      <div className="adm-form">
        <select className="adm-inp auto" aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">All teams</option>
          {(rep?.teams || []).map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
        </select>
        {rep && <span className="adm-note" role="status">{questions.length ? `${plural(questions.length, "question")} from ${people === 1 ? "1 person" : `${people} people`}` : ""}</span>}
      </div>
      {err && <div className="adm-msg err" role="alert">{err}</div>}
      {!rep && !err && <div className="adm-empty">Loading the questions…</div>}
      {rep && !questions.length && <div className="adm-empty">No questions asked yet{team ? " on this team" : ""}.</div>}
      {questions.length > 0 && (
        <div className="adm-rows" role="list" aria-label="Questions asked">
          {questions.map((q, i) => {
            const who = askerWords(q.who, q.name);
            return (
              <div className="al-row" role="listitem" key={`${q.team}-${q.at}-${i}`}>
                <div className="al-q">{q.q}</div>
                <div className="al-who">{who.line}</div>
                <div className="al-meta">{[who.email, q.teamName, whenAsked(q.at), HOW_WORDS[q.how]].filter(Boolean).join(" · ")}</div>
                {q.a && (
                  <details className="al-ans">
                    <summary>The answer</summary>
                    <div>{q.a}</div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
