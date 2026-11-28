// Reading a club's website for its logo. The admin (or, for the team's own
// logo, its coach) pastes the club's website or a link to the logo image
// itself; the server reads that one page and offers the images on it that
// look like the club's logo; the person picks one.
//
// For an opposition club nothing is copied: the logo picked is a link to the
// image on the club's own site, as a logo found on Squadi is a link to
// Squadi's, and families' phones load it from there. The team's own logo is
// different: it shows on every page, so once its coach picks it the picture
// is fetched here (readLogoImage) for their browser to fit and keep, as if
// they had saved it from the site and uploaded it.
//
// The page is read once, when the person asks, with a plain request that says
// what it is. Only a public https site is read: the name is looked up first
// and refused if it points into a private network (or this one), every
// redirect is checked the same way, and there is no other port, no name or
// password in the link, a time limit and a size limit.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export const SITE_MAX_BYTES = 1_500_000;
// The largest logo picture fetched for a team's own logo. A logo is rarely a
// tenth of this; a bigger file is a photo, or not a logo at all.
export const IMAGE_MAX_BYTES = 2_000_000;
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
  noLogo: "No logo was found on that page. Paste a link to the logo image itself: press and hold the logo on the club's site and copy the image address.",
  notImage: "That link isn't a picture the app can use. Pick another, or save the logo from the club's site and upload it.",
  tooBig: "That picture is too big to be a logo. Pick another, or save the logo from the club's site and upload it."
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

// What came back, read up to `max` bytes and no further: { bytes, over },
// `over` when there was more than that.
async function readBytes(res, max) {
  if (!res.body || typeof res.body.getReader !== "function") {
    const all = new Uint8Array(await res.arrayBuffer());
    return { bytes: all.subarray(0, max), over: all.length > max };
  }
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
  return { bytes: all, over: size > max };
}
async function readCapped(res, max) {
  const { bytes } = await readBytes(res, max);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// One request made safely: the name is checked to be public before each hop,
// redirects are followed by hand and checked the same way, and the time limit
// covers reading the answer too. `use(res, url)` reads the answer that ended
// the redirects, and what it returns is returned.
async function guardedGet(start, { fetchImpl, lookup, timeoutMs, accept }, use) {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await checkHost(url.hostname, lookup);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await fetchImpl(url.href, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": USER_AGENT, accept } });
      } catch { throw fail("noAnswer"); }
      if (res.status >= 300 && res.status < 400) {
        try { await res.body?.cancel?.(); } catch {}
        const next = siteUrl(new URL(res.headers.get("location") || "", url).href);
        if (!next) throw fail("notPublic");
        url = next;
        continue;
      }
      if (!res.ok) throw fail("noAnswer", ` (It answered ${res.status}.)`);
      return await use(res, url);
    } finally {
      clearTimeout(timer);
    }
  }
  throw fail("noAnswer");
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
  const url = siteUrl(input);
  if (!url) throw fail("badLink");
  if (IMAGE_FILE.test(url.pathname)) return { site: url.href, candidates: [{ url: url.href, kind: "image" }] };
  return guardedGet(url, { fetchImpl, lookup, timeoutMs, accept: "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5" }, async (res, at) => {
    const type = String(res.headers.get("content-type") || "").toLowerCase();
    if (type.startsWith("image/")) {
      try { await res.body?.cancel?.(); } catch {}
      return { site: at.href, candidates: [{ url: at.href, kind: "image" }] };
    }
    if (!/text\/html|application\/xhtml\+xml/.test(type)) throw fail("notPage");
    let html;
    try { html = await readCapped(res, SITE_MAX_BYTES); } catch { throw fail("noAnswer"); }
    const candidates = logoCandidates(html, at.href);
    if (!candidates.length) throw fail(CHECK_PAGE.test(html) && !/<img\b/i.test(html) ? "checked" : "noLogo");
    return { site: at.href, candidates };
  });
}

// What a picture is, from its first bytes rather than from what the site
// says it is: "png", "jpeg", "gif", "webp", "avif", "ico" or "svg"; "" for
// anything else. Only these are ever handed on.
export function imageKind(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  const at = (i, ...xs) => xs.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  if (at(4, 0x66, 0x74, 0x79, 0x70) && (at(8, 0x61, 0x76, 0x69, 0x66) || at(8, 0x61, 0x76, 0x69, 0x73))) return "avif";
  if (at(0, 0x00, 0x00, 0x01, 0x00) && b.length > 6) return "ico";
  // An SVG is text: its first tag, past any XML declaration, comments or
  // doctype, is <svg.
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 1024)).replace(/^\uFEFF/, "");
  if (/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(head)) return "svg";
  return "";
}
const IMAGE_TYPES = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon", svg: "image/svg+xml" };

// The picture at a logo link, fetched for the team's own logo: { type, bytes }
// with `type` from what the bytes are (IMAGE_TYPES), never what the site said.
// The same checks as reading a page; anything that isn't one of those kinds
// of picture, or is bigger than IMAGE_MAX_BYTES, is refused. Throws an Error
// whose message is for the person (SITE_ERRORS).
export async function readLogoImage(input, { fetchImpl = globalThis.fetch, lookup = dnsLookup, timeoutMs = TIMEOUT_MS, maxBytes = IMAGE_MAX_BYTES } = {}) {
  const url = siteUrl(input);
  if (!url) throw fail("badLink");
  return guardedGet(url, { fetchImpl, lookup, timeoutMs, accept: "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8" }, async (res) => {
    const said = String(res.headers.get("content-type") || "").toLowerCase();
    if (said && !said.startsWith("image/") && !said.startsWith("application/octet-stream")) {
      try { await res.body?.cancel?.(); } catch {}
      throw fail("notImage");
    }
    const length = Number(res.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) {
      try { await res.body?.cancel?.(); } catch {}
      throw fail("tooBig");
    }
    let read;
    try { read = await readBytes(res, maxBytes); } catch { throw fail("noAnswer"); }
    if (read.over) throw fail("tooBig");
    const kind = imageKind(read.bytes);
    if (!kind) throw fail("notImage");
    return { type: IMAGE_TYPES[kind], bytes: read.bytes };
  });
}
