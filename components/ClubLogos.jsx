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
//
// For a club with no logo, the admin can add the club: its name and a logo
// picked from its own website, which the server reads for the images that may
// be the logo. The logo is held for the club, not a team: every opposition
// team whose name has all the club's words is shown it, as the built-in
// crests are matched, and the admin sees which teams that is before saving.
import { useState, useEffect, useCallback, useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { fetchDribl, fetchDriblClubs, driblClubsUrl } from "@/lib/dribl";
import Crest from "@/components/Crest";
import { crestFor } from "@/lib/clubs";
import { clubWords, namedCovers, guessClubName } from "@/lib/clubLogos";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const KIND = { club: "Club logo", team: "The team's own logo", game: "Logo on its games" };
const PICK = { logo: "a logo", "site icon": "the site's icon", "share image": "the picture the site shares", image: "the image" };
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const andList = (names) => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// Adding a club for a team with no logo: the club's name (first guessed from
// the team's), the teams that name covers, the club's website read for its
// logo, and the logo picked from what was found.
function AddClub({ team, opponents, busy, post, onDone, onCancel }) {
  const [name, setName] = useState(() => guessClubName(team.name));
  const [link, setLink] = useState("");
  const [found, setFound] = useState(null); // { site, candidates }
  const [picked, setPicked] = useState("");
  const [broken, setBroken] = useState(() => new Set());
  const [err, setErr] = useState("");
  const [reading, setReading] = useState(false);
  const words = useMemo(() => clubWords(name), [name]);
  const covers = useMemo(() => opponents.filter((o) => o.shown !== "built-in" && namedCovers(words, o.name)).map((o) => o.name), [opponents, words]);
  const read = async () => {
    setErr(""); setFound(null); setPicked(""); setBroken(new Set()); setReading(true);
    try {
      const r = await fetch("/api/club-logos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "site", url: link }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "The site couldn't be read.");
      setFound(j);
      if (j.candidates?.length === 1) setPicked(j.candidates[0].url);
    } catch (e) { setErr(String(e.message || e)); }
    setReading(false);
  };
  const save = async () => {
    setErr("");
    try {
      await post({ action: "club", name, logo: picked, site: found?.site || "" });
      onDone(`${name.trim()} added: its logo now shows for ${plural(covers.length, "team")}.`);
    } catch (e) { setErr(String(e.message || e)); }
  };
  const shown = (found?.candidates || []).filter((c) => !broken.has(c.url));
  return (
    <div className="adm-club">
      <label className="adm-fl" htmlFor={`club-${team.ref}`}>Club</label>
      <input id={`club-${team.ref}`} className="adm-inp" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      <div className="adm-note" role="status">{covers.length
        ? `Covers ${plural(covers.length, "team")}: ${andList(covers.slice(0, 6))}${covers.length > 6 ? ` and ${covers.length - 6} more` : ""}. Every team whose name has the words ${andList(words.map((w) => `"${w}"`))} gets this logo, the ones still to come too.`
        : "No opposition team's name has all of these words. Shorten the club's name to the words its teams share."}</div>
      <label className="adm-fl" htmlFor={`site-${team.ref}`} style={{ marginTop: 12 }}>Club website or logo link</label>
      <div className="adm-form" style={{ marginTop: 0 }}>
        <input id={`site-${team.ref}`} className="adm-inp" style={{ flex: 1, minWidth: 0 }} inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false}
          placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && link.trim()) read(); }} />
        <button type="button" className="adm-btn soft" disabled={!link.trim() || reading || !!busy} onClick={read}>{reading ? "Reading…" : "Find logos"}</button>
      </div>
      {found && (shown.length ? (
        <>
          <div className="adm-note">Pick the club's logo{found.site ? ` from ${hostOf(found.site)}` : ""}:</div>
          <div className="adm-picks" role="group" aria-label="Logos found on the club's site">
            {shown.map((c, i) => (
              <button type="button" key={c.url} className="adm-pick" aria-pressed={picked === c.url} aria-label={`Logo ${i + 1} of ${shown.length}: ${PICK[c.kind] || "an image"}`} onClick={() => setPicked(c.url)}>
                <img src={c.url} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken((b) => new Set(b).add(c.url))} />
              </button>
            ))}
          </div>
        </>
      ) : <div className="adm-msg warn">None of the images on that page would load. Paste a link to the logo image itself.</div>)}
      {err && <div className="adm-msg err" role="alert">{err}</div>}
      <div className="adm-form">
        <button type="button" className="adm-btn" disabled={!picked || !covers.length || !!busy} onClick={save}>Use this logo for {name.trim() || "the club"}</button>
        <button type="button" className="adm-btn soft" onClick={onCancel}>Cancel</button>
      </div>
      <div className="adm-note">The logo is shown from the club's own site, as Squadi's are: no copy of it is kept here.</div>
    </div>
  );
}

