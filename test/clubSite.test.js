import { describe, it, expect, vi } from "vitest";
import { siteUrl, isPublicAddress, logoCandidates, readClubSite, readLogoImage, imageKind, SITE_ERRORS, SITE_MAX_BYTES, MAX_CANDIDATES } from "@/lib/clubSite";

// lib/clubSite: a club's own website read for the images that may be its
// logo. The network is a stand-in; every site and name here is made up.
const PAGE = "https://valleywanderers.example/";
const HTML = `<!doctype html><html><head>
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="icon" href="/icon-192.png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-180.png" sizes="180x180">
<link rel="mask-icon" href="/mask.svg">
<meta property="og:image" content="https://cdn.valleywanderers.example/share.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SportsOrganization","name":"Valley Wanderers FC","logo":{"@type":"ImageObject","url":"/img/crest.png"}}</script>
</head><body>
<header><a class="custom-logo-link" href="/"><img src="/img/header.png" alt="Valley Wanderers FC"></a></header>
<img src="/img/team-photo.jpg" alt="Under 10s">
<div class="sponsors"><img src="/img/acme-logo.png" alt="Acme logo"></div>
<img class="lazy" data-src="/img/badge-small.png" src="data:image/gif;base64,R0lGOD" alt="club badge">
<img srcset="/img/emblem-1x.png 1x, /img/emblem-2x.png 2x" alt="emblem">
<footer><img src="/img/f-logo.png" class="footer-logo"></footer>
<a href="https://facebook.com/x"><img src="/img/facebook-logo.png"></a>
</body></html>`;

describe("siteUrl — a link as the admin typed it", () => {
  it("reads a bare name or an http link as https, and drops the #part", () => {
    expect(siteUrl("valleywanderers.example").href).toBe("https://valleywanderers.example/");
    expect(siteUrl("  http://valleywanderers.example/club#top ").href).toBe("https://valleywanderers.example/club");
    expect(siteUrl("https://www.valleywanderers.example/").href).toBe("https://www.valleywanderers.example/");
  });
  it("refuses anything that isn't a public https site", () => {
    for (const bad of ["", "not a link", "intranet", "ftp://valleywanderers.example", "https://user:pw@valleywanderers.example/", "https://valleywanderers.example:8443/",
      "https://localhost/", "https://router.local/", "https://files.internal/", "https://192.168.1.1/", "https://8.8.8.8/", "https://[::1]/", "javascript:alert(1)", "https://" + "a".repeat(400) + ".example/"]) {
      expect(siteUrl(bad)).toBeNull();
    }
  });
});

describe("isPublicAddress", () => {
  it("is true only for an address on the public internet", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"]) expect(isPublicAddress(ip)).toBe(true);
    for (const ip of ["10.0.0.1", "172.16.5.4", "172.31.255.255", "192.168.0.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
      "192.0.2.10", "198.51.100.7", "203.0.113.9", "198.18.0.1", "::", "::1", "fd00::1", "fc12::1", "fe80::1", "ff02::1", "::ffff:10.0.0.1", "2001:db8::1", "nonsense", ""]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
  });
});

