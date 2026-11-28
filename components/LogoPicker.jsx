"use client";
// The team's own logo, chosen by its coach (Team settings, Club logo card) or
// by an admin (Club admin, the team form): a picture they upload, or one
// picked from the images on the club's website, and how big it sits in its
// circle. It is shown as it will look beside the team's name on a game, ring
// and all.
//
// The club's website is read by the server (/api/logo-site), which also
// fetches the picture picked, as browsers can't use another site's pictures
// themselves. Either way the browser fits the picture into the team's logo
// (lib/logoFit.js) and the logo is saved with the team, as an uploaded one
// always was: it never depends on the club's site staying as it is.
//
// Controlled: `value` is { logo, fill, site } and `onChange` gets the next
// one. `sites` false leaves out the website part (team-code mode, where
// nobody is signed in to read a site). `ui` picks the class names of the
// screen it is on: "dash" (the team hub) or "admin" (Club admin).
import { useId, useState } from "react";
import { FILL_MAX, OUR_CREST, cleanFill } from "@/lib/clubs";
import { fitLogo, fileToDataUrl } from "@/lib/logoFit";
import Crest from "@/components/Crest";

const UI = {
  dash: { input: "inp", button: "chip", note: "note", label: "lp-label" },
  admin: { input: "adm-inp", button: "adm-btn soft sm", note: "adm-note", label: "adm-fl" }
};
const PICK = { logo: "a logo", "site icon": "the site's icon", "share image": "the picture the site shares", image: "the image" };
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

const CSS = `
.lp-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
.lp-crest{width:30px;height:30px;border-radius:50%;object-fit:cover;flex-shrink:0;box-shadow:var(--crest-ring,0 0 0 2px var(--pitch));background:var(--card,#fff);}
.lp-crest.lp-lg{width:64px;height:64px;}
.lp-crest.ph{display:inline-flex;align-items:center;justify-content:center;background:var(--soft);font-size:11px;font-weight:800;color:var(--muted);box-shadow:none;}
.lp-crest.lp-lg.ph{font-size:18px;}
.lp-crest.framed{position:relative;display:inline-block;overflow:hidden;}
.lp-crest.framed>img{display:block;width:100%;height:100%;object-fit:cover;}
.lp-fill{flex:1;min-width:160px;display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:var(--muted);}
.lp-fill input{width:100%;accent-color:var(--pitch);}
.lp-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}
.lp-file{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;}
.lp-label{display:block;font-size:12px;font-weight:700;color:var(--muted);margin:16px 0 6px;}
.lp-site{display:flex;gap:8px;align-items:center;}
.lp-site input{flex:1;min-width:0;}
.lp-picks{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}
.lp-pick{width:76px;height:76px;border-radius:12px;border:1px solid var(--line);background:var(--soft);padding:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.lp-pick img{max-width:100%;max-height:100%;object-fit:contain;}
.lp-pick[aria-pressed="true"]{border:2px solid var(--pitch);}
.lp-pick:disabled{cursor:wait;opacity:.6;}
.lp-msg{margin-top:8px;font-size:13px;}
.lp-msg.err{color:var(--red);}
`;

