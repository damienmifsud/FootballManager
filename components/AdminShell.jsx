"use client";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { FONT_HREF } from "@/components/AuthShell";

// The shell the club's management screens share (/admin and /league), in
// Direction C: the dashboard's tokens, its white sticky sub-header (back
// button, 15/800 title, muted kicker), the 560 px column, hairline cards,
// DM Sans with Anton for numerals and DM Mono for codes. Before this the two
// pages kept the pre-redesign look (red gradient page, system font, heavy
// shadows). Values are the dashboard's own (.head, .card, .label, .inp,
// .btn, .softbadge, .ds-chip, .sw, .ghostlink in Dashboard.jsx), lifted into
// adm- classes so the pages match the app and never drift apart.
// Dashboard.jsx keeps its own stylesheet; nothing here is imported there.

export const ADMIN_CSS = `
.adm{
  --pitch:#C8102E; --pitch-d:#7A0A1B; --ink:#1A1012; --muted:#6B5A5D; --paper:#F4F4F3; --card:#ffffff;
  --line:#E7E3E3; --soft:#F1EDEE; --red:#E5484D;
  --red-tint:#FDEAEC; --red-strong:#C0393D; --amber-tint:#FFF1DA; --amber-strong:#B3760A;
  --green-tint:#E6F6EC; --green-strong:#1F8A4C; --blue-tint:#E6F0FF; --blue-strong:#2563A8;
  --card-gap:14px; --header-bg:rgba(255,255,255,.96); --header-blur:10px;
  --r-card:18px; --r-btn:13px; --r-input:11px;
  --shadow-card:0 1px 2px rgba(10,30,18,.04);
  --font-body:'DM Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  --font-display:'Anton','Arial Narrow',sans-serif;
  --font-mono:'DM Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  min-height:100vh;background:var(--paper);color:var(--ink);font-family:var(--font-body);-webkit-font-smoothing:antialiased;
}
.adm *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
/* header: the dashboard's sub variant */
.adm-head{position:sticky;top:0;z-index:20;background:var(--header-bg);border-bottom:1px solid var(--line);
  backdrop-filter:blur(var(--header-blur));-webkit-backdrop-filter:blur(var(--header-blur));}
.adm-head-in{max-width:560px;margin:0 auto;padding:12px 16px 10px;display:flex;align-items:center;gap:10px;}
.adm-back{width:36px;height:36px;border-radius:12px;border:none;background:var(--soft);color:var(--ink);display:flex;align-items:center;
  justify-content:center;cursor:pointer;flex-shrink:0;margin-left:-4px;padding:0;text-decoration:none;}
.adm-hbody{flex:1;min-width:0;}
.adm-hname{font-weight:800;font-size:15px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0;}
.adm-hkick{font-size:11px;color:var(--muted);font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.adm-hpill{background:var(--soft);color:var(--ink);border:none;border-radius:999px;padding:7px 12px;font:inherit;font-size:12px;font-weight:800;
  cursor:pointer;min-height:32px;flex-shrink:0;white-space:nowrap;}
/* column and cards */
.adm main{padding-bottom:40px;}
.adm-col{max-width:560px;margin:0 auto;padding:16px 16px 0;display:flex;flex-direction:column;gap:var(--card-gap);}
.adm-col:empty{display:none;}
.adm-wide{max-width:960px;margin:0 auto;padding:16px 16px 0;}
.adm-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-card);padding:16px;box-shadow:var(--shadow-card);}
.adm-card.quiet{font-size:13px;color:var(--muted);text-align:center;}
.adm-label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:0;line-height:1.5;}
.adm-body{font-size:13px;color:var(--muted);line-height:1.45;margin-top:6px;}
.adm-body b{color:var(--ink);font-weight:800;}
.adm-note{font-size:12px;color:var(--muted);line-height:1.5;}
.adm-note b{color:var(--ink);font-weight:800;}
.adm-mono{font-family:var(--font-mono);font-weight:500;}
/* rows inside a card: hairlines, never nested boxes */
.adm-rows{margin-top:6px;}
.adm-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 0;border-bottom:1px solid var(--line);min-height:48px;}
.adm-row:last-child{border-bottom:none;}
.adm-row-main{flex:1;min-width:0;font-size:14px;font-weight:800;overflow-wrap:anywhere;}
.adm-row-sub{font-size:12px;color:var(--muted);}
.adm-crest{width:30px;height:30px;border-radius:50%;object-fit:cover;flex-shrink:0;}
.adm-crest.ph{display:inline-flex;align-items:center;justify-content:center;background:var(--soft);font-size:11px;font-weight:800;color:var(--muted);}
.adm-crest.drawn{object-fit:contain;background:#fff;padding:2px;box-shadow:0 0 0 1px var(--line);}
.adm-club{width:100%;padding:4px 0 6px;}
.adm-picks{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}
.adm-pick{width:76px;height:76px;border-radius:12px;border:1px solid var(--line);background:var(--soft);padding:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.adm-pick img{max-width:100%;max-height:100%;object-fit:contain;}
.adm-pick[aria-pressed="true"]{border:2px solid var(--pitch);box-shadow:0 0 0 2px var(--red-tint);}
.adm-fillrow{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:12px;padding:12px 14px;border-radius:14px;background:var(--soft);}
.adm-crest.adm-crest-lg{width:64px;height:64px;}
.adm-fill{flex:1;min-width:160px;display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:var(--muted);}
.adm-fill input{width:100%;min-height:32px;accent-color:var(--pitch);}
.adm-empty{font-size:13px;color:var(--muted);padding:10px 0 2px;}
/* controls */
.adm-inp{width:100%;border:1px solid var(--line);border-radius:var(--r-input);padding:11px 12px;font-size:15px;font-family:inherit;
  background:#fafbfa;color:var(--ink);min-height:44px;}
.adm-inp::placeholder{color:#9A8F91;}
.adm-inp:focus{outline:none;border-color:var(--pitch);background:#fff;}
textarea.adm-inp{min-height:96px;font-family:var(--font-mono);font-size:12px;line-height:1.5;resize:vertical;}
.adm-inp.auto{width:auto;}
.adm-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px;}
.adm-form .grow{flex:1 1 180px;min-width:0;}
.adm-fl{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:5px;}
.adm-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.adm-btn{background:var(--pitch);color:#fff;border:none;border-radius:var(--r-btn);padding:12px 16px;font:inherit;font-size:14px;font-weight:800;
  cursor:pointer;min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;line-height:1.2;
  white-space:nowrap;transition:transform .18s cubic-bezier(.2,.8,.2,1),opacity .18s;}
.adm-btn:active{transform:scale(.98);}
.adm-btn:disabled{opacity:.45;cursor:default;transform:none;}
.adm-btn.soft{background:var(--soft);color:var(--ink);}
.adm-btn.danger{background:var(--red-tint);color:var(--red-strong);}
.adm-btn.sm{padding:8px 12px;font-size:12px;min-height:36px;border-radius:11px;}
.adm-btn.block{width:100%;}
/* a file input inside a label-button: hidden from sight, still reachable by keyboard */
.adm-file{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
label.adm-btn{position:relative;}
label.adm-btn:focus-within{outline:2px solid var(--pitch);outline-offset:2px;}
.adm-link{background:none;border:none;color:var(--pitch);font:inherit;font-size:12px;font-weight:800;cursor:pointer;padding:0;min-height:28px;
  text-decoration:none;display:inline-flex;align-items:center;gap:4px;}
.adm-iconbtn{background:var(--soft);border:none;width:36px;height:36px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;
  cursor:pointer;color:var(--muted);flex-shrink:0;}
.adm-pill{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:800;
  background:var(--soft);color:var(--muted);white-space:nowrap;}
.adm-pill.ok{background:var(--green-tint);color:var(--green-strong);}
.adm-pill.warn{background:var(--amber-tint);color:var(--amber-strong);}
.adm-pill.bad{background:var(--red-tint);color:var(--red-strong);}
.adm-pill.info{background:var(--blue-tint);color:var(--blue-strong);}
.adm-pill.lg{font-size:11px;padding:5px 10px;}
.adm-pill.wrap{white-space:normal;border-radius:12px;line-height:1.3;text-align:left;}
.adm-chips{display:flex;gap:6px;flex-wrap:wrap;}
.adm-chip{border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:999px;padding:7px 12px;font:inherit;font-size:12px;font-weight:700;
  cursor:pointer;min-height:34px;}
.adm-chip.on{background:var(--pitch);color:#fff;border-color:var(--pitch);}
/* a section that keeps its place in the column, and its state, while another one shows */
.adm-sect{display:contents;}
.adm-sect.off{display:none;}
.adm-seg{display:flex;background:var(--line);border-radius:13px;padding:3px;gap:3px;}
.adm-seg button{flex:1;border:none;border-radius:11px;padding:10px;font:inherit;font-size:13px;font-weight:800;cursor:pointer;min-height:40px;
  background:transparent;color:var(--muted);}
.adm-seg button.on{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(10,30,18,.08);}
.adm-sw{width:38px;height:22px;border-radius:999px;background:#D9D3D4;position:relative;flex-shrink:0;transition:background .18s;border:none;padding:0;cursor:pointer;}
.adm-sw::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);
  transition:transform .18s cubic-bezier(.2,.8,.2,1);}
.adm-sw.on{background:var(--pitch);} .adm-sw.on::after{transform:translateX(16px);}
.adm-swrow{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);font-size:13.5px;min-height:44px;}
.adm-swrow:last-child{border-bottom:none;}
.adm-swrow span{flex:1;min-width:0;}
.adm-msg{border-radius:14px;padding:11px 13px;font-size:13px;font-weight:700;line-height:1.45;overflow-wrap:anywhere;}
.adm-msg.err{background:var(--red-tint);color:var(--red-strong);}
.adm-msg.ok{background:var(--green-tint);color:var(--green-strong);}
.adm-msg.warn{background:var(--amber-tint);color:var(--amber-strong);}
.adm-msg .plain{font-weight:400;color:var(--ink);}
.adm-back:focus-visible,.adm-hpill:focus-visible,.adm-btn:focus-visible,.adm-link:focus-visible,.adm-iconbtn:focus-visible,.adm-chip:focus-visible,
.adm-sw:focus-visible,.adm-seg button:focus-visible,.adm-fold summary:focus-visible{outline:2px solid var(--pitch);outline-offset:2px;}
/* a card that folds (details/summary) */
.adm-fold{padding:0;overflow:hidden;}
.adm-fold summary{list-style:none;cursor:pointer;padding:16px;display:flex;align-items:center;gap:10px;min-height:52px;}
.adm-fold summary::-webkit-details-marker{display:none;}
.adm-fold summary .adm-label{flex:1;min-width:0;}
.adm-fold summary .hint{font-size:12px;color:var(--muted);white-space:nowrap;}
.adm-fold summary .chev{color:#9AA3A6;flex-shrink:0;transition:transform .18s cubic-bezier(.2,.8,.2,1);}
.adm-fold[open] summary .chev{transform:rotate(90deg);}
.adm-fold-body{padding:0 16px 16px;}
/* the role table: scrolls sideways on a phone with the feature column pinned */
.adm-tablewrap{overflow-x:auto;margin:0 -16px;padding:0 16px;}
.adm-table{width:100%;border-collapse:collapse;min-width:640px;}
.adm-table th{text-align:left;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:8px 6px;
  border-bottom:1px solid var(--line);vertical-align:bottom;}
.adm-table th small{display:block;font-size:11px;font-weight:400;text-transform:none;letter-spacing:0;margin-top:2px;}
.adm-table td{font-size:13px;padding:9px 6px;border-bottom:1px solid var(--line);vertical-align:top;}
.adm-table th:first-child,.adm-table td:first-child{position:sticky;left:0;background:var(--card);padding-left:0;}
.adm-table td.feat{font-weight:700;min-width:170px;}
.adm-table td.feat small{display:block;font-size:12px;color:var(--muted);font-weight:400;margin-top:2px;line-height:1.4;}
.adm-table tr.grp td{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--pitch);padding-top:16px;}
.adm-list{margin:12px 0 0;padding-left:18px;font-size:12px;color:var(--muted);line-height:1.5;}
/* team rows and the wizard form */
.adm-team{padding:12px 0;border-bottom:1px solid var(--line);}
.adm-team:last-of-type{border-bottom:none;}
.adm-team-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.adm-team-name{font-size:14px;font-weight:800;margin-right:2px;overflow-wrap:anywhere;}
.adm-team-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;}
.adm-team-meta{display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--muted);}
.adm-team-meta b{color:var(--ink);font-weight:500;font-family:var(--font-mono);}
.adm-wizard{border-top:1px solid var(--line);margin-top:14px;padding-top:14px;}
.adm-wizard-title{font-size:20px;font-weight:800;line-height:1.2;overflow-wrap:anywhere;margin:0;}
.adm-step{margin-top:20px;}
.adm-step-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
.adm-step-n{font-family:var(--font-display);font-weight:400;font-size:20px;line-height:1;color:var(--pitch);min-width:14px;}
.adm-step-t{font-size:14px;font-weight:800;margin:0;line-height:1.3;}
.adm-step .adm-note{margin-top:6px;}
.adm-step .adm-note.lead{margin:0 0 8px;}
.adm-line{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;}
.adm-line .w110{width:110px;font-size:12px;font-weight:700;color:var(--muted);flex-shrink:0;}
.adm-train{display:grid;grid-template-columns:minmax(84px,auto) 1fr 36px;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);}
.adm-train .times{grid-column:1 / -1;display:flex;gap:8px;align-items:center;}
.adm-train .times .adm-inp{flex:1;min-width:0;}
.adm-staff{padding:10px 0;border-bottom:1px solid var(--line);}
.adm-staff .top{display:flex;gap:8px;align-items:center;}
.adm-staff .more{display:grid;grid-template-columns:1fr 1.4fr;gap:8px;margin-top:8px;}
.adm-staff .w110{width:110px;font-size:12px;font-weight:700;color:var(--muted);flex-shrink:0;}
.adm-comp{margin-top:12px;padding-top:12px;border-top:1px solid var(--line);}
.adm-comp .top{display:flex;gap:8px;align-items:center;}
.adm-logo{width:44px;height:44px;object-fit:contain;border-radius:10px;background:var(--soft);}
.adm-actions{display:flex;gap:8px;margin-top:20px;}
.adm-actions .adm-btn{flex:1;}
.adm-foot{font-size:12px;color:var(--muted);text-align:center;padding-top:4px;}
/* people: one card per person; the head is the button that opens it */
.adm-people-count{margin:-4px 2px;}
.adm-people-foot{margin:0 2px;}
.adm-person{padding:0;}
.adm-person-head{width:100%;background:none;border:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;
  padding:14px 16px 10px;min-height:60px;border-radius:var(--r-card);}
.adm-person-head .disc{width:40px;height:40px;border-radius:50%;background:var(--soft);color:var(--muted);display:inline-flex;align-items:center;
  justify-content:center;font-size:13px;font-weight:800;flex-shrink:0;}
.adm-person-head .who{flex:1;min-width:0;}
.adm-person-head .who b{display:block;font-size:15px;font-weight:800;line-height:1.25;overflow-wrap:anywhere;}
.adm-person-head .who span{display:block;font-size:12px;color:var(--muted);overflow-wrap:anywhere;}
.adm-person-head .chev{color:#9AA3A6;flex-shrink:0;transition:transform .18s cubic-bezier(.2,.8,.2,1);}
.adm-person.open .adm-person-head .chev{transform:rotate(90deg);}
.adm-person-head:focus-visible{outline:2px solid var(--pitch);outline-offset:-2px;}
.adm-person-pills{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 14px;}
.adm-person-body{border-top:1px solid var(--line);padding:4px 16px 16px;}
.adm-person-body > .adm-note{margin-top:12px;}
.adm-person-team{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 0;border-bottom:1px solid var(--line);}
.adm-person-team .t{flex:1 1 150px;min-width:0;}
.adm-person-team .t b{display:block;font-size:14px;font-weight:800;overflow-wrap:anywhere;}
.adm-person-team .t span{display:block;font-size:12px;color:var(--muted);margin-top:1px;}
.adm-person-team .adm-inp{min-height:40px;padding:8px 10px;font-size:14px;}
/* add to a team: the team on its own line, then the role beside the button */
.adm-person-add{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:12px;}
.adm-person-add .team{grid-column:1 / -1;}
.adm-person-add .adm-inp{min-height:40px;padding:8px 10px;font-size:14px;}
.adm-person-add .adm-btn{min-height:40px;}
.adm-person-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;}
/* a card that is one link: icon square, title, sub line, chevron */
.adm-linkcard{padding:12px 16px;display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--ink);}
.adm-lc-ic{width:36px;height:36px;border-radius:11px;background:var(--red-tint);color:var(--pitch);display:inline-flex;align-items:center;
  justify-content:center;flex-shrink:0;}
.adm-lc-body{flex:1;min-width:0;}
.adm-lc-title{display:block;font-weight:800;font-size:14px;}
.adm-lc-sub{display:block;font-size:12px;color:var(--muted);}
.adm-linkcard .chev{color:#9AA3A6;flex-shrink:0;}
.adm-linkcard:focus-visible{outline:2px solid var(--pitch);outline-offset:2px;}
/* league: the embedded draw */
.adm-frame{width:100%;height:calc(100vh - 150px);min-height:420px;border:1px solid var(--line);border-radius:var(--r-card);background:#fff;display:block;}
.adm-frame-bar{display:flex;justify-content:flex-end;margin-bottom:8px;}
@media (max-width:480px){.adm-grid2.stack{grid-template-columns:1fr;}}
/* On a wide screen the open role table breaks out of the 560 px column so all
   five roles fit without scrolling sideways. */
@media (min-width:800px){
  .adm-fold[open]{width:720px;margin-left:-96px;align-self:flex-start;}
  .adm-fold[open] .adm-table{min-width:0;}
}
`;

