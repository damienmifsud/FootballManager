// Temporary probe: can GitHub's runners read Dribl's public match centre, and in what shape
// does it answer? It reads a public association's match centre (the example used in the
// public, unofficial description of Dribl's API), never any club's own competition, and it
// prints only statuses, counts, field names and yes/no answers: never what a field holds.
// Usage: node scripts/dribl-probe.mjs plain | browser
const MODE = process.argv[2];
const SLUG = "acnsw";
const HOST = `${SLUG}.dribl.com`;
const PAGE = `https://${HOST}/fixtures`;
const API = "https://mc-api.dribl.com/api";
const LOOKUP = `${API}/tenants?${new URLSearchParams({ mc_link: HOST, slug: SLUG })}`;
const HASH = /^[A-Za-z0-9]{4,24}$/;
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const keysOf = (v) => (isObj(v) ? Object.keys(v).join(", ") || "(none)" : Array.isArray(v) ? `a list of ${v.length}` : v === null ? "null" : typeof v);
const shape = (s) => (typeof s === "string" ? s.replace(/[0-9]/g, "9").replace(/[A-Za-z]/g, "a").slice(0, 40) : typeof s);
const say = (...a) => console.log(...a);

function describeLookup(json) {
  if (!isObj(json)) return say("  lookup answer: not an object:", keysOf(json));
  say("  lookup answer keys:", keysOf(json));
  const list = (Array.isArray(json.data) ? json.data : [json.data]).filter(isObj);
  say("  centres in it:", list.length, Array.isArray(json.data) ? "(data is a list)" : "(data is one object)");
  const c = list[0];
  if (!c) return null;
  const a = isObj(c.attributes) ? c.attributes : {};
  say("  a centre's keys:", keysOf(c), "| attributes:", keysOf(a));
  say("  id looks like a short id:", HASH.test(String(c.id ?? "")), "| hash_id:", HASH.test(String(c.hash_id ?? "")), "| attributes.hash_id:", HASH.test(String(a.hash_id ?? "")));
  say("  slug is ours:", String(a.slug ?? "").toLowerCase() === SLUG, "| mc_link is ours:", String(a.mc_link ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") === HOST);
  return [c.id, c.hash_id, a.hash_id].map((v) => String(v ?? "").trim()).find((v) => HASH.test(v)) || null;
}

function describeFixtures(json) {
  if (!isObj(json)) return say("  fixtures answer: not an object:", keysOf(json));
  say("  fixtures answer keys:", keysOf(json), "| data:", keysOf(json.data));
  say("  meta keys:", keysOf(json.meta), "| links keys:", keysOf(json.links));
  say("  has a next page (meta.next_cursor or links.next):", !!(json.meta?.next_cursor || json.links?.next));
  const item = Array.isArray(json.data) ? json.data.find(isObj) : null;
  if (!item) return;
  const a = isObj(item.attributes) ? item.attributes : {};
  say("  a game's keys:", keysOf(item));
  say("  a game's attributes:", keysOf(a));
  say("  date looks like:", shape(a.date), "| round:", shape(a.round), "| full_round:", shape(a.full_round), "| bye_flag is", typeof a.bye_flag);
  say("  hash_id is a short id:", HASH.test(String(item.hash_id ?? "")), "| team names are text:", typeof a.home_team_name === "string" && typeof a.away_team_name === "string");
}

async function get(label, url, accept, fetchImpl = fetch) {
  let res;
  try { res = await fetchImpl(url, { headers: { accept }, redirect: "follow" }); }
  catch (e) { say(`${label}: could not be made (${String(e?.cause?.code || e?.message || e).slice(0, 80)})`); return null; }
  const type = (res.headers.get("content-type") || "").split(";")[0];
  const text = await res.text();
  const title = /<title>([^<]{0,80})<\/title>/i.exec(text)?.[1] || "";
  say(`${label}: ${res.status} ${type}${title ? ` | title: ${title}` : ""}${res.headers.get("cf-mitigated") ? ` | cf-mitigated: ${res.headers.get("cf-mitigated")}` : ""}`);
  if (!/json/.test(type)) return null;
  try { return JSON.parse(text); } catch { say("  (said json, did not parse)"); return null; }
}

async function plain() {
  say("== plain requests from the runner (Node's fetch) ==");
  await get("the public fixtures page", PAGE, "text/html");
  const lookup = await get("the match-centre lookup", LOOKUP, "application/json");
  const tenant = lookup ? describeLookup(lookup) : null;
  if (!tenant) return say("no match centre id, so no fixtures request");
  const fixtures = await get("a fixtures request (upcoming)", `${API}/fixtures?${new URLSearchParams({ date_range: "default", tenant, timezone: "Australia/Sydney" })}`, "application/json");
  if (fixtures) describeFixtures(fixtures);
}

async function browser() {
  const { chromium } = await import("playwright");
  const b = await chromium.launch();
  try {
    for (const named of ["as itself (HeadlessChrome)", "as ordinary Chrome"]) {
      const probe = await chromium.launch();
      const ua = (await (await probe.newPage()).evaluate(() => navigator.userAgent));
      await probe.close();
      const ctx = await b.newContext({ locale: "en-AU", timezoneId: "Australia/Sydney", ...(named.startsWith("as ordinary") ? { userAgent: ua.replace("HeadlessChrome", "Chrome") } : {}) });
      const page = await ctx.newPage();
      const seen = [];
      page.on("response", (r) => { const u = new URL(r.url()); if (u.hostname.endsWith("dribl.com")) seen.push(`${r.status()} ${u.hostname === "mc-api.dribl.com" ? "api" : "site"}${u.pathname.startsWith("/api/") ? u.pathname : ""}`); });
      say(`== a headless browser, ${named} ==`);
      let status = "none";
      try { status = String((await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 45000 }))?.status() ?? "none"); } catch (e) { status = "failed: " + String(e.message).slice(0, 80); }
      await page.waitForTimeout(8000);
      say(`the public fixtures page: ${status} | title: ${(await page.title()).slice(0, 80)}`);
      const counts = {};
      for (const s of seen) counts[s] = (counts[s] || 0) + 1;
      say("dribl responses seen:", JSON.stringify(counts));
      // The page's own kind of request, made from inside it: the match-centre lookup.
      const inPage = await page.evaluate(async (url) => {
        try { const r = await fetch(url, { headers: { Accept: "application/json" }, credentials: "omit" }); return { status: r.status, type: r.headers.get("content-type") || "", body: await r.text() }; }
        catch (e) { return { status: "failed", type: "", body: String(e) }; }
      }, LOOKUP);
      say(`the match-centre lookup from inside the page: ${inPage.status} ${inPage.type.split(";")[0]}`);
      if (/json/.test(inPage.type)) { try { describeLookup(JSON.parse(inPage.body)); } catch {} }
      await ctx.close();
      if (status === "200") break; // no need to look further
    }
  } finally { await b.close(); }
}

(MODE === "browser" ? browser() : plain()).catch((e) => { console.error("probe failed:", String(e?.message || e).slice(0, 200)); process.exit(1); });
