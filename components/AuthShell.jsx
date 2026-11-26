"use client";
import { useState } from "react";
import { signOut } from "next-auth/react";
import { OUR_CREST } from "@/lib/clubs";

// The shell the three pre-dashboard pages share (S10, Direction C): the
// sign-in page, My teams and the empty-club splash. Same tokens
// as the dashboard's CSS block, same DM Sans, same card / input / button /
// sheet-row values as the prototype (Team Hub App.dc.html 663–697, 785–800),
// lifted into classes so the three pages never drift apart. Dashboard.jsx
// keeps its own stylesheet; nothing here is imported there.

export const FONT_HREF = "https://fonts.googleapis.com/css2?family=Anton&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700;9..40,800&family=DM+Mono:wght@500&display=swap";

export const AUTH_CSS = `
.auth{
  --pitch:#C8102E; --pitch-d:#7A0A1B; --ink:#1A1012; --muted:#6B5A5D; --paper:#F4F4F3; --card:#ffffff;
  --soft:#F1EDEE; --line:#E7E3E3; --red:#E5484D; --red-tint:#FDEAEC;
  --green-tint:#E6F6EC; --green-strong:#1F8A4C; --blue-tint:#E6F0FF; --blue-strong:#2563A8;
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
/* My teams: a card per team, role pills, the club row */
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
.auth-mine{padding:6px 16px 14px;}
.auth-mine-top{display:flex;align-items:center;gap:12px;}
.auth-mine-top .auth-team-name{flex:1;min-width:0;overflow-wrap:anywhere;}
.auth-mine .chev,.auth-club .chev{color:#9AA3A6;flex-shrink:0;}
.auth-pills{display:flex;flex-wrap:wrap;gap:6px;}
.auth-pill{display:inline-flex;align-items:center;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:800;line-height:1.2;
  background:var(--soft);color:var(--muted);}
.auth-pill.staff{background:var(--green-tint);color:var(--green-strong);}
.auth-pill.family{background:var(--blue-tint);color:var(--blue-strong);}
.auth-none{margin-bottom:12px;}
.auth-club-label{margin-top:18px;}
.auth-club{text-decoration:none;padding:4px 16px;min-height:64px;border-bottom:1px solid var(--line);}
.auth-club .ico{width:36px;height:36px;border-radius:11px;background:var(--red-tint);color:var(--pitch);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.auth-team-btn:focus-visible,.auth-club:focus-visible{outline:2px solid var(--pitch);outline-offset:2px;}
.auth-out{margin-top:2px;}
/* My teams: both teams together (components/FamilyWeek.jsx). The dashboard's
   week row, reply pill and reply sheet, in this shell's classes. */
.auth-week{display:flex;flex-direction:column;gap:12px;margin-bottom:6px;}
.auth-seg{display:flex;background:var(--line);border-radius:13px;padding:3px;gap:3px;}
.auth-seg button{flex:1;border:none;border-radius:11px;padding:10px;font:inherit;font-size:13px;font-weight:800;cursor:pointer;min-height:44px;
  background:transparent;color:var(--muted);}
.auth-seg button.on{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(10,30,18,.08);}
.auth-week-help{margin-top:0;}
.auth-week-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-top:6px;}
.auth-week-count{font-size:12px;font-weight:700;color:var(--muted);}
.auth-day{padding:14px 16px 6px;}
.auth-day-head{font-size:13px;font-weight:800;}
.auth-day-head span{color:var(--pitch);margin-right:6px;}
.auth-ev{padding:12px 0;border-top:1px solid var(--line);}
.auth-day-head + .auth-ev{border-top:none;padding-top:10px;}
.auth-ev-top{display:flex;gap:12px;align-items:flex-start;}
.auth-ev-ic{width:32px;height:32px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;
  background:var(--red-tint);color:var(--pitch);}
.auth-ev-ic.training{background:#FFF1DA;color:#B3760A;}
.auth-ev-ic.event{background:var(--blue-tint);color:var(--blue-strong);}
.auth-ev-ic.opp{background:none;border-radius:0;}
.auth-opp{width:30px;height:30px;border-radius:50%;object-fit:cover;flex-shrink:0;}
.auth-opp.ph{display:inline-flex;align-items:center;justify-content:center;background:var(--soft);font-size:11px;font-weight:800;color:var(--muted);}
.auth-ev-body{flex:1;min-width:0;}
.auth-ev-title{font-size:14px;font-weight:800;overflow-wrap:anywhere;}
.auth-ev-meta{font-size:12px;color:var(--muted);margin-top:1px;overflow-wrap:anywhere;}
.auth-ev-meta b{font-family:var(--font-mono);font-weight:500;color:var(--ink);}
.auth-ev-tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px;}
.auth-ev-tags .auth-pill{font-size:11px;padding:3px 8px;}
.auth-ev-label{font-size:11px;font-weight:700;color:var(--muted);}
.auth-pill.cancelled,.auth-pill.st.out{background:var(--red-tint);color:#C0393D;}
.auth-pill.st.in{background:var(--green-tint);color:var(--green-strong);}
.auth-reply{display:flex;align-items:center;gap:10px;padding:8px 0 0 44px;}
.auth-reply .avatar{width:30px;height:30px;border-radius:50%;background:var(--soft);display:inline-flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:800;color:var(--muted);flex-shrink:0;}
.auth-reply .who{flex:1;min-width:0;font-size:14px;font-weight:700;overflow-wrap:anywhere;}
.auth-rr{border:none;border-radius:999px;padding:9px 16px;font:inherit;font-size:12px;font-weight:800;cursor:pointer;min-height:44px;min-width:68px;flex-shrink:0;
  background:var(--pitch);color:#fff;transition:transform .18s cubic-bezier(.2,.8,.2,1);}
.auth-rr:active{transform:scale(.97);}
.auth-rr.in{background:var(--green-tint);color:var(--green-strong);}
.auth-rr.out{background:var(--red-tint);color:#C0393D;}
.auth-ev-note{font-size:12px;color:var(--muted);padding:6px 0 0 44px;}
.auth-ov{position:fixed;inset:0;background:rgba(26,16,18,.38);z-index:50;display:flex;align-items:flex-end;justify-content:center;animation:authfade .2s;}
.auth-sheet{background:#fff;width:100%;max-width:560px;border-radius:20px 20px 0 0;max-height:82vh;overflow-y:auto;padding:10px 16px 28px;
  box-shadow:0 -10px 30px rgba(26,16,18,.18);animation:authrise .26s cubic-bezier(.2,.8,.2,1);}
.auth-sheet:focus{outline:none;}
.auth-sheet .grab{width:36px;height:4px;border-radius:2px;background:var(--line);margin:0 auto 14px;}
.auth-sheet-title{font-size:20px;font-weight:800;line-height:1.2;}
.auth-brief{margin-top:12px;border:1px solid var(--line);border-radius:14px;padding:11px 12px;}
.auth-brief .auth-ev-top{align-items:center;}
.auth-brief-place{border-top:1px solid var(--line);margin-top:10px;padding-top:9px;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:42px;}
.auth-brief-place>span{font-size:12px;color:var(--muted);display:inline-flex;align-items:center;gap:5px;min-width:0;}
.auth-brief-place>span svg{flex-shrink:0;}
.auth-brief-place>span span{overflow-wrap:anywhere;}
.auth-dir{background:var(--soft);color:var(--ink);border-radius:999px;padding:8px 12px;font-size:12px;font-weight:800;text-decoration:none;
  display:inline-flex;align-items:center;gap:5px;flex-shrink:0;min-height:32px;}
.auth-dir:focus-visible{outline:2px solid var(--pitch);outline-offset:2px;}
.auth-brief-sides{padding-top:2px;}
.auth-brief-sides.first{border-top:1px solid var(--line);margin-top:10px;padding-top:4px;}
.auth-brief-side{display:flex;align-items:center;gap:10px;padding-top:8px;font-size:13px;color:var(--muted);}
.auth-brief-side .auth-pill{font-size:11px;padding:3px 8px;}
.auth-brief-side b{font-family:var(--font-mono);font-weight:500;color:var(--ink);flex-shrink:0;}
.auth-brief-side span:last-child{flex:1;min-width:0;overflow-wrap:anywhere;}
.auth-rs-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px;}
.auth-rs{border:none;border-radius:14px;padding:18px 12px;font:inherit;font-size:17px;font-weight:800;cursor:pointer;min-height:64px;
  display:flex;align-items:center;justify-content:center;gap:8px;}
.auth-rs.in{background:var(--green-tint);color:var(--green-strong);} .auth-rs.in.sel{background:#1E9E57;color:#fff;}
.auth-rs.out{background:var(--red-tint);color:#C0393D;} .auth-rs.out.sel{background:var(--red);color:#fff;}
.auth-rs:disabled{opacity:.6;cursor:default;}
.auth-sheet .auth-input{margin-top:12px;}
.auth-sheet-foot{font-size:12px;color:var(--muted);margin-top:10px;line-height:1.45;}
.auth-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:60;background:var(--ink);color:#fff;border-radius:999px;
  padding:10px 16px;font-size:13px;font-weight:700;text-align:center;max-width:calc(100% - 32px);box-shadow:0 10px 30px rgba(20,6,10,.3);animation:authtoast .2s ease;}
.auth-seg button:focus-visible,.auth-rr:focus-visible,.auth-rs:focus-visible{outline:2px solid var(--pitch);outline-offset:2px;}
@keyframes authfade{from{opacity:0}to{opacity:1}}
@keyframes authrise{from{transform:translateY(40px)}to{transform:translateY(0)}}
@keyframes authtoast{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
@media (prefers-reduced-motion:reduce){.auth-ov,.auth-sheet,.auth-toast{animation:none;}.auth-rr{transition:none;}}
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
