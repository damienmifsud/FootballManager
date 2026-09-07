"use client";
// Super-admin access control: manage club admins (view-only on every team)
// and per-email per-team role overrides. Talks to /api/access; the resolver
// in lib/directory.js applies whatever is saved here on every request.
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import TeamWizard from "@/components/TeamWizard";
import RoleMatrix from "@/components/RoleMatrix";

const C = { red: "#C8102E", ink: "#1d1417", muted: "#7a6f72", line: "#eee", soft: "#f6f2f3" };
const card = { background: "#fff", borderRadius: 16, padding: 18, marginBottom: 16, boxShadow: "0 10px 26px rgba(40,0,8,.18)", color: C.ink };
const label = { fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: C.muted, marginBottom: 10 };
const inp = { padding: "9px 12px", borderRadius: 10, border: "2px solid " + C.line, fontSize: 14, boxSizing: "border-box" };
const btn = { padding: "9px 14px", borderRadius: 10, border: "none", background: C.red, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const chip = { display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700 };

const ROLE_LABELS = { coach: "Coach", parent: "Parent", viewer: "View only", blocked: "Blocked" };
const ROLE_COLORS = { coach: "#1E9E57", parent: "#2563a8", viewer: "#b3760a", blocked: "#C8102E" };

export default function AccessManager({ adminEmail }) {
  const [state, setState] = useState(null); // { teams, clubAdmins, envClubAdmins, overrides, roles }
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [caEmail, setCaEmail] = useState("");
  const [ovEmail, setOvEmail] = useState("");
  const [ovTeam, setOvTeam] = useState("");
  const [ovRole, setOvRole] = useState("viewer");
  const [vaEmail, setVaEmail] = useState("");

  const startViewAs = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "viewAs", email: vaEmail }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "failed");
      window.location.href = "/"; // straight into their view
    } catch (e) { setErr(String(e.message || e)); setBusy(false); }
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/access", { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "load failed");
      const j = await r.json();
      setState(j);
      if (!j.teams.length) setErr("No teams configured.");
      setOvTeam((t) => t || j.teams[0]?.slug || "");
    } catch (e) { setErr(String(e.message || e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const post = async (body) => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "save failed");
      await load();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  };

  const teamName = (slug) => state?.teams.find((t) => t.slug === slug)?.name || slug;
  const overrideRows = state
    ? Object.entries(state.overrides).flatMap(([email, per]) => Object.entries(per).map(([slug, role]) => ({ email, slug, role })))
    : [];

  return (
    <div style={{ minHeight: "100vh", padding: 24, fontFamily: "system-ui,sans-serif", background: "linear-gradient(160deg,#C8102E,#7A0A1B)" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ color: "#fff", marginBottom: 18 }}>
          <div style={{ fontSize: 24, fontWeight: 800 }}>Club access control</div>
          <div style={{ fontSize: 13, opacity: .85, marginTop: 3 }}>
            Signed in as {adminEmail} (super admin) · <Link href="/" style={{ color: "#fff" }}>back to the dashboard</Link> ·{" "}
            <button onClick={() => signOut({ callbackUrl: "/login" })} style={{ background: "none", border: "none", color: "#fff", textDecoration: "underline", cursor: "pointer", fontSize: 13, padding: 0 }}>sign out</button>
          </div>
        </div>

        {err && <div style={{ ...card, background: "#fff4f4", color: C.red, fontWeight: 700, fontSize: 14 }}>{err}</div>}

        <details style={{ ...card, padding: 0, overflow: "hidden" }}>
          <summary style={{ ...label, cursor: "pointer", padding: 18, marginBottom: 0, listStyle: "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Who can do what</span>
            <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>every role, every feature</span>
          </summary>
          <div style={{ padding: "0 18px 18px" }}><RoleMatrix /></div>
        </details>

        {!state ? (
          <div style={{ ...card, textAlign: "center", color: C.muted }}>Loading…</div>
        ) : (
          <>
            <div style={card}>
              <div style={label}>Club admins — view-only access to every team</div>
              {state.envClubAdmins.map((e) => (
                <div key={e} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid " + C.line, fontSize: 14 }}>
                  <span style={{ flex: 1, fontWeight: 600 }}>{e}</span>
                  <span style={{ ...chip, background: C.soft, color: C.muted }}>from env</span>
                </div>
              ))}
              {state.clubAdmins.map((e) => (
                <div key={e} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid " + C.line, fontSize: 14 }}>
                  <span style={{ flex: 1, fontWeight: 600 }}>{e}</span>
                  <button disabled={busy} style={{ ...btn, background: "#fff", color: C.red, border: "1px solid " + C.red, padding: "5px 10px" }}
                    onClick={() => post({ action: "removeClubAdmin", email: e })}>Remove</button>
                </div>
              ))}
              {state.envClubAdmins.length + state.clubAdmins.length === 0 && (
                <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>None yet — e.g. the club technical director.</div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <input style={{ ...inp, flex: 1 }} type="email" placeholder="td@club.com" value={caEmail} onChange={(e) => setCaEmail(e.target.value)} />
                <button disabled={busy || !caEmail.includes("@")} style={btn} onClick={() => { post({ action: "addClubAdmin", email: caEmail }); setCaEmail(""); }}>Add</button>
              </div>
            </div>

            <div style={card}>
              <div style={label}>View as a user</div>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>
                See the site exactly as a parent, coach or club admin sees it — strictly read only
                (every save is refused while viewing). An orange banner shows while active; Exit
                brings you back to yourself.
              </div>
              {state.viewingAs ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ ...chip, background: "rgba(224,123,31,.15)", color: "#E07B1F" }}>👁 viewing as {state.viewingAs}</span>
                  <Link href="/" style={{ ...btn, textDecoration: "none", display: "inline-block" }}>Open their view ▸</Link>
                  <button disabled={busy} style={{ ...btn, background: "#fff", color: C.red, border: "1px solid " + C.red }}
                    onClick={() => post({ action: "clearViewAs" })}>Exit view-as</button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input style={{ ...inp, flex: "1 1 200px" }} type="email" placeholder="parent@example.com" value={vaEmail}
                    onChange={(e) => setVaEmail(e.target.value)} />
                  <button disabled={busy || !vaEmail.includes("@")} style={btn} onClick={startViewAs}>👁 View as</button>
                </div>
              )}
            </div>

            <div style={card}>
              <div style={label}>Per-team role overrides</div>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>
                Wins over the defaults for one person on one team — e.g. keep a Team A coach to parent-only on Team B, or block access entirely. The super admin can't be overridden.
              </div>
              {overrideRows.length === 0 && <div style={{ fontSize: 13, color: C.muted }}>No overrides set.</div>}
              {overrideRows.map(({ email, slug, role }) => (
                <div key={email + slug} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid " + C.line, fontSize: 14, flexWrap: "wrap" }}>
                  <span style={{ flex: 1, minWidth: 160, fontWeight: 600 }}>{email}</span>
                  <span style={{ color: C.muted, fontSize: 13 }}>{teamName(slug)}</span>
                  <span style={{ ...chip, background: ROLE_COLORS[role] + "22", color: ROLE_COLORS[role] }}>{ROLE_LABELS[role] || role}</span>
                  <button disabled={busy} style={{ ...btn, background: "#fff", color: C.red, border: "1px solid " + C.red, padding: "5px 10px" }}
                    onClick={() => post({ action: "setOverride", email, teamSlug: slug, role: null })}>Clear</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <input style={{ ...inp, flex: "1 1 180px" }} type="email" placeholder="parent@example.com" value={ovEmail} onChange={(e) => setOvEmail(e.target.value)} />
                <select style={inp} value={ovTeam} onChange={(e) => setOvTeam(e.target.value)}>
                  {state.teams.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
                </select>
                <select style={inp} value={ovRole} onChange={(e) => setOvRole(e.target.value)}>
                  {state.roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                </select>
                <button disabled={busy || !ovEmail.includes("@") || !ovTeam} style={btn}
                  onClick={() => { post({ action: "setOverride", email: ovEmail, teamSlug: ovTeam, role: ovRole }); setOvEmail(""); }}>Set</button>
              </div>
            </div>

            <TeamWizard />

            <div style={card}>
              <div style={label}>League — Squadi fixtures & sync</div>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
                The FQ/Squadi league widget, its filter setup (competition, division, team ids) and the
                "Sync fixtures now" button live on the league page. It's no longer linked from the
                parent-facing dashboard.
              </div>
              <Link href="/league" style={{ ...btn, textDecoration: "none", display: "inline-block" }}>Open league page ▸</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
