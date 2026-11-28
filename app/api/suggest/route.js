import { NextResponse } from "next/server";
import { getData } from "@/lib/store";
import { resolveViewer, viewerError } from "@/lib/viewer";
import { withCompetitionFormats } from "@/lib/competitions";
import {
  baseFormat, computeSegments, makePositions, parseFormation, fallbackFormation,
  sanitizeAssignments, rosterForFixture, shapeForPeriod, periodOfSegments, sanitizePlanShapes
} from "@/lib/planner";
import { sanitizeMatchFormat, teamRules, canSuggest } from "@/lib/teamSetup";
import { buildLineupCtx, fillLineup, ruleReceipts, sanitizeOpposition } from "@/lib/lineup";
import { THEIR_TRAITS } from "@/lib/shapes";
import { SUGGEST_SCHEMA, buildSuggestPrompt, emptyByBlockOf, mergeFills, rebalanceIssues } from "@/lib/suggest";
import { claudeMessages, replyText } from "@/lib/claude";

export const dynamic = "force-dynamic";

// Suggest: the AI fills a game's empty lineup spots (ported from GameDay v8).
// Coach-only, and only for the coaches an admin ticked on a team with
// Suggest switched on (lib/teamSetup canSuggest). It calls the model, so it
// needs account sign-in (no team-code mode) and refuses a super admin
// "viewing as" someone. Nothing is saved here: the planner applies the result
// and autosaves it through /api/plan like any other edit.
//
// Body: { fixtureId, plan: { format?, subTimes, assignments, overrides?, shapes?, theirShapes?, opposition? } }
// Reply: { assignments, why, notes, receipts, locked }
//
// Pipeline (GameDay's): prompt -> structured JSON reply -> merge into empty
// spots -> the lineup engine finishes anything missed and repairs period
// coverage -> if the plan still breaks a rule the coach's own picks don't
// explain, one rebalance round -> receipts.
const MODEL = () => process.env.ANTHROPIC_SUGGEST_MODEL || "claude-opus-5-5";

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const { fixtureId, plan: sent } = body || {};
  if (!fixtureId || !sent || typeof sent !== "object" || Array.isArray(sent)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const v = await resolveViewer(req, { write: true });
  if (v.error) return viewerError(v);
  if (v.mode !== "account") return NextResponse.json({ error: "Suggest needs account sign-in." }, { status: 403 });
  if (v.hat?.role !== "coach") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const raw = await getData(v.team.slug);
  if (!raw) return NextResponse.json({ error: "no data" }, { status: 404 });
  if (!canSuggest(raw.team, v.email)) {
    return NextResponse.json({ error: "Suggest isn't switched on for you on this team. Ask your club admin." }, { status: 403 });
  }
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "The assistant isn't configured yet (no API key set)." }, { status: 503 });
  const data = withCompetitionFormats(raw, v.team);
  const fixture = (data.fixtures || []).find((f) => f.id === fixtureId);
  if (!fixture) return NextResponse.json({ error: "no such fixture" }, { status: 404 });

  // The plan as the coach has it now (it may not have autosaved yet).
  const format = sent.format ? sanitizeMatchFormat(sent.format, data.team?.ageGroup) : baseFormat(data, fixture);
  const outfield = Math.max(0, format.playersOnField - (format.hasGK ? 1 : 0));
  const homeRows = parseFormation(format.formation);
  const home = homeRows.reduce((a, b) => a + b, 0) === outfield ? format.formation : fallbackFormation(outfield);
  const subTimes = Array.isArray(sent.subTimes) ? sent.subTimes.map(Number).filter((t) => Number.isFinite(t)).slice(0, 60) : [];
  const segments = computeSegments(format.gameLength, format.periods, subTimes);
  const shapes = sanitizePlanShapes(sent.shapes);
  const theirShapes = sanitizePlanShapes(sent.theirShapes, THEIR_TRAITS.map((t) => t.id));
  const periodOf = periodOfSegments(segments, format.gameLength, format.periods);
  const byPeriod = Array.from({ length: Math.max(1, format.periods) }, (_, pd) =>
    makePositions(parseFormation(shapeForPeriod(shapes, pd, home, outfield)), format.hasGK));
  const positionsByBlock = segments.map((_, i) => byPeriod[periodOf[i]]);
  const overrides = sent.overrides && typeof sent.overrides === "object" && !Array.isArray(sent.overrides) ? sent.overrides : {};
  const roster = rosterForFixture(data, fixture, overrides);
  const avail = roster.filter((p) => p.available);
  if (avail.length < byPeriod[0].length) {
    return NextResponse.json({ error: `Not enough players marked in: you need ${byPeriod[0].length} on the pitch.` }, { status: 409 });
  }
  const base = sanitizeAssignments(Array.isArray(sent.assignments) ? sent.assignments : [], segments, positionsByBlock, roster);
  const empty = emptyByBlockOf(base, positionsByBlock);
  if (!Object.keys(empty).length) return NextResponse.json({ error: "Every spot is already filled. Clear some first." }, { status: 409 });

  const ctx = buildLineupCtx({ segments, positions: byPeriod[0], positionsByBlock, roster, rules: teamRules(data.team), format, opposition: sanitizeOpposition(sent.opposition) });
  const coachLocked = new Set();
  base.forEach((seg, i) => Object.keys(seg).forEach((k) => coachLocked.add(i + ":" + k)));
  const notes = Object.fromEntries((data.players || []).filter((p) => p?.coach?.note).map((p) => [p.id, p.coach.note]));
  const prompt = buildSuggestPrompt(ctx, base, empty, {
    shapes: byPeriod.map((_, pd) => shapeForPeriod(shapes, pd, home, outfield)),
    theirShapes, opponent: String(fixture.opponent || "").slice(0, 60), notes
  });
  const availIds = new Set(avail.map((p) => p.id));

  const messages = [{ role: "user", content: prompt }];
  let best = null;
  let model = MODEL();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await claudeMessages({
        model: MODEL(),
        max_tokens: 16000,
        // Thinking is always on for this model; medium effort is its default, set explicitly.
        output_config: { effort: "medium", format: { type: "json_schema", schema: SUGGEST_SCHEMA } },
        // A request the model declines is re-run on a fallback model in the same call.
        fallbacks: "default",
        messages
      }, { betas: ["server-side-fallback-2026-07-01"] });
      model = res.model || model;
      if (res.stop_reason === "refusal") break;
      let parsed = null;
      try { parsed = JSON.parse(replyText(res)); } catch { parsed = null; }
      if (!parsed || !Array.isArray(parsed.fills)) break;
      const merged = mergeFills(base, parsed.fills, empty, availIds);
      // The engine finishes anything the model left empty and repairs coverage.
      const done = fillLineup(merged, ctx);
      const issues = rebalanceIssues(done.plan, ctx, coachLocked);
      best = { plan: done.plan, notes: done.notes, why: typeof parsed.why === "string" ? parsed.why.trim().slice(0, 400) : "", issues };
      if (!issues.length || attempt === 1) break;
      // Echo the whole reply back (thinking blocks included), then ask once to rebalance.
      messages.push({ role: "assistant", content: res.content },
        { role: "user", content: "Your plan breaks the selection rules: " + issues.join("; ") + ". Rebalance and reply again with the complete corrected JSON in the same format." });
    }
  } catch (e) {
    const status = e?.status === 429 ? 429 : 502;
    return NextResponse.json({ error: e?.status === 429 ? "The assistant is busy. Try again in a minute." : "Couldn't reach the assistant. Auto-fill still works." }, { status });
  }
  if (!best) return NextResponse.json({ error: "The assistant's reply couldn't be used. Try again, or use Auto-fill." }, { status: 502 });

  return NextResponse.json({
    assignments: best.plan,
    why: best.why,
    notes: best.notes,
    receipts: ruleReceipts(best.plan, { ...ctx, locked: coachLocked }),
    locked: [...coachLocked],
    model
  });
}
