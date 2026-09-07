// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import Login from "@/app/login/page";

// The sign-in page (S10): provider discovery from /api/auth/providers picks
// account mode (SSO buttons + Resend magic link) or the legacy team-code form
// posted to /api/login. Every behaviour the old page had is asserted here
// against the Direction C markup and copy.
const { push, refresh, signIn, signOut } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("next-auth/react", () => ({ signIn, signOut }));

// Resolve /api/auth/providers with `providers`; /api/login answers per `login`.
let providersReply;
let loginReply;
const jsonResponse = (ok, body) => ({ ok, json: async () => body });
beforeEach(() => {
  providersReply = null;
  loginReply = { ok: true };
  global.fetch = vi.fn(async (url, opts) => {
    if (String(url).includes("/api/auth/providers")) {
      if (providersReply instanceof Promise) return providersReply;
      return jsonResponse(true, providersReply);
    }
    if (String(url).includes("/api/login")) return jsonResponse(loginReply.ok, {});
    throw new Error("unexpected fetch " + url + " " + JSON.stringify(opts));
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const GOOGLE = { google: { id: "google", name: "Google" } };
const MICROSOFT = { "microsoft-entra-id": { id: "microsoft-entra-id", name: "Microsoft" } };
const RESEND = { resend: { id: "resend", name: "Resend" } };

const EMOJI = /\p{Extended_Pictographic}/u;
const bodyText = () => document.body.textContent || "";

describe("Login page", () => {
  it("shows a loading line inside the card while providers are unknown", () => {
    let resolve;
    providersReply = new Promise((r) => { resolve = r; });
    render(<Login />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByLabelText("Team code")).toBeNull();
    expect(screen.queryByLabelText("Your email")).toBeNull();
    // Header and footer are already there: the page is club-wide.
    expect(bodyText()).toContain("Olympic FC");
    expect(bodyText()).toContain("Team hub");
    expect(screen.getByText("Olympic FC team hub · footballmgr.au")).toBeTruthy();
    act(() => resolve(jsonResponse(true, {})));
  });

  describe("legacy team-code mode (no providers)", () => {
    beforeEach(() => { providersReply = {}; });

    it("renders the team-code form with the Direction C copy", async () => {
      render(<Login />);
      const input = await screen.findByLabelText("Team code");
      expect(input.getAttribute("type")).toBe("password");
      expect(input.getAttribute("placeholder")).toBe("The code from your coach");
      expect(input.className).toContain("code");
      expect(screen.getByText("Enter the team code to continue")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Let me in" })).toBeTruthy();
      expect(screen.getByText("Everyone on the team uses the same code. Ask in the WhatsApp group if you don't have it.")).toBeTruthy();
      expect(screen.queryByText(/Wrong code/)).toBeNull();
    });

    it("Enter posts the code to /api/login and routes home when it is accepted", async () => {
      render(<Login />);
      const input = await screen.findByLabelText("Team code");
      fireEvent.change(input, { target: { value: "kangaroos" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
      expect(refresh).toHaveBeenCalled();
      const call = global.fetch.mock.calls.find(([u]) => String(u).includes("/api/login"));
      expect(call[1].method).toBe("POST");
      expect(JSON.parse(call[1].body)).toEqual({ password: "kangaroos" });
    });

    it("a wrong code shows the error line and re-enables the button", async () => {
      loginReply = { ok: false };
      render(<Login />);
      const input = await screen.findByLabelText("Team code");
      fireEvent.change(input, { target: { value: "nope" } });
      fireEvent.click(screen.getByRole("button", { name: "Let me in" }));
      expect(await screen.findByText("Wrong code — check with your coach.")).toBeTruthy();
      const btn = screen.getByRole("button", { name: "Let me in" });
      expect(btn.disabled).toBe(false);
      expect(push).not.toHaveBeenCalled();
      // Typing again clears the error.
      fireEvent.change(input, { target: { value: "nope2" } });
      expect(screen.queryByText(/Wrong code/)).toBeNull();
    });

    it("does nothing on Enter with an empty code", async () => {
      render(<Login />);
      const input = await screen.findByLabelText("Team code");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(global.fetch.mock.calls.some(([u]) => String(u).includes("/api/login"))).toBe(false);
    });
  });

  describe("account mode with Google + Resend", () => {
    beforeEach(() => { providersReply = { ...GOOGLE, ...RESEND }; });

    it("shows the SSO button, the divider and the email form", async () => {
      render(<Login />);
      const google = await screen.findByRole("button", { name: "Continue with Google" });
      expect(google.className).toContain("sso");
      expect(screen.queryByRole("button", { name: "Continue with Microsoft" })).toBeNull();
      expect(screen.getByText("Sign in to see your team")).toBeTruthy();
      expect(document.querySelector(".auth-or")).toBeTruthy();
      expect(document.querySelector(".auth-or").textContent).toBe("or");
      expect(screen.getByLabelText("Your email")).toBeTruthy();
      expect(screen.getByText("Your email")).toBeTruthy();
      expect(screen.getByText("No password. Use the email the club has for your family and we'll send a link that signs you in on this phone.")).toBeTruthy();
      expect(screen.queryByLabelText("Team code")).toBeNull();
    });

    it("SSO buttons call signIn with the provider id", async () => {
      render(<Login />);
      fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));
      expect(signIn).toHaveBeenCalledWith("google", { callbackUrl: "/" });
    });

    it("the submit is disabled until the field holds an @, then sends the link and shows the sent state", async () => {
      render(<Login />);
      const input = await screen.findByLabelText("Your email");
      const btn = screen.getByRole("button", { name: "Email me a sign-in link" });
      expect(btn.disabled).toBe(true);
      fireEvent.change(input, { target: { value: "mum" } });
      expect(btn.disabled).toBe(true);
      // Enter with no @ does nothing.
      fireEvent.keyDown(input, { key: "Enter" });
      expect(signIn).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: "mum@a.com" } });
      expect(btn.disabled).toBe(false);
      fireEvent.click(btn);
      expect(signIn).toHaveBeenCalledWith("resend", { email: "mum@a.com", callbackUrl: "/", redirect: false });
      expect(screen.getByText("Check your email")).toBeTruthy();
      expect(screen.getByText("We sent a sign-in link to mum@a.com. It signs you in on this phone.")).toBeTruthy();
      expect(screen.queryByLabelText("Your email")).toBeNull();
      // The SSO button stays available above the sent state.
      expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
      // "Use a different email" returns to the form with the address kept.
      fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
      expect(screen.getByLabelText("Your email").value).toBe("mum@a.com");
      expect(screen.queryByText("Check your email")).toBeNull();
    });

    it("Enter in the email field submits", async () => {
      render(<Login />);
      const input = await screen.findByLabelText("Your email");
      fireEvent.change(input, { target: { value: " dad@a.com " } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(signIn).toHaveBeenCalledWith("resend", { email: "dad@a.com", callbackUrl: "/", redirect: false });
      expect(screen.getByText("We sent a sign-in link to dad@a.com. It signs you in on this phone.")).toBeTruthy();
    });
  });

  it("shows both SSO buttons when Google and Microsoft are configured, Microsoft second", async () => {
    providersReply = { ...GOOGLE, ...MICROSOFT, ...RESEND };
    render(<Login />);
    await screen.findByRole("button", { name: "Continue with Google" });
    const ms = screen.getByRole("button", { name: "Continue with Microsoft" });
    fireEvent.click(ms);
    expect(signIn).toHaveBeenCalledWith("microsoft-entra-id", { callbackUrl: "/" });
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons.indexOf("Continue with Google")).toBeLessThan(buttons.indexOf("Continue with Microsoft"));
  });

  it("resend-only mode has no divider and no SSO buttons", async () => {
    providersReply = { ...RESEND };
    render(<Login />);
    await screen.findByLabelText("Your email");
    expect(document.querySelector(".auth-or")).toBeNull();
    expect(screen.queryByRole("button", { name: /Continue with/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Email me a sign-in link" })).toBeTruthy();
  });

  it("SSO-only mode shows the buttons with no divider and no email form", async () => {
    providersReply = { ...GOOGLE };
    render(<Login />);
    await screen.findByRole("button", { name: "Continue with Google" });
    expect(document.querySelector(".auth-or")).toBeNull();
    expect(screen.queryByLabelText("Your email")).toBeNull();
  });

  it("a failed provider lookup falls back to the team-code form", async () => {
    global.fetch = vi.fn(async () => { throw new Error("offline"); });
    render(<Login />);
    expect(await screen.findByLabelText("Team code")).toBeTruthy();
  });

  it("renders no emoji in any mode, including the sent state", async () => {
    providersReply = { ...GOOGLE, ...RESEND };
    render(<Login />);
    const input = await screen.findByLabelText("Your email");
    expect(bodyText()).not.toMatch(EMOJI);
    fireEvent.change(input, { target: { value: "mum@a.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(screen.getByText("Check your email")).toBeTruthy();
    expect(bodyText()).not.toMatch(EMOJI);
    cleanup();
    providersReply = {};
    render(<Login />);
    await screen.findByLabelText("Team code");
    expect(bodyText()).not.toMatch(EMOJI);
  });

  it("uses the club crest with an initials-disc fallback and the shared footer", async () => {
    providersReply = {};
    render(<Login />);
    await screen.findByLabelText("Team code");
    const img = document.querySelector("img.auth-crest");
    expect(img.getAttribute("src")).toBe("/crests/olympic-fc.png");
    fireEvent.error(img);
    expect(document.querySelector("img.auth-crest")).toBeNull();
    expect(document.querySelector(".auth-disc").textContent).toBe("OFC");
    expect(screen.getByText("Olympic FC team hub · footballmgr.au")).toBeTruthy();
    // DM Sans comes from the same Google Fonts sheet the dashboard imports.
    expect(document.querySelector('link[rel="stylesheet"][href*="fonts.googleapis.com"][href*="DM+Sans"]')).toBeTruthy();
  });
});
