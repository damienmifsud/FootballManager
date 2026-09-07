"use client";
import { useState } from "react";
import { signOut } from "next-auth/react";
import { OUR_CREST } from "@/lib/clubs";

// The shell the three pre-dashboard pages share (S10, Direction C): the
// sign-in page, the team / hat picker and the empty-club splash. Same tokens
// as the dashboard's CSS block, same DM Sans, same card / input / button /
// sheet-row values as the prototype (Team Hub App.dc.html 663–697, 785–800),
// lifted into classes so the three pages never drift apart. Dashboard.jsx
// keeps its own stylesheet; nothing here is imported there.

export const FONT_HREF = "https://fonts.googleapis.com/css2?family=Anton&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700;9..40,800&family=DM+Mono:wght@500&display=swap";

export const AUTH_CSS = `
.auth{
  --pitch:#C8102E; --pitch-d:#7A0A1B; --ink:#1A1012; --muted:#6B5A5D; --paper:#F4F4F3; --card:#ffffff;
  --soft:#F1EDEE; --line:#E7E3E3; --red:#E5484D; --red-tint:#FDEAEC;
  --r-card:18px; --r-btn:13px; --r-input:11px; --hit-lg:48px;
  --shadow-card:0 1px 2px rgba(10,30,18,.04);
  --font-body:'DM Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  --font-mono:'DM Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  min-height:100vh;background:var(--paper);color:var(--ink);font-family:var(--font-body);
  display:flex;flex-direction:column;align-items:center;-webkit-font-smoothing:antialiased;
}
.auth *{box-sizing:border-box;}
.auth-col{width:100%;max-width:420px;padding:0 16px 32px;display:flex;flex-direction:column;gap:14px;}
.auth-head{display:flex;flex-direction:column;align-items:center;text-align:center;padding:64px 8px 10px;gap:8px;}
.auth-crest{width:84px;height:84px;object-fit:contain;display:block;}
.auth-disc{width:84px;height:84px;border-radius:50%;background:var(--soft);color:var(--muted);display:flex;align-items:center;justify-content:center;
  font-size:22px;font-weight:800;letter-spacing:.04em;}
.auth-title{font-size:22px;font-weight:800;line-height:1.2;margin-top:8px;}
.auth-sub{font-size:14px;color:var(--muted);overflow-wrap:anywhere;}
.auth-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-card);box-shadow:var(--shadow-card);padding:16px;}
.auth-label{display:block;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);}
.auth-input{margin-top:8px;width:100%;border:1px solid var(--line);border-radius:var(--r-input);padding:13px 14px;font-size:15px;
  background:var(--paper);color:var(--ink);outline:none;min-height:var(--hit-lg);font-family:var(--font-body);}
.auth-input::placeholder{color:#9A8F91;}
.auth-input:focus{border-color:var(--pitch);background:#fff;}
.auth-input.code{font-family:var(--font-mono);letter-spacing:.08em;}
.auth-btn{margin-top:12px;width:100%;background:var(--pitch);color:#fff;border:none;border-radius:var(--r-btn);padding:14px;
  font-size:15px;font-weight:800;font-family:inherit;cursor:pointer;min-height:var(--hit-lg);line-height:1.2;
  display:flex;align-items:center;justify-content:center;transition:transform .18s cubic-bezier(.2,.8,.2,1),opacity .18s;}
.auth-btn:active{transform:scale(.98);}
.auth-btn:disabled{opacity:.45;cursor:default;transform:none;}
.auth-btn.sso{margin-top:0;background:#fff;color:var(--ink);border:1px solid var(--line);padding:13px;}
.auth-btn.sso + .auth-btn.sso{margin-top:10px;}
.auth-btn.soft{background:var(--soft);color:var(--ink);}
.auth-btn:focus-visible,.auth-input:focus-visible,.auth-ghost:focus-visible,.auth-row:focus-visible{outline:2px solid var(--pitch);outline-offset:2px;}
.auth-or{display:flex;align-items:center;gap:10px;margin:14px 0;color:var(--muted);font-size:12px;font-weight:600;}
.auth-or span{flex:1;height:1px;background:var(--line);}
.auth-help{font-size:12px;color:var(--muted);margin-top:12px;line-height:1.45;}
.auth-err{font-size:13px;color:var(--red);margin-top:8px;font-weight:700;}
.auth-sent-title{font-size:14px;font-weight:800;}
.auth-sent-sub{font-size:13px;color:var(--muted);margin-top:4px;line-height:1.45;overflow-wrap:anywhere;}
.auth-ghost{background:none;border:none;color:var(--pitch);font:inherit;font-size:13px;font-weight:800;cursor:pointer;padding:12px 0 0;min-height:40px;}
.auth-loading{font-size:13px;color:var(--muted);text-align:center;padding:8px 0;}
.auth-foot{font-size:12px;color:var(--muted);text-align:center;}
.auth-links{display:flex;flex-direction:column;gap:10px;margin-top:14px;}
.auth-links .auth-btn{margin-top:0;text-decoration:none;}
.auth-links .auth-btn.soft{background:var(--soft);}
.auth-body{font-size:14px;line-height:1.5;color:var(--ink);}
.auth-body a{color:var(--pitch);font-weight:700;}
.auth-card-title{font-size:15px;font-weight:800;line-height:1.3;margin-bottom:6px;overflow-wrap:anywhere;}
/* picker: the Viewing-as sheet as a page */
.auth-group{margin:4px 0 8px;}
.auth-group + .auth-team{margin-top:0;}
.auth-team{background:var(--card);border:1px solid var(--line);border-radius:var(--r-card);box-shadow:var(--shadow-card);padding:4px 16px;margin-bottom:12px;}
.auth-team-btn{display:block;width:100%;text-align:left;cursor:pointer;font:inherit;font-family:inherit;color:inherit;transition:transform .18s cubic-bezier(.2,.8,.2,1);}
.auth-team-btn:active{transform:scale(.99);}
.auth-team-btn .auth-row{cursor:inherit;}
.auth-team-name{display:block;font-size:15px;font-weight:800;padding:12px 0 8px;}
.auth-row{width:100%;background:none;border:none;border-bottom:1px solid var(--line);padding:14px 0;display:flex;align-items:center;gap:12px;
  cursor:pointer;text-align:left;color:var(--ink);min-height:56px;font:inherit;font-family:inherit;}
.auth-row:last-child{border-bottom:none;}
.auth-row .disc{width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;
  flex-shrink:0;background:var(--soft);color:var(--muted);}
.auth-row .txt{flex:1;min-width:0;}
.auth-row .txt b{display:block;font-size:14px;font-weight:800;}
.auth-row .txt span{display:block;font-size:12px;color:var(--muted);margin-top:1px;}
.auth-row .txt .name{display:block;font-size:15px;font-weight:800;}
.auth-row .chev{color:#9AA3A6;flex-shrink:0;}
.auth-out{margin-top:2px;}
@media (min-width:431px){.auth-col{padding-bottom:48px;}}
`;

