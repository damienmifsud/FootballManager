"use client";
// The super admin's Logos section at /admin: the club logo library, as it
// stands for every opposition team the club's teams have met or will meet.
// The built-in crests come first and are never changed here. For any other
// team the library shows the logo Squadi or Dribl gives it (lib/clubLogos.js),
// or the team's initials when there is none.
//
// Find missing logos reads every team's Squadi draws again on the server, and
// every Dribl draw (with Dribl's club list) here in this browser, since Dribl
// turns servers away. Neither changes a game: they only tell the library what
// the draws show. Hide keeps a found logo from being shown, whatever the
// draws say later; Show undoes that.
import { useState, useEffect, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { fetchDribl, fetchDriblClubs, driblClubsUrl } from "@/lib/dribl";
import Crest from "@/components/Crest";
import { crestFor } from "@/lib/clubs";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const KIND = { club: "Club logo", team: "The team's own logo", game: "Logo on its games" };

export default function ClubLogos() {
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [said, setSaid] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/club-logos", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "load failed");
      setRep(j);
    } catch (e) { setErr(String(e.message || e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const post = async (body) => {
    const r = await fetch("/api/club-logos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "save failed");
    setRep(j);
    return j;
  };

  const findMissing = async () => {
    setErr(""); setSaid(""); setBusy("Reading Squadi…");
    try {
      const sq = await post({ action: "refresh" });
      const lines = [`Squadi: ${plural(sq.read, "draw")} read${sq.failed ? `, ${sq.failed} could not be` : ""}.`];
      const sources = Array.isArray(sq.dribl) ? sq.dribl : [];
      if (sources.length) {
        setBusy("Reading Dribl in this browser…");
        const draws = [], clubs = [], lists = new Set();
        let failed = 0;
        for (const s of sources) {
          try { draws.push({ records: await fetchDribl({ url: s.url, team: s.ourTeam }) }); } catch { failed++; }
          const list = driblClubsUrl(s.url);
          if (list && !lists.has(list)) {
            lists.add(list);
            try { clubs.push(...(await fetchDriblClubs({ url: s.url })).clubs); } catch {}
          }
        }
        if (draws.length || clubs.length) await post({ action: "dribl", draws, clubs });
        lines.push(`Dribl: ${plural(draws.length, "draw")} read${failed ? `, ${failed} could not be` : ""}${clubs.length ? `, and a club list of ${plural(clubs.length, "club")}` : ""}.`);
      }
      setSaid(lines.join(" "));
    } catch (e) { setErr(String(e.message || e)); }
    setBusy("");
  };

  // A club's logo is hidden for every team of the club; a team's own, or the
  // one on its games, for that team only. Show clears either.
  const choose = async (o, action) => {
    setErr(""); setBusy("Saving…");
    try { await post({ action, ref: o.ref, ...(o.club ? { club: o.club } : {}), ...(o.kind ? { kind: o.kind } : {}) }); } catch (e) { setErr(String(e.message || e)); }
    setBusy("");
  };

  if (!rep && !err) return <div className="adm-card quiet">Loading the logo library…</div>;
  const c = rep?.counts || {};
  const of = (shown) => (rep?.opponents || []).filter((o) => o.shown === shown);
  const row = (o, action) => (
    <div className="adm-row" key={o.ref}>
      <Crest src={o.shown === "found" ? o.logo : null} drawn={o.shown === "found"} name={o.name} className="adm-crest" discClass="adm-crest ph" />
      <div className="adm-row-main">
        {o.name}
        <div className="adm-row-sub">
          {o.shown === "found" ? `${KIND[o.kind] || "Logo"} from ${o.from}` : o.shown === "hidden" ? "Hidden: the initials are shown" : `On ${o.provider === "dribl" ? "Dribl" : "Squadi"}: no logo yet, so the initials are shown`}
        </div>
      </div>
      {action && <button type="button" className="adm-btn soft sm" disabled={!!busy} onClick={() => choose(o, action)}>{action === "hide" ? "Hide" : "Show"}</button>}
    </div>
  );

  return (
    <>
      {err && <div className="adm-msg err" role="alert">{err}</div>}
      {rep && (
        <section className="adm-card" aria-labelledby="adm-logos">
          <h2 className="adm-label" id="adm-logos">Opposition logos</h2>
          <div className="adm-body">
            <b>{plural(c.opponents || 0, "opposition team")}</b>: {c.builtIn || 0} with a built-in crest, {c.found || 0} with a logo found on Squadi or Dribl, {c.missing || 0} still without one{c.hidden ? `, ${c.hidden} hidden` : ""}.
          </div>
          <div className="adm-note">
            {plural(c.newClubs || 0, "club")} found that the built-in crests do not cover, with {plural(c.newLogos || 0, "logo")} between them. {plural(c.duplicatesAvoided || 0, "team name")} matched to a club already known instead of becoming a new club. Two teams are only the same club when Squadi or Dribl says so, never because their names look alike.
          </div>
          <div className="adm-form">
            <button type="button" className="adm-btn" disabled={!!busy} onClick={findMissing}>{busy || "Find missing logos"}</button>
          </div>
          {said && <div className="adm-msg ok" role="status">{said}</div>}
          <div className="adm-note">
            Reads every team's Squadi draws again, and its Dribl draws in this browser (Dribl turns servers away). No game is changed. A logo found is shown from Squadi's or Dribl's own site: no copy of it is kept here.
          </div>
        </section>
      )}
      {rep && of("missing").length > 0 && (
        <section className="adm-card" aria-labelledby="adm-logos-missing">
          <h2 className="adm-label" id="adm-logos-missing">Still without a logo</h2>
          <div className="adm-rows">{of("missing").map((o) => row(o))}</div>
        </section>
      )}
      {rep && of("found").length > 0 && (
        <section className="adm-card" aria-labelledby="adm-logos-found">
          <h2 className="adm-label" id="adm-logos-found">Logos found</h2>
          <div className="adm-rows">{of("found").map((o) => row(o, "hide"))}</div>
        </section>
      )}
      {rep && of("hidden").length > 0 && (
        <section className="adm-card" aria-labelledby="adm-logos-hidden">
          <h2 className="adm-label" id="adm-logos-hidden">Hidden</h2>
          <div className="adm-rows">{of("hidden").map((o) => row(o, "show"))}</div>
        </section>
      )}
      {rep && of("built-in").length > 0 && (
        <details className="adm-card adm-fold">
          <summary>
            <h2 className="adm-label">Built-in crests</h2>
            <span className="hint">{plural(of("built-in").length, "team")}</span>
            <ChevronRight className="chev" size={18} aria-hidden="true" />
          </summary>
          <div className="adm-fold-body">
          <div className="adm-note">These teams keep the club's own crest, whatever a draw shows.</div>
          <div className="adm-rows">{of("built-in").map((o) => (
            <div className="adm-row" key={o.ref}>
              <Crest src={crestFor(o.name)} name={o.name} className="adm-crest" discClass="adm-crest ph" />
              <div className="adm-row-main">{o.name}</div>
            </div>
          ))}</div>
          </div>
        </details>
      )}
    </>
  );
}
