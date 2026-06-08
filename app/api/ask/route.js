import { NextResponse } from "next/server";
import { getData } from "@/lib/store";
import { teamFromCookieHeader, teamBySlug } from "@/lib/teams";
import { rulesAsText } from "@/lib/rulesData";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// Model selection: if ANTHROPIC_MODEL is set, use it. Otherwise auto-discover a
// current Sonnet from the account's available models (cached), so model-name
// changes never break the feature and you only ever set the API key.
let _modelCache = { id: null, at: 0 };
async function pickModel() {
  if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL;
  if (_modelCache.id && Date.now() - _modelCache.at < 6 * 3600 * 1000) return _modelCache.id;
  try {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }
    });
    if (r.ok) {
      const j = await r.json();
      const ids = (j.data || []).map((m) => m.id);
      // Prefer the newest Sonnet; fall back to Haiku, then anything available.
      const sonnets = ids.filter((id) => /sonnet/i.test(id)).sort().reverse();
      const haikus = ids.filter((id) => /haiku/i.test(id)).sort().reverse();
      const chosen = sonnets[0] || haikus[0] || ids[0];
      if (chosen) { _modelCache = { id: chosen, at: Date.now() }; return chosen; }
    }
  } catch {}
  // Last-resort default if discovery fails.
  return "claude-sonnet-4-20250514";
}

async function resolveTeam(req) {
  if (AUTH_ON) {
    const { auth } = await import("@/auth");
    const { membershipsForEmail } = await import("@/lib/directory");
    const session = await auth();
    const email = session?.user?.email;
    if (!email) return null;
    const { memberships } = await membershipsForEmail(email);
    if (!memberships.length) return null;
    const m = req.cookies.get("team_slug")?.value;
    const chosen = memberships.find((x) => x.teamSlug === m) || memberships[0];
    return teamBySlug(chosen.teamSlug);
  }
  return teamFromCookieHeader(req.headers.get("cookie"));
}

function gameSummary(data) {
  const t = data.team || {};
  const lines = [`Team: ${t.name} (${t.ageGroup} ${t.division}).`];
  const fx = [...(data.fixtures || [])].sort((a, b) => (a.dateISO || "").localeCompare(b.dateISO || ""));
  const fmt = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }) : "TBC";
  for (const f of fx) {
    const res = f.us != null ? `result ${f.us}-${f.them}` : (f.status === "played" ? "played, score not recorded" : "upcoming");
    const ha = f.homeAway === "H" ? "vs" : "@";
    const focus = f.focusTitle ? `; focus: ${f.focusTitle}` : "";
    lines.push(`Round ${f.round}: ${ha} ${f.opponent} — ${fmt(f.dateISO)} ${f.time || ""} at ${f.venue || "TBC"}; ${res}${focus}.`);
  }
  const sessions = (data.sessions || []).map((s) => `${s.title} (${s.recur === "weekly" ? "weekly" : "one-off"} ${s.time || ""})`).join("; ");
  if (sessions) lines.push(`Training: ${sessions}.`);
  lines.push(`Squad size: ${(data.players || []).length}.`);
  return lines.join("\n");
}

export async function POST(req) {
  const team = await resolveTeam(req);
  if (!team) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "The assistant isn't configured yet (no API key set)." }, { status: 503 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const question = (body.question || "").toString().slice(0, 1000);
  if (!question.trim()) return NextResponse.json({ error: "empty question" }, { status: 400 });

  const data = await getData(team.slug);
  if (!data) return NextResponse.json({ error: "no team data" }, { status: 409 });

  const docs = (data.knowledge || []);
  let budget = 120000;
  const uploaded = docs.map((d) => {
    if (budget <= 0) return "";
    const slice = (d.text || "").slice(0, budget);
    budget -= slice.length;
    return `### Document: ${d.name}\n${slice}`;
  }).filter(Boolean).join("\n\n");
  // The structured formats are always available, on top of whatever the coach loaded.
  const docText = rulesAsText() + (uploaded ? "\n\n" + uploaded : "");

  const ageGroup = (data.team?.ageGroup || "U8");
  const division = (data.team?.division || "");
  const system =
    `You are the friendly assistant for "${team.name}", an Olympic FC junior football team in Brisbane. ` +
    `THIS TEAM IS: ${ageGroup} ${division} — the Kangaroos pathway, which at U8/U9 plays Coles MiniRoos Club Football. ` +
    `CRITICAL — AGE GROUP QUALIFICATION: the TEAM DOCUMENTS may cover several different age groups and programs whose rules DIFFER ` +
    `(e.g. MiniRoos U6-U7 vs U8-U9 vs U10-U11 each have different team sizes, ball sizes and game durations; the FQ Junior Academy U9-U12 ` +
    `is a different program from MiniRoos/Kangaroos; U12+, divisional and advanced leagues have their own rules of competition). ` +
    `Before answering any rules/format/policy question: (1) determine which age group and program the question is about — default to this team's (${ageGroup}, MiniRoos/Kangaroos) unless the person clearly asks about another; ` +
    `(2) answer ONLY from the section of the documents that applies to that age group and program; ` +
    `(3) ALWAYS state which age group/program your answer applies to (e.g. "For U8 MiniRoos…"), and if the documents show a different rule for a nearby age group, you may briefly note the difference. ` +
    `If the documents don't cover the asked age group, say so rather than borrowing another age group's rule. ` +
    `Answer using ONLY (1) the TEAM DOCUMENTS and (2) the LIVE TEAM DATA below. If the answer isn't in either, say you don't have that information and suggest checking with the coach — never invent rules, dates or policies. ` +
    `When you use a document, mention its name. Keep answers short, warm and clear. MiniRoos U8/U9 does not publish match results or points tables.`;

  const history = Array.isArray(body.history) ? body.history.slice(-6).map((m) => ({
    role: m.role === "you" ? "user" : "assistant",
    content: String(m.text || "").slice(0, 2000)
  })) : [];

  const userContent =
    `TEAM DOCUMENTS:\n${docText || "(none provided)"}\n\n` +
    `LIVE TEAM DATA:\n${gameSummary(data)}\n\n` +
    `QUESTION: ${question}`;

  try {
    const model = await pickModel();
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        system,
        messages: [...history, { role: "user", content: userContent }]
      })
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return NextResponse.json({ error: `Assistant error (${r.status})`, model, detail: detail.slice(0, 300) }, { status: 502 });
    }
    const j = await r.json();
    const answer = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return NextResponse.json({ answer: answer || "I'm not sure how to answer that." });
  } catch (e) {
    return NextResponse.json({ error: "Could not reach the assistant." }, { status: 502 });
  }
}
