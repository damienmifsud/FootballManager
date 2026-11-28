// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { isDevSite } from "@/lib/siteEnv";
import DevBanner from "@/components/DevBanner";

// A development site (APP_ENV=development) says so on every page and never
// emails; the real site is untouched by either.
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete process.env.APP_ENV; });

describe("isDevSite", () => {
  it("is true only for APP_ENV=development, whatever its letter case or spacing", () => {
    expect([isDevSite({ APP_ENV: "development" }), isDevSite({ APP_ENV: " Development " }), isDevSite({ APP_ENV: "production" }), isDevSite({}), isDevSite(undefined), isDevSite({ APP_ENV: "dev" })])
      .toEqual([true, true, false, false, false, false]);
  });
});

describe("DevBanner", () => {
  it("says it's a development site, and is nothing on the real one", () => {
    const { container, rerender } = render(<DevBanner env={{ APP_ENV: "development" }} />);
    expect(container.textContent).toBe("Development site, for testing. Changes here don't touch the real site, and it sends no emails.");
    expect(container.firstChild.getAttribute("role")).toBe("note");
    rerender(<DevBanner env={{}} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("emailChanges on a development site", () => {
  it("sends nothing, even with the real site's email settings copied over", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("NOTIFY_EMAILS", "coach@example.com");
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    const { emailChanges } = await import("@/lib/applyDraws");
    vi.stubEnv("APP_ENV", "development");
    expect(await emailChanges("Riverside FC U10", ["Round 2: time 09:00 → 10:00"])).toBe("email off on the development site");
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("APP_ENV", "");
    expect(await emailChanges("Riverside FC U10", ["Round 2: time 09:00 → 10:00"])).toBe("emailed");
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });
});
