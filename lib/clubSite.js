// Reading a club's website for its logo, for the admin's Logos section. The
// admin pastes the club's website (or a link to the logo image itself); the
// server reads that one page and offers the images on it that look like the
// club's logo; the admin picks one. Nothing is copied: the logo picked is a
// link to the image on the club's own site, as a logo found on Squadi is a
// link to Squadi's, and families' phones load it from there.
//
// The page is read once, when the admin asks, with a plain request that says
// what it is. Only a public https site is read: the name is looked up first
// and refused if it points into a private network (or this one), every
// redirect is checked the same way, and there is no other port, no name or
// password in the link, a time limit and a size limit.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export const SITE_MAX_BYTES = 1_500_000;
export const MAX_CANDIDATES = 8;
export const LINK_MAX = 400;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 8000;
const USER_AGENT = "Mozilla/5.0 (compatible; club-logo-finder/1.0)";

// The messages the admin sees, kept here so the tests and the screen agree.
export const SITE_ERRORS = {
  badLink: "That isn't a website link. Paste the club's website, starting https://",
  notPublic: "That site can't be read from here. Paste a link to the logo image itself.",
  notFound: "That site couldn't be found. Check the link.",
  noAnswer: "The site didn't answer. Try again, or paste a link to the logo image itself.",
  notPage: "That link isn't a web page or an image.",
  checked: "The club's site asked to check this is a person rather than a program, so it couldn't be read from here. Try Find logos again in a moment, or paste a link to the logo image itself.",
  noLogo: "No logo was found on that page. Paste a link to the logo image itself: press and hold the logo on the club's site and copy the image address."
};
const fail = (key, extra) => Object.assign(new Error(SITE_ERRORS[key] + (extra || "")), { siteError: key });

// A link as the admin typed it, as a URL to read: "clubname.com.au" and
// http:// links are read as https://. null when it can't be one.
export function siteUrl(input) {
  let s = String(input ?? "").trim();
  if (!s || s.length > LINK_MAX || /\s/.test(s)) return null;
  if (/^http:\/\//i.test(s)) s = "https://" + s.slice(7);
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s.replace(/^\/+/, "");
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || isIP(host.replace(/^\[|\]$/g, "")) || /(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) return null;
  u.hash = "";
  return u;
}

// Whether an IP address is on the public internet (not private, loopback,
// link-local, carrier-grade NAT, multicast or reserved).
export function isPublicAddress(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && ip.startsWith("192.0.0.")) || (b === 0 && ip.startsWith("192.0.2.")))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && ip.startsWith("198.51.100.")))) return false;
    if (a === 203 && ip.startsWith("203.0.113.")) return false;
    return true;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return false;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    if (/^(fc|fd)/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith("2001:db8")) return false;
    return true;
  }
  return false;
}

// ---- What on a page looks like the club's logo ----------------------------