export default function ClubLogos() {
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [said, setSaid] = useState("");
  const [adding, setAdding] = useState(""); // the ref of the team a club is being added for

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
  const removeClub = async (club) => {
    setErr(""); setSaid(""); setBusy("Saving…");
    try { await post({ action: "unclub", key: club.key }); setSaid(`${club.name} taken out: its teams are back to what the draws show.`); } catch (e) { setErr(String(e.message || e)); }
    setBusy("");
  };
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
      {(o.shown === "missing" || o.shown === "hidden") && adding !== o.ref && (
        <button type="button" className="adm-btn soft sm" disabled={!!busy} onClick={() => { setAdding(o.ref); setSaid(""); }}>Add club logo</button>
      )}
      {adding === o.ref && (
        <AddClub team={o} opponents={rep?.opponents || []} busy={busy} post={post}
          onDone={(msg) => { setAdding(""); setSaid(msg); }} onCancel={() => setAdding("")} />
      )}
    </div>
  );

  return (
    <>
      {err && <div className="adm-msg err" role="alert">{err}</div>}
      {rep && (
        <section className="adm-card" aria-labelledby="adm-logos">
          <h2 className="adm-label" id="adm-logos">Opposition logos</h2>
          <div className="adm-body">
            <b>{plural(c.opponents || 0, "opposition team")}</b>: {c.builtIn || 0} with a built-in crest, {c.added ? `${c.added} with a club logo you added, ` : ""}{c.found || 0} with a logo found on Squadi or Dribl, {c.missing || 0} still without one{c.hidden ? `, ${c.hidden} hidden` : ""}.
          </div>
          <div className="adm-note">
            {plural(c.newClubs || 0, "club")} found that the built-in crests do not cover, with {plural(c.newLogos || 0, "logo")} between them. {plural(c.duplicatesAvoided || 0, "team name")} matched to a club already known instead of becoming a new club. Found on Squadi or Dribl, two teams are only the same club when Squadi or Dribl says so, never because their names look alike. A club you add covers the teams whose names have its words.
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
          <div className="adm-note">Add the club's logo from its own website: it's held for the club, so all of its teams get it.</div>
          <div className="adm-rows">{of("missing").map((o) => row(o))}</div>
        </section>
      )}
      {rep && (rep.named || []).length > 0 && (
        <section className="adm-card" aria-labelledby="adm-logos-added">
          <h2 className="adm-label" id="adm-logos-added">Club logos you added</h2>
          <div className="adm-rows">{rep.named.map((club) => (
            <div className="adm-row" key={club.key}>
              <Crest src={club.logo} drawn name={club.name} className="adm-crest" discClass="adm-crest ph" />
              <div className="adm-row-main">
                {club.name}
                <div className="adm-row-sub">{club.site ? `From ${hostOf(club.site)}, ` : ""}{club.teams ? `shown for ${plural(club.teams, "team")}` : "no opposition team's name has its words yet"}</div>
              </div>
              <button type="button" className="adm-btn soft sm" disabled={!!busy} onClick={() => removeClub(club)}>Remove</button>
            </div>
          ))}</div>
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