// React 19 hoists a precedence-tagged stylesheet link into <head> and
// de-duplicates it by href, so the fonts load once no matter how many shells
// a page renders; the dashboard @imports the same URL, so the browser shares
// the cached sheet when the user lands there next.
export function AuthStyle() {
  return (<>
    <link rel="stylesheet" href={FONT_HREF} precedence="fonts" />
    <style>{AUTH_CSS}</style>
  </>);
}

// 84 px club crest; when the file is missing the fallback is an initials
// disc, never an emoji.
export function AuthCrest() {
  const [ok, setOk] = useState(true);
  return ok
    ? <img className="auth-crest" src={OUR_CREST} alt="" onError={() => setOk(false)} />
    : <div className="auth-disc" aria-hidden="true">OFC</div>;
}

// Header block: crest, 22/800 title (two lines by default), 14 muted sub.
export function AuthHeader({ title, sub }) {
  return (
    <div className="auth-head">
      <AuthCrest />
      <div className="auth-title">{title || <>Olympic FC<br />Team hub</>}</div>
      {sub && <div className="auth-sub">{sub}</div>}
    </div>
  );
}

// Page frame: paper background, centred 420 px column, styles once.
export function AuthPage({ children }) {
  return (
    <div className="auth">
      <AuthStyle />
      <div className="auth-col">{children}</div>
    </div>
  );
}

export function AuthFooter() {
  return <div className="auth-foot">Olympic FC team hub · footballmgr.au</div>;
}

// Account-mode sign out: drop the team / hat cookies the browser set so the
// next login starts clean, then end the Auth.js session.
const clearCookie = (name) => {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
};
export function SignOutButton({ className = "auth-btn soft auth-out" }) {
  const logout = () => {
    clearCookie("team_slug");
    clearCookie("act_as");
    signOut({ callbackUrl: "/login" });
  };
  return <button className={className} onClick={logout}>Sign out</button>;
}
