import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/fetchdoc fetches an arbitrary URL server-side and reduces it to text for
// the Ask knowledge base. The security-relevant bits are the auth gate, the
// https-only guard (SSRF surface) and content-type rejection; the value bit is
// the HTML→text reduction. AUTH_ON is read at module load, so we re-import per
// test and mock both the team-cookie path and the account-login path.
const { teamFromCookieHeader, auth } = vi.hoisted(() => ({ teamFromCookieHeader: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/teams", () => ({ teamFromCookieHeader }));
vi.mock("@/auth", () => ({ auth }));

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/fetchdoc/route");
}

// Minimal fetch Response stand-in.
function res({ ok = true, status = 200, contentType = "text/html", body = "" }) {
  return { ok, status, headers: { get: (h) => (h.toLowerCase() === "content-type" ? contentType : null) }, text: async () => body };
}

let savedSecret;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET; // default: legacy team-cookie mode
  teamFromCookieHeader.mockReturnValue({ slug: "a" }); // authorised by default
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
  vi.unstubAllGlobals();
});

const longBody = (inner) => `<html><head><title>Team Rules</title></head><body>${inner}</body></html>`;

describe("POST /api/fetchdoc — auth", () => {
  it("401s when the team cookie resolves to no team", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    const { POST } = await loadRoute();
    expect((await POST(fakeRequest({ body: { url: "https://x.test" } }))).status).toBe(401);
  });

  it("uses the account session when AUTH_SECRET is set", async () => {
    process.env.AUTH_SECRET = "secret";
    auth.mockResolvedValue(null); // not signed in
    const { POST } = await loadRoute();
    expect((await POST(fakeRequest({ body: { url: "https://x.test" } }))).status).toBe(401);
    expect(teamFromCookieHeader).not.toHaveBeenCalled();
  });
});

describe("POST /api/fetchdoc — request validation", () => {
  it("400s on malformed JSON", async () => {
    const { POST } = await loadRoute();
    expect((await POST(fakeRequest({}))).status).toBe(400);
  });

  it("rejects non-https URLs (SSRF guard)", async () => {
    const { POST } = await loadRoute();
    for (const url of ["http://x.test", "file:///etc/passwd", "ftp://x", ""]) {
      const r = await POST(fakeRequest({ body: { url } }));
      expect(r.status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled(); // never even attempts the fetch
  });
});

describe("POST /api/fetchdoc — response handling", () => {
  it("502s when the upstream page is not ok", async () => {
    fetch.mockResolvedValue(res({ ok: false, status: 404 }));
    const { POST } = await loadRoute();
    expect((await POST(fakeRequest({ body: { url: "https://x.test" } }))).status).toBe(502);
  });

  it("415s a PDF and points at the upload button", async () => {
    fetch.mockResolvedValue(res({ contentType: "application/pdf" }));
    const { POST } = await loadRoute();
    const r = await POST(fakeRequest({ body: { url: "https://x.test/doc.pdf" } }));
    expect(r.status).toBe(415);
    expect((await r.json()).error).toMatch(/PDF/);
  });

  it("415s a non-text content type", async () => {
    fetch.mockResolvedValue(res({ contentType: "application/json" }));
    const { POST } = await loadRoute();
    expect((await POST(fakeRequest({ body: { url: "https://x.test/api" } }))).status).toBe(415);
  });

  it("422s when too little readable text is extracted", async () => {
    fetch.mockResolvedValue(res({ body: longBody("<p>tiny</p>") }));
    const { POST } = await loadRoute();
    expect((await POST(fakeRequest({ body: { url: "https://x.test" } }))).status).toBe(422);
  });
});

describe("POST /api/fetchdoc — HTML to text", () => {
  it("strips scripts/styles/nav/footer, decodes entities, and returns the title", async () => {
    const html = longBody(
      `<script>var secret = stealCookies();</script>` +
      `<style>.x{color:red}</style>` +
      `<nav>home about contact</nav>` +
      `<p>Welcome to the club. Tom &amp; Jerry play on Saturdays and the coach said &quot;bring water&quot; to every single session please.</p>` +
      `<footer>copyright junk footer</footer>`
    );
    fetch.mockResolvedValue(res({ body: html }));
    const { POST } = await loadRoute();
    const r = await POST(fakeRequest({ body: { url: "https://x.test" } }));
    expect(r.status).toBe(200);
    const { name, text } = await r.json();
    expect(name).toBe("Team Rules");
    expect(text).toContain("Welcome to the club.");
    expect(text).toContain("Tom & Jerry");     // &amp; decoded
    expect(text).toContain('"bring water"');    // &quot; decoded
    expect(text).not.toContain("secret");        // script dropped
    expect(text).not.toContain("color:red");     // style dropped
    expect(text).not.toContain("about");          // nav dropped
    expect(text).not.toContain("copyright");      // footer dropped
  });
});
