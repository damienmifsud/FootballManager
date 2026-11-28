"use client";
// The super admin's Logos section at /admin: the club logo library, as it
// stands for every opposition team the club's teams have met or will meet.
// The built-in crests come before anything found, and the crest files are
// never changed here. For any other team the library shows the logo Squadi or
// Dribl gives it (lib/clubLogos.js), or the team's initials when there is none.
//
// Find missing logos reads every team's Squadi draws again on the server, and
// every Dribl draw (with Dribl's club list) here in this browser, since Dribl
// turns servers away. Neither changes a game: they only tell the library what
// the draws show. Hide keeps a found logo from being shown, whatever the
// draws say later; Show undoes that.
//
// Any club can be linked to its own website, with a logo picked from it: one
// with no logo, one whose logo was found on Squadi or Dribl, or one the
// built-in crests cover (a club can change its logo). The server reads the
// site for the images that may be the logo. The logo is held for the club,
// not a team: every opposition team whose name has all the club's words is
// shown it, as the built-in crests are matched, and the admin sees which
// teams that is before saving. It can be enlarged to fill its circle.
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { fetchDribl, fetchDriblClubs, driblClubsUrl } from "@/lib/dribl";
import Crest from "@/components/Crest";
import { crestFor, clubByKey, clubKeyFor, withFill, cleanFill, FILL_MAX } from "@/lib/clubs";
import { clubWords, namedClubFor, guessClubName } from "@/lib/clubLogos";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const KIND = { club: "Club logo", team: "The team's own logo", game: "Logo on its games" };
const PICK = { logo: "a logo", "site icon": "the site's icon", "share image": "the picture the site shares", image: "the image", current: "the logo in use" };
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const andList = (names) => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// Linking a club to its website, or changing one linked before: the club's
// name (guessed from a team's, or the name it was given), the teams that name
// covers, the club's website read for its logo, the logo picked, and how much
// it fills its circle, seen as it will look. `start` is { name, site?, logo?,
// fill?, key? }: key is the club being changed, so a new name replaces it.
function ClubEditor({ id, start, opponents, named, busy, post, onDone, onCancel }) {
  const [name, setName] = useState(start.name || "");
  const [link, setLink] = useState(start.site || "");
  const [found, setFound] = useState(() => (start.logo ? { site: start.site || "", candidates: [{ url: start.logo, kind: "current" }] } : null));
  const [picked, setPicked] = useState(start.logo || "");
  const [fill, setFill] = useState(() => cleanFill(start.fill));
  const [broken, setBroken] = useState(() => new Set());
  const [err, setErr] = useState("");
  const [reading, setReading] = useState(false);
  const words = useMemo(() => clubWords(name), [name]);
  // The teams that would be shown this logo: every one whose name has all the
  // club's words, built-in crests included, except where another club chosen
  // here has more of the team's words (lib/clubLogos.js namedClubFor). A new
  // club comes last, so it loses a tie, as it would on the server.
  const covers = useMemo(() => {
    const key = words.join("-");
    if (!key) return [];
    const others = (named || []).filter((c) => c.key !== key && c.key !== start.key).map((c) => [c.key, { name: c.name }]);
    const lib = { named: { ...Object.fromEntries(others), [key]: { name } } };
    return opponents.filter((o) => namedClubFor(lib, o.name)?.key === key).map((o) => o.name);
  }, [opponents, named, words, name, start.key]);
  const read = async () => {
    setErr(""); setReading(true);
    try {
      const r = await fetch("/api/club-logos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "site", url: link }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "The site couldn't be read.");
      // The logo in use stays on offer beside what the site gave.
      const fresh = (Array.isArray(j.candidates) ? j.candidates : []).filter((c) => c.url !== start.logo);
      setFound({ site: j.site || "", candidates: [...(start.logo ? [{ url: start.logo, kind: "current" }] : []), ...fresh] });
      setBroken(new Set());
      if (fresh.length === 1) setPicked(fresh[0].url);
    } catch (e) { setErr(String(e.message || e)); }
    setReading(false);
  };
  const save = async () => {
    setErr("");
    try {
      const j = await post({ action: "club", name, logo: picked, site: found?.site || "", fill, ...(start.key ? { replaces: start.key } : {}) });
      const teams = (j?.named || []).find((c) => c.key === j.key)?.teams ?? covers.length;
      onDone(`${name.trim()} saved: its logo now shows for ${plural(teams, "team")}.`);
    } catch (e) { setErr(String(e.message || e)); }
  };
  const shown = (found?.candidates || []).filter((c) => !broken.has(c.url));
  return (
    <div className="adm-club">
      <label className="adm-fl" htmlFor={`club-${id}`}>Club</label>
      <input id={`club-${id}`} className="adm-inp" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      <div className="adm-note" role="status">{covers.length
        ? `Covers ${plural(covers.length, "team")}: ${andList(covers.slice(0, 6))}${covers.length > 6 ? ` and ${covers.length - 6} more` : ""}. Every team whose name has the words ${andList(words.map((w) => `"${w}"`))} gets this logo, the ones still to come too.`
        : "No opposition team's name has all of these words. Shorten the club's name to the words its teams share."}</div>
      <label className="adm-fl" htmlFor={`site-${id}`} style={{ marginTop: 12 }}>Club website or logo link</label>
      <div className="adm-form" style={{ marginTop: 0 }}>
        <input id={`site-${id}`} className="adm-inp" style={{ flex: 1, minWidth: 0 }} inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false}
          placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && link.trim()) read(); }} />
        <button type="button" className="adm-btn soft" disabled={!link.trim() || reading || !!busy} onClick={read}>{reading ? "Reading…" : "Find logos"}</button>
      </div>
      {found && (shown.length ? (
        <>
          <div className="adm-note">{shown.every((c) => c.kind === "current") ? "The logo in use now. To change it, find logos on the club's website." : `Pick the club's logo${found.site ? ` from ${hostOf(found.site)}` : ""}:`}</div>
          <div className="adm-picks" role="group" aria-label="Logos found on the club's site">
            {shown.map((c, i) => (
              <button type="button" key={c.url} className="adm-pick" aria-pressed={picked === c.url} aria-label={`Logo ${i + 1} of ${shown.length}: ${PICK[c.kind] || "an image"}`} onClick={() => setPicked(c.url)}>
                <img src={c.url} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken((b) => new Set(b).add(c.url))} />
              </button>
            ))}
          </div>
        </>
      ) : <div className="adm-msg warn">None of the images on that page would load. Paste a link to the logo image itself.</div>)}
      {picked && (
        <div className="adm-fillrow">
          <Crest src={withFill(picked, fill)} drawn name={name} className="adm-crest adm-crest-lg" discClass="adm-crest adm-crest-lg ph" />
          <Crest src={withFill(picked, fill)} drawn name={name} className="adm-crest" discClass="adm-crest ph" />
          <label className="adm-fill">
            <span>Size in the circle: {Math.round(fill * 100)}%</span>
            <input type="range" min="1" max={FILL_MAX} step="0.05" value={fill} aria-label="Size in the circle" aria-valuetext={`${Math.round(fill * 100)}%`} onChange={(e) => setFill(cleanFill(e.target.value))} />
          </label>
        </div>
      )}
      {err && <div className="adm-msg err" role="alert">{err}</div>}
      <div className="adm-form">
        <button type="button" className="adm-btn" disabled={!picked || !covers.length || !!busy} onClick={save}>Use this logo for {name.trim() || "the club"}</button>
        <button type="button" className="adm-btn soft" onClick={onCancel}>Cancel</button>
      </div>
      <div className="adm-note">Enlarge the logo until it fills the circle without losing its edges. It's shown from the club's own site, as Squadi's are: no copy of it is kept here.</div>
    </div>
  );
}

