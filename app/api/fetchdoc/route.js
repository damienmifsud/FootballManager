import { NextResponse } from "next/server";
import { teamFromCookieHeader } from "@/lib/teams";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

async function authorized(req) {
  if (AUTH_ON) {
    const { auth } = await import("@/auth");
    const session = await auth();
    return !!session?.user?.email;
  }
  return !!teamFromCookieHeader(req.headers.get("cookie"));
}

// Very small HTML→text: drop scripts/styles/nav noise, strip tags, tidy whitespace.
function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8217;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return s.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*/g, "\n\n").trim();
}

export async function POST(req) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const url = String(body.url || "").trim();
  if (!/^https:\/\//i.test(url)) return NextResponse.json({ error: "Only https:// pages are supported." }, { status: 400 });

  try {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "TeamDashboard/1.0 (+knowledge fetch)" } });
    if (!r.ok) return NextResponse.json({ error: `That page responded ${r.status}.` }, { status: 502 });
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("pdf")) {
      return NextResponse.json({ error: "That's a PDF — download it and use the Upload PDF button instead." }, { status: 415 });
    }
    if (!ct.includes("html") && !ct.includes("text")) {
      return NextResponse.json({ error: `Unsupported content type (${ct}).` }, { status: 415 });
    }
    const html = await r.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const name = (titleMatch ? titleMatch[1] : url).replace(/&#8211;|–|\|/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
    const text = htmlToText(html).slice(0, 200000);
    if (text.length < 100) return NextResponse.json({ error: "Couldn't extract readable text from that page." }, { status: 422 });
    return NextResponse.json({ name, text });
  } catch (e) {
    return NextResponse.json({ error: "Couldn't reach that page." }, { status: 502 });
  }
}
