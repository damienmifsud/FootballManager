"use client";
// A club crest: the registry image from public/crests (never a hotlink:
// Squadi's logoUrl on a fixture is kept as data and not rendered) or, for a
// club we have no artwork for, a disc with the club's initials. Shared by the
// team hub, My teams and the match day planner; each passes the classes that
// size it in its own stylesheet.
//
// The crest always sits beside the club's name in words, so it is decoration
// to a screen reader: an empty alt on the image, and the initials hidden.
// Our own crest (`ours`) falls back to the bundled file if the team's uploaded
// logo fails to load; any other crest that fails just leaves its space.
import { crestFor, OUR_CREST } from "@/lib/clubs";
import { initials } from "@/lib/dashboardData";

export default function Crest({ src, name, ours, className = "mcrest", discClass = "mcrest ph" }) {
  if (!src) return <span className={discClass} aria-hidden="true">{initials(name)}</span>;
  const onError = ours
    ? (e) => { const el = e.currentTarget; if (el.getAttribute("src") !== OUR_CREST) el.src = OUR_CREST; else el.style.visibility = "hidden"; }
    : (e) => { e.currentTarget.style.visibility = "hidden"; };
  return <img className={className + (ours ? " ours" : "")} src={src} alt="" onError={onError} />;
}

// The opposition's crest for a game, from the name on the fixture alone:
// wherever a game is written "vs Wests", this is the crest beside it.
export function OppCrest({ name, className, discClass }) {
  return <Crest src={crestFor(name)} name={name} className={className} discClass={discClass} />;
}