// The words a built-in club's teams all start with, as the first guess at the
// club's name: "Valley Wanderers U10 Red" and "Valley Wanderers U9" give
// "Valley Wanderers".
function sharedLead(names) {
  const split = names.map((n) => String(n).split(/\s+/).filter(Boolean));
  const first = split[0] || [];
  let i = 0;
  while (i < first.length && split.every((w) => (w[i] || "").toLowerCase() === first[i].toLowerCase())) i++;
  return first.slice(0, i).join(" ");
}
const clubGuess = (names) => {
  const lead = guessClubName(sharedLead(names));
  return clubWords(lead).length ? lead : guessClubName(names[0] || "");
};

export default function ClubLogos() {
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [said, setSaid] = useState("");
  // The club being linked to its website or changed: the row it was opened
  // from (`id`) and what the editor starts with. Once saved, the club is in
  // "Logos you chose", which is brought into view with a word on what changed.
  const [editing, setEditing] = useState(null);
  const [saved, setSaved] = useState("");
  const chosenRef = useRef(null);
  useEffect(() => { if (saved) chosenRef.current?.scrollIntoView?.({ block: "start" }); }, [saved]);

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
    setErr(""); setSaid(""); setSaved(""); setBusy("Reading Squadi…");
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
  const opponents = rep?.opponents || [];
  const of = (shown) => opponents.filter((o) => o.shown === shown);
  const removeClub = async (club) => {
    setErr(""); setSaid(""); setSaved(""); setBusy("Saving…");
    try { await post({ action: "unclub", key: club.key }); setSaid(`${club.name} taken out: its teams are back to the built-in crest or what the draws show.`); } catch (e) { setErr(String(e.message || e)); }
    setBusy("");
  };
  const edit = (id, start) => { setEditing({ id, start }); setSaid(""); setSaved(""); };
  const isOpen = (id) => editing?.id === id;
  const editor = (id) => isOpen(id) && (
    <ClubEditor key={id} id={id.replace(/[^a-z0-9]+/gi, "-")} start={editing.start} opponents={opponents} named={rep?.named || []} busy={busy} post={post}
      onDone={(msg) => { setEditing(null); setSaved(msg); }} onCancel={() => setEditing(null)} />
  );
  const btn = (label, onClick) => <button type="button" className="adm-btn soft sm" disabled={!!busy} onClick={onClick}>{label}</button>;
  const row = (o, buttons) => (
    <div className="adm-row" key={o.ref}>
      <Crest src={o.shown === "found" ? o.logo : null} drawn={o.shown === "found"} name={o.name} className="adm-crest" discClass="adm-crest ph" />
      <div className="adm-row-main">
        {o.name}
        <div className="adm-row-sub">
          {o.shown === "found" ? `${KIND[o.kind] || "Logo"} from ${o.from}` : o.shown === "hidden" ? "Hidden: the initials are shown" : `On ${o.provider === "dribl" ? "Dribl" : "Squadi"}: no logo yet, so the initials are shown`}
        </div>
      </div>
      {!isOpen(o.ref) && buttons}
      {editor(o.ref)}
    </div>
  );
  // The built-in crests, one row per club: its teams share the crest file.
  const builtIn = [];
  for (const o of of("built-in")) {
    const crest = crestFor(o.name);
    const key = o.club || `built-in:${crest}`;
    let g = builtIn.find((x) => x.key === key);
    if (!g) builtIn.push((g = { key, id: `built:${key}`, crest, title: clubByKey(clubKeyFor(o.name))?.name || o.name, teams: [] }));
    g.teams.push(o.name);
  }

  return (
    <>
      {err && <div className="adm-msg err" role="alert">{err}</div>}
      {rep && (
        <section className="adm-card" aria-labelledby="adm-logos">
          <h2 className="adm-label" id="adm-logos">Opposition logos</h2>
          <div className="adm-body">
            <b>{plural(c.opponents || 0, "opposition team")}</b>: {c.builtIn || 0} with a built-in crest, {c.added ? `${c.added} with a logo you chose, ` : ""}{c.found || 0} with a logo found on Squadi or Dribl, {c.missing || 0} still without one{c.hidden ? `, ${c.hidden} hidden` : ""}.
          </div>
          <div className="adm-note">
            {plural(c.newClubs || 0, "club")} found that the built-in crests do not cover, with {plural(c.newLogos || 0, "logo")} between them. {plural(c.duplicatesAvoided || 0, "team name")} matched to a club already known instead of becoming a new club. Found on Squadi or Dribl, two teams are only the same club when Squadi or Dribl says so, never because their names look alike. A logo you choose for a club, from its website, covers every team whose name has the club's words, and comes before a built-in crest or one found.
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
          <div className="adm-rows">{of("missing").map((o) => row(o, btn("Add club logo", () => edit(o.ref, { name: guessClubName(o.name) }))))}</div>
        </section>
      )}
      {rep && (rep.named || []).length > 0 && (
        <section className="adm-card" aria-labelledby="adm-logos-added" ref={chosenRef}>
          <h2 className="adm-label" id="adm-logos-added">Logos you chose</h2>
          {saved && <div className="adm-msg ok" role="status">{saved}</div>}
          <div className="adm-rows">{rep.named.map((club) => {
            const id = `named:${club.key}`;
            return (
              <div className="adm-row" key={club.key}>
                <Crest src={withFill(club.logo, club.fill)} drawn name={club.name} className="adm-crest" discClass="adm-crest ph" />
                <div className="adm-row-main">
                  {club.name}
                  <div className="adm-row-sub">{club.site ? `From ${hostOf(club.site)}, ` : ""}{club.teams ? `shown for ${plural(club.teams, "team")}` : "no opposition team's name has its words yet"}</div>
                </div>
                {!isOpen(id) && <>{btn("Change", () => edit(id, { name: club.name, site: club.site, logo: club.logo, fill: club.fill, key: club.key }))}{btn("Remove", () => removeClub(club))}</>}
                {editor(id)}
              </div>
            );
          })}</div>
        </section>
      )}
      {rep && of("found").length > 0 && (
        <section className="adm-card" aria-labelledby="adm-logos-found">
          <h2 className="adm-label" id="adm-logos-found">Logos found</h2>
          <div className="adm-note">Change a logo to one from the club's website, or enlarge it to fill its circle.</div>
          <div className="adm-rows">{of("found").map((o) => row(o, <>{btn("Hide", () => choose(o, "hide"))}{btn("Change logo", () => edit(o.ref, { name: guessClubName(o.name), logo: o.logo }))}</>))}</div>
        </section>
      )}
      {rep && of("hidden").length > 0 && (
        <section className="adm-card" aria-labelledby="adm-logos-hidden">
          <h2 className="adm-label" id="adm-logos-hidden">Hidden</h2>
          <div className="adm-rows">{of("hidden").map((o) => row(o, <>{btn("Show", () => choose(o, "show"))}{btn("Add club logo", () => edit(o.ref, { name: guessClubName(o.name) }))}</>))}</div>
        </section>
      )}
      {rep && builtIn.length > 0 && (
        <details className="adm-card adm-fold">
          <summary>
            <h2 className="adm-label">Built-in crests</h2>
            <span className="hint">{plural(builtIn.length, "club")}</span>
            <ChevronRight className="chev" size={18} aria-hidden="true" />
          </summary>
          <div className="adm-fold-body">
          <div className="adm-note">These clubs' teams show the club's crest, whatever a draw shows. If a club's crest changes, choose the new one from its website.</div>
          <div className="adm-rows">{builtIn.map((g) => (
            <div className="adm-row" key={g.key}>
              <Crest src={g.crest} name={g.title} className="adm-crest" discClass="adm-crest ph" />
              <div className="adm-row-main">
                {g.title}
                <div className="adm-row-sub">{plural(g.teams.length, "team")}: {andList(g.teams.slice(0, 3))}{g.teams.length > 3 ? ` and ${g.teams.length - 3} more` : ""}</div>
              </div>
              {!isOpen(g.id) && btn("Change logo", () => edit(g.id, { name: clubGuess(g.teams) }))}
              {editor(g.id)}
            </div>
          ))}</div>
          </div>
        </details>
      )}
    </>
  );
}