describe("logoCandidates — what on a page looks like the club's logo", () => {
  it("offers the page's own logo first, then images that say they're a logo, the site's icons, and the picture it shares", () => {
    expect(logoCandidates(HTML, PAGE)).toEqual([
      { url: "https://valleywanderers.example/img/crest.png", kind: "logo" },
      { url: "https://valleywanderers.example/img/header.png", kind: "logo" },
      { url: "https://valleywanderers.example/img/badge-small.png", kind: "logo" },
      { url: "https://valleywanderers.example/img/emblem-2x.png", kind: "logo" },
      { url: "https://valleywanderers.example/apple-180.png", kind: "site icon" },
      { url: "https://valleywanderers.example/icon-192.png", kind: "site icon" },
      { url: "https://cdn.valleywanderers.example/share.jpg", kind: "share image" }
    ]);
  });
  it("leaves out sponsors', footer and social images, a page with no logo, and tab-sized icons when there's a bigger one", () => {
    const urls = logoCandidates(HTML, PAGE).map((c) => c.url).join(" ");
    expect(urls).not.toMatch(/acme|f-logo|facebook|team-photo|favicon-32|mask/);
    expect(logoCandidates("<html><body><img src='/a.jpg' alt='Kids at training'></body></html>", PAGE)).toEqual([]);
    expect(logoCandidates('<link rel="icon" href="/favicon.ico">', PAGE)).toEqual([{ url: "https://valleywanderers.example/favicon.ico", kind: "site icon" }]);
  });
  it("only keeps links a phone can load from the club's site: https, resolved, short, no data or scripts", () => {
    const html = `<img src="//cdn.seaside.example/logo.png"><img src="http://seaside.example/crest.png"><img src="data:image/png;base64,AAAA" alt="logo">
      <img src="javascript:void(0)" alt="logo"><img src="/${"x".repeat(420)}/logo.png"><img src="/a?x=1&amp;y=2&amp;logo=1"><img src="https://u:p@seaside.example/logo.png">`;
    expect(logoCandidates(html, "https://seaside.example/club/").map((c) => c.url)).toEqual([
      "https://cdn.seaside.example/logo.png", "https://seaside.example/crest.png", "https://seaside.example/a?x=1&y=2&logo=1"
    ]);
  });
  it("gives each image once, and at most a handful", () => {
    const many = Array.from({ length: 20 }, (_, i) => `<img src="/logo-${i}.png"><img src="/logo-${i}.png">`).join("");
    const out = logoCandidates(many, PAGE);
    expect(out).toHaveLength(MAX_CANDIDATES);
    expect(new Set(out.map((c) => c.url)).size).toBe(MAX_CANDIDATES);
  });
  it("reads structured data in any of its usual shapes, and survives what isn't JSON", () => {
    const ld = (o) => `<script type="application/ld+json">${typeof o === "string" ? o : JSON.stringify(o)}</script>`;
    expect(logoCandidates(ld({ "@graph": [{ "@type": "WebSite" }, { "@type": "Organization", logo: "https://ridge.example/ridge.svg" }] }), "https://ridge.example/")[0])
      .toEqual({ url: "https://ridge.example/ridge.svg", kind: "logo" });
    expect(logoCandidates(ld("{ not json"), PAGE)).toEqual([]);
  });
});

// A stand-in network: lookups and answers by host name.
function network({ addrs = {}, pages = {} } = {}) {
  const lookup = vi.fn(async (host) => {
    if (!(host in addrs)) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return addrs[host].map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  });
  const fetchImpl = vi.fn(async (url, init) => {
    const page = pages[url];
    if (!page) throw new TypeError("fetch failed");
    if (page === "hang") {
      return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }
    return new Response(page.body ?? "", { status: page.status ?? 200, headers: page.headers ?? { "content-type": "text/html; charset=utf-8" } });
  });
  return { lookup, fetchImpl };
}
const PUBLIC = ["93.184.216.34"];

