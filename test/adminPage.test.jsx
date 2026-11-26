// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// app/admin/page.jsx is an async server component: call the default export
// and render what it returns. It decides who reaches club admin (super admin:
// everything; club admin: the wizard and the role table) and shows the two
// dead ends in the sign-in shell rather than the old red gradient splash.
const { auth, isAdminEmail, isClubAdminEmail, redirect, signOut } = vi.hoisted(() => ({
  auth: vi.fn(), isAdminEmail: vi.fn(), isClubAdminEmail: vi.fn(), redirect: vi.fn(), signOut: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/directory", () => ({ isAdminEmail, isClubAdminEmail }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next-auth/react", () => ({ signOut }));
function AccessManagerStub({ adminEmail, scope }) { return <div data-testid="access" data-email={adminEmail} data-scope={scope} />; }
vi.mock("@/components/AccessManager", () => ({ default: AccessManagerStub }));

let savedSecret;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.AUTH_SECRET;
  auth.mockResolvedValue({ user: { email: "me@a.com" } });
  isAdminEmail.mockReturnValue(false);
  isClubAdminEmail.mockResolvedValue(false);
  // The real redirect() throws to stop rendering; mirror that.
  redirect.mockImplementation((to) => { throw new Error("REDIRECT:" + to); });
});
afterEach(() => {
  cleanup();
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
});

// AUTH_ON is module-load state, so set the env and reload the page module.
async function loadPage({ authOn = true } = {}) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  return (await import("@/app/admin/page")).default;
}

describe("app/admin/page", () => {
  it("team-code mode: explains that club admin needs account login, in the sign-in shell", async () => {
    const Page = await loadPage({ authOn: false });
    render(await Page());
    expect(screen.getByText("Club admin needs account login")).toBeTruthy();
    expect(screen.getByText(/shared team-code mode/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the team hub" }).getAttribute("href")).toBe("/");
    expect(document.querySelector(".auth .auth-card")).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(/gradient/);
    expect(auth).not.toHaveBeenCalled();
  });

  it("not signed in: off to the login page", async () => {
    auth.mockResolvedValue(null);
    const Page = await loadPage();
    await expect(Page()).rejects.toThrow("REDIRECT:/login");
  });

  it("a super admin gets the whole page", async () => {
    isAdminEmail.mockReturnValue(true);
    const Page = await loadPage();
    render(await Page());
    const el = screen.getByTestId("access");
    expect(el.getAttribute("data-email")).toBe("me@a.com");
    expect(el.getAttribute("data-scope")).toBe("super");
    expect(isClubAdminEmail).not.toHaveBeenCalled();
  });

  it("a club admin gets the club scope", async () => {
    isClubAdminEmail.mockResolvedValue(true);
    const Page = await loadPage();
    render(await Page());
    expect(screen.getByTestId("access").getAttribute("data-scope")).toBe("club");
  });

  it("anyone else is told why, with a way back and a sign out", async () => {
    const Page = await loadPage();
    render(await Page());
    expect(screen.queryByTestId("access")).toBeNull();
    expect(screen.getByText("Club admins and super admins only")).toBeTruthy();
    expect(screen.getByText("me@a.com isn't a super admin (ADMIN_EMAILS) or a club admin.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the team hub" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(/gradient/);
  });
});