export default function LogoPicker({ value, onChange, ui = "dash", name = "", sites = true, disabled = false }) {
  const c = UI[ui] || UI.dash;
  const logo = value?.logo || "";
  const fill = cleanFill(value?.fill);
  const site = value?.site || "";
  const [link, setLink] = useState(site);
  const [found, setFound] = useState(null);
  const [broken, setBroken] = useState(() => new Set());
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const set = (next) => onChange({ logo, fill, site, ...next });
  const siteId = useId();

  const ask = async (body) => {
    const r = await fetch("/api/logo-site", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "The site couldn't be read.");
    return j;
  };
  const read = async () => {
    setErr(""); setBusy("reading"); setPicked("");
    try {
      const j = await ask({ action: "site", url: link });
      setFound({ site: j.site || "", candidates: Array.isArray(j.candidates) ? j.candidates : [] });
      setBroken(new Set());
    } catch (e) { setErr(String(e.message || e)); setFound(null); }
    setBusy("");
  };
  const choose = async (cand) => {
    setErr(""); setBusy("fetching"); setPicked(cand.url);
    try {
      const j = await ask({ action: "image", url: cand.url });
      set({ logo: await fitLogo(j.picture), fill: 1, site: found?.site || link.trim() });
    } catch (e) { setErr(String(e.message || e)); setPicked(""); }
    setBusy("");
  };
  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr(""); setBusy("fitting"); setPicked("");
    try { set({ logo: await fitLogo(await fileToDataUrl(file)), fill: 1 }); }
    catch (x) { setErr(String(x.message || x)); }
    setBusy("");
  };

  const shown = (found?.candidates || []).filter((x) => !broken.has(x.url));
  const off = disabled || !!busy;
  return (
    <div className="lp">
      <style>{CSS}</style>
      <div className="lp-row">
        <Crest src={logo || OUR_CREST} ours fill={logo ? fill : 1} name={name} className="lp-crest lp-lg" discClass="lp-crest lp-lg ph" />
        <Crest src={logo || OUR_CREST} ours fill={logo ? fill : 1} name={name} className="lp-crest" discClass="lp-crest ph" />
        {logo ? (
          <label className="lp-fill">
            <span>Size in the circle: {Math.round(fill * 100)}%</span>
            <input type="range" min="1" max={FILL_MAX} step="0.05" value={fill} disabled={off}
              aria-label="Size in the circle" aria-valuetext={`${Math.round(fill * 100)}%`}
              onChange={(e) => set({ fill: cleanFill(e.target.value) })} />
          </label>
        ) : <span className={c.note} style={{ flex: 1, minWidth: 160 }}>No logo of the team's own yet: the club's crest is shown.</span>}
      </div>
      <div className="lp-actions">
        <label className={c.button} style={{ cursor: off ? "default" : "pointer", position: "relative" }}>
          {logo ? "Upload another picture" : "Upload a picture"}
          <input type="file" accept="image/*" className="lp-file" disabled={off} onChange={upload} />
        </label>
        {logo && <button type="button" className={c.button} disabled={off} onClick={() => { setPicked(""); set({ logo: "", fill: 1 }); }}>Remove</button>}
      </div>

      {sites && <>
        <label className={c.label} htmlFor={siteId} style={{ marginTop: 16 }}>Or find it on the club's website</label>
        <div className="lp-site">
          <input id={siteId} className={c.input} inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false}
            placeholder="https://…" value={link} disabled={disabled}
            onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && link.trim() && !off) { e.preventDefault(); read(); } }} />
          <button type="button" className={c.button} disabled={!link.trim() || off} onClick={read}>{busy === "reading" ? "Reading…" : "Find logos"}</button>
        </div>
        {found && (shown.length ? (
          <>
            <div className={c.note} style={{ marginTop: 8 }}>Pick the club's logo{found.site ? ` from ${hostOf(found.site)}` : ""}:</div>
            <div className="lp-picks" role="group" aria-label="Logos found on the club's site">
              {shown.map((x, i) => (
                <button type="button" key={x.url} className="lp-pick" disabled={off} aria-pressed={picked === x.url}
                  aria-label={`Logo ${i + 1} of ${shown.length}: ${PICK[x.kind] || "an image"}`} onClick={() => choose(x)}>
                  <img src={x.url} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken((b) => new Set(b).add(x.url))} />
                </button>
              ))}
            </div>
          </>
        ) : <div className="lp-msg err" role="alert">None of the images on that page would load. Paste a link to the logo image itself, or save it from the club's site and upload it.</div>)}
      </>}

      <div className="lp-msg" role="status">{busy === "fetching" ? "Getting that logo from the club's site…" : busy === "fitting" ? "Fitting the picture…" : ""}</div>
      {err && <div className="lp-msg err" role="alert">{err}</div>}
      {logo && <div className={c.note} style={{ marginTop: 6 }}>Enlarge it until it fills the circle without losing its edges. The header shows it whole.</div>}
    </div>
  );
}
