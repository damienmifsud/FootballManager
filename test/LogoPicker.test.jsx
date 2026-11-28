// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import LogoPicker from "@/components/LogoPicker";
import Crest from "@/components/Crest";
import { OUR_CREST, ourCrestZoom, ourLogoFill, FILL_MAX } from "@/lib/clubs";

// The team's own logo picker (Team settings and the Club admin team form) and
// our crest enlarged in its circle. The browser's fitting of a picture
// (lib/logoFit.js, which needs a real canvas) is a stand-in that says what it
// was given; every site and name is made up.
const { fitLogo, fileToDataUrl } = vi.hoisted(() => ({ fitLogo: vi.fn(), fileToDataUrl: vi.fn() }));
vi.mock("@/lib/logoFit", () => ({ fitLogo, fileToDataUrl }));

const SITE = "https://valleywanderers.example/";
const CREST = "https://valleywanderers.example/img/crest.png";
const ICON = "https://valleywanderers.example/apple-180.png";
const PICTURE = "data:image/png;base64,UElDVFVSRQ==";
const FITTED = "data:image/png;base64,RklUVEVE";
const OLD = "data:image/png;base64,T0xE";

let site, image;
const reply = (status, json) => Promise.resolve({ ok: status < 400, status, json: async () => json });
beforeEach(() => {
  site = () => reply(200, { ok: true, site: SITE, candidates: [{ url: CREST, kind: "logo" }, { url: ICON, kind: "site icon" }] });
  image = () => reply(200, { ok: true, type: "image/png", picture: PICTURE });
  vi.stubGlobal("fetch", vi.fn((url, init) => {
    const body = JSON.parse(init.body);
    return body.action === "site" ? site(body) : image(body);
  }));
  fitLogo.mockReset().mockImplementation(async (src) => (src === PICTURE || src.startsWith("data:image/") ? FITTED : Promise.reject(new Error("no"))));
  fileToDataUrl.mockReset().mockResolvedValue("data:image/jpeg;base64,RklMRQ==");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// The picker as a screen holds it: its value, and every change it sends.
let changes;
function Holder({ start = { logo: "", fill: 1, site: "" }, ...props }) {
  const [value, setValue] = useState(start);
  return <LogoPicker value={value} onChange={(v) => { changes.push(v); setValue(v); }} name="Riverside FC U10" {...props} />;
}
const show = (props) => { changes = []; return render(<Holder {...props} />); };
const big = () => document.querySelector(".lp-crest.lp-lg");
const sent = () => fetch.mock.calls.map((c) => JSON.parse(c[1].body));

describe("LogoPicker", () => {
  it("with no logo of the team's own, shows the club's crest as it is shown now, and no size to set", () => {
    show();
    expect(big().getAttribute("src")).toBe(OUR_CREST);
    expect(screen.getByText("No logo of the team's own yet: the club's crest is shown.")).toBeTruthy();
    expect(screen.queryByLabelText("Size in the circle")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("finds the logos on the club's website and fetches the one picked, fitted, from the site the server read", async () => {
    show();
    fireEvent.change(screen.getByLabelText("Or find it on the club's website"), { target: { value: "valleywanderers.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Find logos" }));
    const picks = await screen.findByRole("group", { name: "Logos found on the club's site" });
    expect(screen.getByText("Pick the club's logo from valleywanderers.example:")).toBeTruthy();
    const buttons = within(picks).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Logo 1 of 2: a logo", "Logo 2 of 2: the site's icon"]);
    // Shown from the club's own site without saying which page they're on.
    expect(buttons.map((b) => [b.querySelector("img").getAttribute("src"), b.querySelector("img").getAttribute("referrerpolicy")])).toEqual([[CREST, "no-referrer"], [ICON, "no-referrer"]]);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(changes.at(-1)).toEqual({ logo: FITTED, fill: 1, site: SITE }));
    expect(sent()).toEqual([{ action: "site", url: "valleywanderers.example" }, { action: "image", url: CREST }]);
    expect(fitLogo).toHaveBeenCalledWith(PICTURE);
    expect(big().getAttribute("src")).toBe(FITTED);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Size in the circle").value).toBe("1");
  });

  it("says what went wrong reading the site, or fetching a logo, and changes nothing", async () => {
    site = () => reply(422, { error: "The club's site asked to check this is a person rather than a program, so it couldn't be read from here." });
    show({ start: { logo: OLD, fill: 1.2, site: SITE } });
    fireEvent.click(screen.getByRole("button", { name: "Find logos" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/check this is a person/);
    site = () => reply(200, { ok: true, site: SITE, candidates: [{ url: CREST, kind: "logo" }] });
    image = () => reply(422, { error: "That picture is too big to be a logo." });
    fireEvent.click(screen.getByRole("button", { name: "Find logos" }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Logos found on the club's site" })).getByRole("button"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("That picture is too big to be a logo."));
    expect(changes).toEqual([]);
    expect(document.querySelector(".lp-crest.lp-lg.framed img").getAttribute("src")).toBe(OLD);
  });

  it("an uploaded picture is fitted the same way, and keeps the website the logo came from", async () => {
    const { container } = show({ start: { logo: "", fill: 1, site: SITE } });
    const file = new File(["x"], "crest.jpg", { type: "image/jpeg" });
    fireEvent.change(container.querySelector("input[type=file]"), { target: { files: [file] } });
    await waitFor(() => expect(changes.at(-1)).toEqual({ logo: FITTED, fill: 1, site: SITE }));
    expect(fileToDataUrl).toHaveBeenCalledWith(file);
    expect(fitLogo).toHaveBeenCalledWith("data:image/jpeg;base64,RklMRQ==");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sizes the logo in its circle, seen as it will be on a game, and takes it away again", () => {
    show({ start: { logo: OLD, fill: 1, site: SITE } });
    const slider = screen.getByLabelText("Size in the circle");
    expect([slider.min, slider.max, slider.step]).toEqual(["1", String(FILL_MAX), "0.05"]);
    fireEvent.change(slider, { target: { value: "1.3" } });
    expect(changes.at(-1)).toEqual({ logo: OLD, fill: 1.3, site: SITE });
    expect(screen.getByText("Size in the circle: 130%")).toBeTruthy();
    // Enlarged inside a frame that keeps the ring, as the team's crest is on its games.
    const frame = document.querySelector(".lp-crest.lp-lg.framed");
    expect(frame.className).toBe("lp-crest lp-lg ours framed");
    expect(frame.querySelector("img").getAttribute("style")).toBe("position: absolute; left: -15%; top: -15%; width: 130%; height: 130%; max-width: none;");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(changes.at(-1)).toEqual({ logo: "", fill: 1, site: SITE });
    expect(big().getAttribute("src")).toBe(OUR_CREST);
  });

  it("a new logo starts at its own size, whatever the one before was enlarged to", async () => {
    const { container } = show({ start: { logo: OLD, fill: 1.4, site: SITE } });
    fireEvent.change(container.querySelector("input[type=file]"), { target: { files: [new File(["x"], "crest.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(changes.at(-1)).toEqual({ logo: FITTED, fill: 1, site: SITE }));
    fireEvent.change(screen.getByLabelText("Size in the circle"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Find logos" }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Logos found on the club's site" })).getAllByRole("button")[1]);
    await waitFor(() => expect(changes.at(-1)).toEqual({ logo: FITTED, fill: 1, site: SITE }));
    expect(sent().at(-1)).toEqual({ action: "image", url: ICON });
  });

  it("leaves the website out where nobody is signed in to read one", () => {
    show({ sites: false });
    expect(screen.queryByLabelText("Or find it on the club's website")).toBeNull();
    expect(screen.queryByRole("button", { name: "Find logos" })).toBeNull();
    expect(screen.getByText("Upload a picture")).toBeTruthy();
  });

  it("drops a logo the page offered that won't load, and says so when none will", async () => {
    show();
    fireEvent.change(screen.getByLabelText("Or find it on the club's website"), { target: { value: SITE } });
    fireEvent.click(screen.getByRole("button", { name: "Find logos" }));
    const picks = await screen.findByRole("group", { name: "Logos found on the club's site" });
    fireEvent.error(within(picks).getAllByRole("button")[1].querySelector("img"));
    expect(within(picks).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Logo 1 of 1: a logo"]);
    fireEvent.error(within(picks).getByRole("button").querySelector("img"));
    expect(screen.getByRole("alert").textContent).toMatch(/None of the images on that page would load/);
  });
});

describe("our crest in its circle (lib/clubs.js ourCrestZoom, components/Crest.jsx)", () => {
  it("is enlarged by the team's size only for a logo of its own, never the club's crest", () => {
    expect(ourLogoFill({ logo: OLD, logoFill: 1.25 })).toBe(1.25);
    expect(ourLogoFill({ logo: OLD, logoFill: 9 })).toBe(FILL_MAX);
    expect(ourLogoFill({ logo: OLD, logoFill: "x" })).toBe(1);
    expect(ourLogoFill({ logo: "", logoFill: 1.25 })).toBe(1);
    expect(ourLogoFill(null)).toBe(1);
    expect(ourCrestZoom(1)).toBeNull();
    expect(ourCrestZoom(0.5)).toBeNull();
    expect(ourCrestZoom(1.6)).toEqual({ position: "absolute", left: "-30.0%", top: "-30.0%", width: "160.0%", height: "160.0%", maxWidth: "none" });
  });

  it("keeps its ring: the frame carries the crest's classes and the picture is enlarged inside it", () => {
    render(<Crest src={OLD} ours fill={1.4} name="Riverside FC U10" />);
    const frame = document.querySelector(".mcrest");
    expect(frame.tagName).toBe("SPAN");
    expect(frame.className).toBe("mcrest ours framed");
    expect(frame.querySelector("img").getAttribute("src")).toBe(OLD);
    cleanup();
    render(<Crest src={OLD} ours fill={1} name="Riverside FC U10" />);
    expect(document.querySelector("img.mcrest.ours").getAttribute("style")).toBeNull();
    cleanup();
    // An opponent's crest is never enlarged this way.
    render(<Crest src={OLD} fill={1.4} name="Seaside FC" />);
    expect(document.querySelector(".framed")).toBeNull();
  });

  it("falls back to the club's crest, not enlarged, when the team's logo won't load", () => {
    render(<Crest src="/uploads/broken.png" ours fill={1.4} name="Riverside FC U10" />);
    const img = document.querySelector(".framed img");
    fireEvent.error(img);
    expect(img.getAttribute("src")).toBe(OUR_CREST);
    expect(img.getAttribute("style")).toBeNull();
    fireEvent.error(img);
    expect(img.style.visibility).toBe("hidden");
  });
});