// React 19 hoists the precedence-tagged font link into <head> and de-duplicates
// it by href, so it loads once and is shared with the sign-in pages and the
// dashboard (same URL).
export function AdminStyle() {
  return (<>
    <link rel="stylesheet" href={FONT_HREF} precedence="fonts" />
    <style>{ADMIN_CSS}</style>
  </>);
}

// Page frame: paper background, the dashboard's sticky sub-header (back to
// the team hub, title, kicker, an optional control on the right) and the
// 560 px column. `after` renders below the column at the wide width (the
// league page's embedded draw).
export function AdminPage({ title, kicker, backHref = "/", backLabel = "Back to the team hub", right, after, children }) {
  return (
    <div className="adm">
      <AdminStyle />
      <header className="adm-head">
        <div className="adm-head-in">
          <Link className="adm-back" href={backHref} aria-label={backLabel}><ChevronLeft size={18} aria-hidden="true" /></Link>
          <div className="adm-hbody">
            <h1 className="adm-hname">{title}</h1>
            {kicker && <div className="adm-hkick">{kicker}</div>}
          </div>
          {right}
        </div>
      </header>
      <main>
        <div className="adm-col">{children}</div>
        {after && <div className="adm-wide">{after}</div>}
      </main>
    </div>
  );
}

// The dashboard's switch: a real button with role="switch".
export function AdminSwitch({ on, label, onClick, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} disabled={disabled}
      className={"adm-sw" + (on ? " on" : "")} onClick={onClick} />
  );
}
