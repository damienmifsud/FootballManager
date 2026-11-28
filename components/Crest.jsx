"use client";
// A club crest: the registry image from public/crests or, for a club we have
// no artwork for, the logo its draw gave it (lib/clubs.js sourceLogo: Squadi's
// or Dribl's own, from their own image hosts only), or else a disc with the
// club's initials. Shared by the team hub, My teams and the match day planner;
// each passes the classes that size it in its own stylesheet.
//
// The crest always sits beside the club's name in words, so it is decoration
// to a screen reader: an empty alt on the image, and the initials hidden.
// Our own crest (`ours`) falls back to the bundled file if the team's uploaded
// logo fails to load; any other registry crest that fails just leaves its
// space. A drawn logo (`drawn`: found for the club, or chosen by the admin)
// is fitted inside the circle on white with only a little margin, since it was
// not made for the circular crop, and enlarged further when the admin chose so
// (lib/clubs.js crestFill). It is asked for without saying which page it is
// on, and gives way to the initials if it does not load.
import { useState } from "react";
import { OUR_CREST, oppCrestFor, crestFill } from "@/lib/clubs";
import { initials } from "@/lib/dashboardData";

export default function Crest({ src, name, ours, drawn, className = "mcrest", discClass = "mcrest ph" }) {
  const [failed, setFailed] = useState("");
  if (!src || failed === src) return <span className={discClass} aria-hidden="true">{initials(name)}</span>;
  if (drawn) return <img className={className + " drawn"} src={src} alt="" referrerPolicy="no-referrer" loading="lazy" style={crestFill(src)} onError={() => setFailed(src)} />;
  const onError = ours
    ? (e) => { const el = e.currentTarget; if (el.getAttribute("src") !== OUR_CREST) el.src = OUR_CREST; else el.style.visibility = "hidden"; }
    : (e) => { e.currentTarget.style.visibility = "hidden"; };
  return <img className={className + (ours ? " ours" : "")} src={src} alt="" onError={onError} />;
}

// The opposition's crest for a game: wherever a game is written "vs Wests",
// this is the crest beside it. `crest` is the club logo library's choice for
// the game (its opponentCrest) and `logo` the game's own opponentLogo; either
// is used only when there is no artwork for the club (lib/clubs.js oppCrestFor).
export function OppCrest({ name, logo, crest, className, discClass }) {
  const { src, drawn } = oppCrestFor(name, logo, crest);
  return <Crest src={src} drawn={drawn} name={name} className={className} discClass={discClass} />;
}