const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", "#39": "'", "#x27": "'", "#x2F": "/", "#47": "/" };
const decode = (s) => String(s || "").replace(/&(amp|quot|apos|lt|gt|#39|#x27|#x2F|#47);/gi, (m, k) => ENTITIES[k] ?? ENTITIES[k.toLowerCase()] ?? m);
// The attributes of one tag: { name: value } (names lower-cased).
function attrsOf(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = decode(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return out;
}
// An image link on the page as one the families' phones can load: https,
// resolved against the page, short enough to keep.
function imageUrl(raw, base) {
  const s = String(raw || "").trim();
  if (!s || /^(data|javascript|blob|about):/i.test(s)) return "";
  let u;
  try { u = new URL(s, base); } catch { return ""; }
  if (u.protocol === "http:") u.protocol = "https:";
  if (u.protocol !== "https:" || u.username || u.password || u.port) return "";
  u.hash = "";
  return u.href.length <= LINK_MAX ? u.href : "";
}
// The biggest image a srcset offers ("a.png 1x, a@2x.png 2x" / "… 320w, … 640w").
function largestOf(srcset) {
  let best = "", bestN = -1;
  for (const part of String(srcset || "").split(",")) {
    const [url, size] = part.trim().split(/\s+/);
    const n = size ? parseFloat(size) : 1;
    if (url && n > bestN) { best = url; bestN = n; }
  }
  return best;
}
const LOGOISH = /logo|crest|badge|emblem/i;
const NOT_THE_CLUB = /sponsor|partner|footer|payment|social|facebook|instagram|twitter|youtube|tiktok|linkedin|app-?store|google-?play|whatsapp|pixel|tracking|avatar|gravatar/i;
const iconSize = (sizes) => { const m = String(sizes || "").match(/(\d+)x(\d+)/); return m ? Number(m[1]) : 0; };

// The images on a page that may be the club's logo, best first:
//   [{ url, kind: "logo" | "site icon" | "share image" }]
// "logo": the page says so (its structured data, or an image named, classed
// or captioned logo, crest or badge, or inside something classed so); "site
// icon": the icon the site gives phones and browsers; "share image": the
// picture a link to the site shows, which is sometimes the logo. Sponsors',
// social sites' and footer images are left out.
export function logoCandidates(html, pageUrl) {
  const page = String(html || "");
  const found = [];
  const add = (raw, kind, rank) => { const url = imageUrl(raw, pageUrl); if (url && !NOT_THE_CLUB.test(url)) found.push({ url, kind, rank, at: found.length }); };

  // Structured data: an organisation's own "logo".
  for (const m of page.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const walk = (v, depth) => {
      if (!v || typeof v !== "object" || depth > 6) return;
      if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
      const logo = v.logo;
      if (typeof logo === "string") add(logo, "logo", 0);
      else if (logo && typeof logo === "object" && typeof logo.url === "string") add(logo.url, "logo", 0);
      for (const k of Object.keys(v)) if (k !== "logo") walk(v[k], depth + 1);
    };
    walk(data, 0);
  }

  // Images that say they are a logo, or sit inside something that does.
  for (const m of page.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    const src = a.src && !/^data:/i.test(a.src) ? a.src : (a["data-src"] || a["data-lazy-src"] || a["data-original"] || largestOf(a.srcset || a["data-srcset"]));
    if (!src) continue;
    const own = [a.src, a.alt, a.class, a.id, a.title].filter(Boolean).join(" ");
    const before = page.slice(Math.max(0, m.index - 300), m.index);
    const parentTag = (before.match(/<(a|div|span|figure|picture|h1|p)\b[^>]*>[^<]*$/i) || [""])[0];
    if (NOT_THE_CLUB.test(own) || NOT_THE_CLUB.test(parentTag)) continue;
    if (LOGOISH.test(own) || LOGOISH.test(parentTag)) add(src, "logo", 1);
  }

  // The icons the site gives phones (apple-touch-icon, usually 180 px) and
  // browsers: the biggest of each, one apiece (a site lists the same icon at
  // several sizes), and no tab-sized icon when there's a bigger one.
  const icons = [];
  for (const m of page.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    const rel = String(a.rel || "").toLowerCase();
    if (!a.href || rel.includes("mask-icon")) continue;
    const svg = /\.svg(\?|$)/i.test(a.href) ? 1 : 0;
    if (rel.includes("apple-touch-icon")) icons.push({ href: a.href, apple: 1, size: iconSize(a.sizes), svg });
    else if (/\bicon\b/.test(rel)) icons.push({ href: a.href, apple: 0, size: iconSize(a.sizes), svg });
  }
  const biggest = (list) => list.sort((x, y) => y.svg - x.svg || y.size - x.size)[0];
  const apple = biggest(icons.filter((i) => i.apple));
  const plain = biggest(icons.filter((i) => !i.apple));
  if (apple) add(apple.href, "site icon", 2);
  if (plain && (!apple || plain.svg || plain.size === 0 || plain.size >= 64)) add(plain.href, "site icon", 3);

  // The picture a shared link shows.
  for (const m of page.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    const key = String(a.property || a.name || "").toLowerCase();
    if ((key === "og:image" || key === "og:image:url" || key === "og:image:secure_url" || key === "twitter:image") && a.content) add(a.content, "share image", 4);
  }

  const seen = new Set();
  return found
    .sort((x, y) => x.rank - y.rank || x.at - y.at)
    .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
    .slice(0, MAX_CANDIDATES)
    .map(({ url, kind }) => ({ url, kind }));
}

// ---- Reading the page -------------------------------------------------------

async function checkHost(host, lookup) {
  let addrs;
  try { addrs = await lookup(host, { all: true, verbatim: true }); } catch (e) { throw fail(e?.code === "ENOTFOUND" ? "notFound" : "noAnswer"); }
  const list = Array.isArray(addrs) ? addrs : [addrs];
  if (!list.length || !list.every((a) => isPublicAddress(a?.address))) throw fail("notPublic");
}

async function readCapped(res, max) {
  if (!res.body || typeof res.body.getReader !== "function") return (await res.text()).slice(0, max);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= max) { try { await reader.cancel(); } catch {} break; }
  }
  const all = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const c of chunks) { const part = c.subarray(0, Math.min(c.length, all.length - at)); all.set(part, at); at += part.length; if (at >= all.length) break; }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}

// A link that names an image file ("…/crest.png"). It is offered as it is,
// without the server asking for it: the admin's own browser shows it to pick
// from, so a site that checks its visitors are people still works this way.
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
// A page put up in place of the site's own, to check its visitor is a person
// (a browser check or a puzzle). It is never answered or got round: the admin
// is told, and can try again or paste the logo's own link.
const CHECK_PAGE = /<title>\s*(one moment|just a moment|please wait|checking your browser|attention required|security check|verify)|captcha|challenge-platform|cf-chl/i;

// Read the club's page (or image link): { site, candidates }. Throws an Error
// whose message is for the admin (SITE_ERRORS).
export async function readClubSite(input, { fetchImpl = globalThis.fetch, lookup = dnsLookup, timeoutMs = TIMEOUT_MS } = {}) {
  let url = siteUrl(input);
  if (!url) throw fail("badLink");
  if (IMAGE_FILE.test(url.pathname)) return { site: url.href, candidates: [{ url: url.href, kind: "image" }] };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await checkHost(url.hostname, lookup);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await fetchImpl(url.href, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5" } });
      } catch { throw fail("noAnswer"); }
      if (res.status >= 300 && res.status < 400) {
        const next = siteUrl(new URL(res.headers.get("location") || "", url).href);
        if (!next) throw fail("notPublic");
        url = next;
        continue;
      }
      if (!res.ok) throw fail("noAnswer", ` (It answered ${res.status}.)`);
      const type = String(res.headers.get("content-type") || "").toLowerCase();
      if (type.startsWith("image/")) {
        try { await res.body?.cancel?.(); } catch {}
        return { site: url.href, candidates: [{ url: url.href, kind: "image" }] };
      }
      if (!/text\/html|application\/xhtml\+xml/.test(type)) throw fail("notPage");
      let html;
      try { html = await readCapped(res, SITE_MAX_BYTES); } catch { throw fail("noAnswer"); }
      const candidates = logoCandidates(html, url.href);
      if (!candidates.length) throw fail(CHECK_PAGE.test(html) && !/<img\b/i.test(html) ? "checked" : "noLogo");
      return { site: url.href, candidates };
    } finally {
      clearTimeout(timer);
    }
  }
  throw fail("noAnswer");
}