describe("readClubSite", () => {
  it("reads the page, saying what it is, and offers what it found", async () => {
    const net = network({ addrs: { "valleywanderers.example": PUBLIC }, pages: { [PAGE]: { body: HTML } } });
    const out = await readClubSite("valleywanderers.example", net);
    expect(out.site).toBe(PAGE);
    expect(out.candidates[0]).toEqual({ url: "https://valleywanderers.example/img/crest.png", kind: "logo" });
    const [, init] = net.fetchImpl.mock.calls[0];
    expect(init.redirect).toBe("manual");
    expect(init.headers["user-agent"]).toContain("club-logo-finder");
  });

  it("follows a redirect, checking where it goes, and reads links against the page it lands on", async () => {
    const net = network({
      addrs: { "valleywanderers.example": PUBLIC, "www.valleywanderers.example": PUBLIC },
      pages: {
        [PAGE]: { status: 301, headers: { location: "http://www.valleywanderers.example/home/" } },
        "https://www.valleywanderers.example/home/": { body: '<img src="logo.png">' }
      }
    });
    const out = await readClubSite(PAGE, net);
    expect(out).toEqual({ site: "https://www.valleywanderers.example/home/", candidates: [{ url: "https://www.valleywanderers.example/home/logo.png", kind: "logo" }] });
    expect(net.lookup.mock.calls.map((c) => c[0])).toEqual(["valleywanderers.example", "www.valleywanderers.example"]);
  });

  it("never reads a site whose name points into a private network, first or after a redirect", async () => {
    const net = network({
      addrs: { "valleywanderers.example": PUBLIC, "inside.example": ["10.0.0.5"], "mixed.example": ["93.184.216.34", "192.168.1.9"] },
      pages: { [PAGE]: { status: 302, headers: { location: "https://inside.example/" } } }
    });
    await expect(readClubSite(PAGE, net)).rejects.toThrow(SITE_ERRORS.notPublic);
    await expect(readClubSite("https://mixed.example/", net)).rejects.toThrow(SITE_ERRORS.notPublic);
    await expect(readClubSite("https://inside.example/", net)).rejects.toThrow(SITE_ERRORS.notPublic);
    expect(net.fetchImpl.mock.calls.map((c) => c[0])).toEqual([PAGE]);
  });

  it("refuses a redirect to a link it wouldn't read, and gives up after a few redirects", async () => {
    let net = network({ addrs: { "valleywanderers.example": PUBLIC }, pages: { [PAGE]: { status: 301, headers: { location: "https://valleywanderers.example:8080/" } } } });
    await expect(readClubSite(PAGE, net)).rejects.toThrow(SITE_ERRORS.notPublic);
    const loop = {};
    for (let i = 0; i < 9; i++) loop[`https://valleywanderers.example/${i}`] = { status: 302, headers: { location: `/${i + 1}` } };
    net = network({ addrs: { "valleywanderers.example": PUBLIC }, pages: loop });
    await expect(readClubSite("https://valleywanderers.example/0", net)).rejects.toThrow(SITE_ERRORS.noAnswer);
    expect(net.fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("takes a link to an image file as the logo itself without asking the site for it, and any other link that answers with an image", async () => {
    const img = "https://valleywanderers.example/img/crest.png";
    let net = network({ addrs: {}, pages: {} });
    expect(await readClubSite(img, net)).toEqual({ site: img, candidates: [{ url: img, kind: "image" }] });
    expect(await readClubSite("valleywanderers.example/files/crest.SVG?v=2", net)).toEqual({ site: "https://valleywanderers.example/files/crest.SVG?v=2", candidates: [{ url: "https://valleywanderers.example/files/crest.SVG?v=2", kind: "image" }] });
    expect(net.fetchImpl).not.toHaveBeenCalled();
    expect(net.lookup).not.toHaveBeenCalled();
    const asked = "https://valleywanderers.example/media/12345";
    net = network({ addrs: { "valleywanderers.example": PUBLIC }, pages: { [asked]: { body: "PNG", headers: { "content-type": "image/png" } } } });
    expect(await readClubSite(asked, net)).toEqual({ site: asked, candidates: [{ url: asked, kind: "image" }] });
  });

  it("says so when the site puts up a check that the visitor is a person, and never tries to get past it", async () => {
    const check = '<!DOCTYPE html><html><head><title>One moment, please...</title><script>var a=navigator.mimeTypes;</script></head><body><div class="loader"></div></body></html>';
    const net = network({ addrs: { "valleywanderers.example": PUBLIC }, pages: { [PAGE]: { body: check } } });
    await expect(readClubSite(PAGE, net)).rejects.toThrow(SITE_ERRORS.checked);
    expect(net.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("says what went wrong in words the admin can act on", async () => {
    const net = network({
      addrs: { "valleywanderers.example": PUBLIC, "down.example": PUBLIC, "gone.example": PUBLIC, "pdf.example": PUBLIC, "bare.example": PUBLIC },
      pages: {
        "https://gone.example/": { status: 404 },
        "https://pdf.example/": { body: "%PDF", headers: { "content-type": "application/pdf" } },
        "https://bare.example/": { body: "<html><body><p>Welcome</p></body></html>" }
      }
    });
    await expect(readClubSite("not a link", net)).rejects.toThrow(SITE_ERRORS.badLink);
    await expect(readClubSite("https://nowhere.example/", net)).rejects.toThrow(SITE_ERRORS.notFound);
    await expect(readClubSite("https://down.example/", net)).rejects.toThrow(SITE_ERRORS.noAnswer);
    await expect(readClubSite("https://gone.example/", net)).rejects.toThrow("(It answered 404.)");
    await expect(readClubSite("https://pdf.example/", net)).rejects.toThrow(SITE_ERRORS.notPage);
    await expect(readClubSite("https://bare.example/", net)).rejects.toThrow(SITE_ERRORS.noLogo);
  });

  it("stops waiting after its time limit", async () => {
    const net = network({ addrs: { "valleywanderers.example": PUBLIC }, pages: { [PAGE]: "hang" } });
    await expect(readClubSite(PAGE, { ...net, timeoutMs: 30 })).rejects.toThrow(SITE_ERRORS.noAnswer);
  });

  it("stops reading a page that never ends", async () => {
    let sent = 0;
    const endless = new ReadableStream({ pull(c) { sent += 65536; c.enqueue(new Uint8Array(65536).fill(120)); } });
    const net = network({ addrs: { "valleywanderers.example": PUBLIC }, pages: { [PAGE]: { body: endless } } });
    await expect(readClubSite(PAGE, net)).rejects.toThrow(SITE_ERRORS.noLogo);
    expect(sent).toBeLessThan(SITE_MAX_BYTES + 4 * 65536);
  });

  it("reads no more of a page than its size limit", async () => {
    const filler = "<p>" + "x".repeat(SITE_MAX_BYTES) + "</p>";
    const net = network({
      addrs: { "valleywanderers.example": PUBLIC, "late.example": PUBLIC },
      pages: { [PAGE]: { body: '<img src="/early-logo.png">' + filler }, "https://late.example/": { body: filler + '<img src="/late-logo.png">' } }
    });
    expect((await readClubSite(PAGE, net)).candidates.map((c) => c.url)).toEqual(["https://valleywanderers.example/early-logo.png"]);
    await expect(readClubSite("https://late.example/", net)).rejects.toThrow(SITE_ERRORS.noLogo);
  });
});

// The first bytes of each kind of picture, as a file of it starts.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const GIF = new TextEncoder().encode("GIF89a\x01\x00");
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 40, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38]);
const AVIF = new Uint8Array([0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0]);
const ICO = new Uint8Array([0, 0, 1, 0, 1, 0, 32, 32, 0, 0]);
const SVG = new TextEncoder().encode('<?xml version="1.0"?>\n<!-- crest -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="5"/></svg>');

describe("imageKind", () => {
  it("knows a picture by its first bytes", () => {
    expect([PNG, JPEG, GIF, WEBP, AVIF, ICO, SVG].map(imageKind)).toEqual(["png", "jpeg", "gif", "webp", "avif", "ico", "svg"]);
    expect(imageKind(new TextEncoder().encode("\uFEFF<svg viewBox='0 0 1 1'></svg>"))).toBe("svg");
  });

  it("knows nothing else for one, whatever its name says", () => {
    const text = (t) => new TextEncoder().encode(t);
    expect(imageKind(text("<!doctype html><html><body><svg></svg></body></html>"))).toBe("");
    expect(imageKind(text("%PDF-1.7"))).toBe("");
    expect(imageKind(text("RIFF\u0000\u0000\u0000\u0000WAVEfmt "))).toBe("");
    expect(imageKind(text("<svgx>"))).toBe("");
    expect(imageKind(new Uint8Array(0))).toBe("");
    expect(imageKind(null)).toBe("");
  });
});

describe("readLogoImage", () => {
  const LOGO = "https://valleywanderers.example/img/crest.png";
  const picture = (body, type = "image/png", extra = {}) => ({ body, headers: { "content-type": type, ...extra } });

  it("fetches the picture, saying what it is, and names its kind from its bytes", async () => {
    const net = network({ addrs: { "valleywanderers.example": PUBLIC }, pages: { [LOGO]: picture(PNG) } });
    const out = await readLogoImage(LOGO, net);
    expect(out.type).toBe("image/png");
    expect([...out.bytes]).toEqual([...PNG]);
    const [, init] = net.fetchImpl.mock.calls[0];
    expect(init.redirect).toBe("manual");
    expect(init.headers["user-agent"]).toContain("club-logo-finder");
    expect(init.headers.accept).toMatch(/^image\//);
  });

  it("goes by the bytes, not by what the site calls them", async () => {
    const net = network({
      addrs: { "valleywanderers.example": PUBLIC },
      pages: {
        "https://valleywanderers.example/a": picture(JPEG, "image/png"),
        "https://valleywanderers.example/b": picture(SVG, "application/octet-stream"),
        "https://valleywanderers.example/c": { body: WEBP, headers: {} }
      }
    });
    expect((await readLogoImage("https://valleywanderers.example/a", net)).type).toBe("image/jpeg");
    expect((await readLogoImage("https://valleywanderers.example/b", net)).type).toBe("image/svg+xml");
    expect((await readLogoImage("https://valleywanderers.example/c", net)).type).toBe("image/webp");
  });

  it("refuses a page, a document or bytes that are no picture, though they say they are", async () => {
    const net = network({
      addrs: { "valleywanderers.example": PUBLIC },
      pages: {
        "https://valleywanderers.example/page": { body: '<html><img src="crest.png"></html>' },
        "https://valleywanderers.example/doc.png": picture(new TextEncoder().encode("%PDF-1.7")),
        "https://valleywanderers.example/text": picture(new TextEncoder().encode("hello"), "text/plain")
      }
    });
    await expect(readLogoImage("https://valleywanderers.example/page", net)).rejects.toThrow(SITE_ERRORS.notImage);
    await expect(readLogoImage("https://valleywanderers.example/doc.png", net)).rejects.toThrow(SITE_ERRORS.notImage);
    await expect(readLogoImage("https://valleywanderers.example/text", net)).rejects.toThrow(SITE_ERRORS.notImage);
  });

  it("reads none of what the site says is something other than a picture", async () => {
    const endless = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(65536).fill(60)); } });
    const net = network({ addrs: { "valleywanderers.example": PUBLIC }, pages: { [LOGO]: { body: endless, headers: { "content-type": "text/html; charset=utf-8" } } } });
    await expect(readLogoImage(LOGO, { ...net, maxBytes: 4096 })).rejects.toThrow(SITE_ERRORS.notImage);
  });

  it("refuses a picture bigger than a logo, by what the site says or by what it sends", async () => {
    const big = new Uint8Array(5000); big.set(PNG);
    const net = network({
      addrs: { "valleywanderers.example": PUBLIC },
      pages: {
        "https://valleywanderers.example/said": picture(PNG, "image/png", { "content-length": "999999999" }),
        "https://valleywanderers.example/sent": picture(big)
      }
    });
    await expect(readLogoImage("https://valleywanderers.example/said", net)).rejects.toThrow(SITE_ERRORS.tooBig);
    await expect(readLogoImage("https://valleywanderers.example/sent", { ...net, maxBytes: 4096 })).rejects.toThrow(SITE_ERRORS.tooBig);
    expect((await readLogoImage("https://valleywanderers.example/sent", { ...net, maxBytes: 5000 })).bytes.length).toBe(5000);
  });

  it("stops reading a picture that never ends", async () => {
    let sent = 0;
    const endless = new ReadableStream({ start(c) { c.enqueue(PNG); }, pull(c) { sent += 65536; c.enqueue(new Uint8Array(65536)); } });
    const net = network({ addrs: { "valleywanderers.example": PUBLIC }, pages: { [LOGO]: picture(endless) } });
    await expect(readLogoImage(LOGO, { ...net, maxBytes: 200000 })).rejects.toThrow(SITE_ERRORS.tooBig);
    expect(sent).toBeLessThan(200000 + 4 * 65536);
  });

  it("checks every name it is sent to, as reading a page does, and gives up after a few redirects", async () => {
    let net = network({
      addrs: { "valleywanderers.example": PUBLIC, "cdn.valleywanderers.example": PUBLIC, "inside.example": ["10.1.2.3"] },
      pages: {
        [LOGO]: { status: 302, headers: { location: "https://cdn.valleywanderers.example/crest.png" } },
        "https://cdn.valleywanderers.example/crest.png": picture(PNG),
        "https://valleywanderers.example/in": { status: 302, headers: { location: "https://inside.example/crest.png" } },
        "https://valleywanderers.example/port": { status: 301, headers: { location: "https://valleywanderers.example:8443/crest.png" } }
      }
    });
    expect((await readLogoImage(LOGO, net)).type).toBe("image/png");
    expect(net.lookup.mock.calls.map((c) => c[0])).toEqual(["valleywanderers.example", "cdn.valleywanderers.example"]);
    await expect(readLogoImage("https://valleywanderers.example/in", net)).rejects.toThrow(SITE_ERRORS.notPublic);
    await expect(readLogoImage("https://valleywanderers.example/port", net)).rejects.toThrow(SITE_ERRORS.notPublic);
    await expect(readLogoImage("https://inside.example/crest.png", net)).rejects.toThrow(SITE_ERRORS.notPublic);
    expect(net.fetchImpl.mock.calls.map((c) => c[0])).not.toContain("https://inside.example/crest.png");
    const loop = {};
    for (let i = 0; i < 9; i++) loop[`https://valleywanderers.example/${i}`] = { status: 302, headers: { location: `/${i + 1}` } };
    net = network({ addrs: { "valleywanderers.example": PUBLIC }, pages: loop });
    await expect(readLogoImage("https://valleywanderers.example/0", net)).rejects.toThrow(SITE_ERRORS.noAnswer);
    expect(net.fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("asks for nothing it wouldn't read, and says so in words the person can act on", async () => {
    const net = network({ addrs: { "gone.example": PUBLIC }, pages: { "https://gone.example/crest.png": { status: 404 }, "https://slow.example/crest.png": "hang" } });
    for (const bad of ["not a link", "ftp://valleywanderers.example/crest.png", "https://user:pw@valleywanderers.example/crest.png", "https://127.0.0.1/crest.png", "https://localhost/crest.png", "data:image/png;base64,iVBORw0KGgo="]) {
      await expect(readLogoImage(bad, net)).rejects.toThrow(SITE_ERRORS.badLink);
    }
    expect(net.fetchImpl).not.toHaveBeenCalled();
    await expect(readLogoImage("https://nowhere.example/crest.png", net)).rejects.toThrow(SITE_ERRORS.notFound);
    await expect(readLogoImage("https://gone.example/crest.png", net)).rejects.toThrow("(It answered 404.)");
    const slow = network({ addrs: { "slow.example": PUBLIC }, pages: { "https://slow.example/crest.png": "hang" } });
    await expect(readLogoImage("https://slow.example/crest.png", { ...slow, timeoutMs: 30 })).rejects.toThrow(SITE_ERRORS.noAnswer);
  });
});
